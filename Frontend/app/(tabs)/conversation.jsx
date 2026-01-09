import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  SafeAreaView,
  Platform,
  ScrollView,
} from 'react-native'
import {
  useLocalSearchParams,
  useRouter,
  useFocusEffect,
} from 'expo-router'
import { Audio } from 'expo-av'
import { StatusBar } from 'expo-status-bar'
import { startWebRecording } from '../../utils/audioUtils';
import { playTTS, playTTSData } from '../../utils/ttsUtils';

const BACKEND_URL = 'http://127.0.0.1:4000' // Use IP to avoid localhost resolution issues


const AUTO_SWITCH_DELAY = 800 // Increased to 800ms to ensure TTS echo is gone before recording starts

// --- QA AUTOMATION SUITE REMOVED --- 
// Production Mode Active

export default function ConversationScreen() {
  const router = useRouter()
  const { startMode } = useLocalSearchParams()

  const [mode, setMode] = useState(startMode || 'LISTEN')
  const [displayedSentence, setDisplayedSentence] = useState('')

  // Audio & Data State
  const [recording, setRecording] = useState(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([]) // For Speak Mode
  const [bestSuggestion, setBestSuggestion] = useState(null) // New: Best option
  const [simplifiedText, setSimplifiedText] = useState('') // For Listen Mode

  // Conversation History for Context
  // Format: [{ role: 'user' | 'assistant', content: '...' }]
  const [history, setHistory] = useState([]);

  // VAD State
  const lastAudioDetected = React.useRef(Date.now())
  const SILENCE_THRESHOLD_DB = -45 // Adjusted: -45 was cutting off speech. -60 too sensitive.
  const isRecordingRef = React.useRef(false); // To track in callbacks without stale closures
  const maxRecordingTimeoutRef = React.useRef(null); // Force stop timer
  const hasSpeechStartedRef = React.useRef(false); // Track if user spoke
  const isSpeakingAudioRef = React.useRef(false);  // Track TTS playback state to prevent loopback
  const webAudioRef = React.useRef(null); // Web VAD context

  const isSpeakMode = mode === 'SPEAK'
  const isListenMode = mode === 'LISTEN'

  // Semantic Turn Variables for Clarity
  const isUserTurn = isSpeakMode;
  const isPartnerTurn = isListenMode;

  const modeRef = React.useRef(mode);
  React.useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Auto-Start Handling when mode changes
  React.useEffect(() => {
    // Increase delay to Ensure TTS echo is gone (800ms)
    // Check isSpeakingAudioRef inside
    const timer = setTimeout(() => {
      if (!isRecordingRef.current && !isSpeakingAudioRef.current) {
        startRecording();
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [mode]);


  useFocusEffect(
    useCallback(() => {
      // If startMode is provided, sync state
      if (startMode === 'SPEAK' || startMode === 'LISTEN') {

        // Prevent clearing state on simple re-focus (e.g. backgrounding app)
        if (history.length > 0 || displayedSentence || simplifiedText) {
          console.log("Focusing Conversation: Resuming existing session...");
          return;
        }

        setMode(startMode)
        modeRef.current = startMode; // Sync ref immediately
        // If mode is already same, useEffect[mode] won't trigger re-start.
        // So we explicitly trigger start logic here if needed.
        // Or better: Stop any previous, then start fresh.
        // Reset data
        setDisplayedSentence('')
        setSuggestions([])
        setBestSuggestion(null)
        setSimplifiedText('')
        setHistory([]); // Clear history on new session

        // Force restart recording
        // Small timeout to allow any previous cleanup or mode setState to process
        setTimeout(() => {
          startRecording();
        }, 600);
      }
    }, [startMode])
  )

  // Cleanup on Unmount
  React.useEffect(() => {
    return () => {
      // We can't access 'recording' state reliably directly in return if closure is stale,
      // but we can use a ref or just ensure logic is robust.
      // Best to rely on isRecordingRef to stop loops, and attempt unload if possible.
      // Note: Expo Audio usually handles unloading on app background, but valid to try here.
      isRecordingRef.current = false;
    };
  }, []);

  // --- Web Recording Implementation ---
  // Moved to utils/audioUtils.js

  // --- Audio Handlers ---
  const startRecording = async () => {
    try {
      // Cleanup any existing
      // Cleanup any existing ONLY if logically recording
      if (recording && isRecordingRef.current) {
        try { await recording.stopAndUnloadAsync() } catch (e) { }
      }

      let newRecording;

      if (Platform.OS === 'web') {
        // Wait if TTS is playing (Loopback Prevention)
        if (isSpeakingAudioRef.current) {
          console.log("Blocked startWebRecording: TTS Playing");
          return;
        }
        newRecording = await startWebRecording();
      } else {
        // Wait if TTS is playing
        if (isSpeakingAudioRef.current) {
          console.log("Blocked Native Rec: TTS Playing");
          return;
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        })
        const result = await Audio.Recording.createAsync(
          { ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true }
        )
        newRecording = result.recording;
      }

      setRecording(newRecording)
      setIsRecording(true)
      isRecordingRef.current = true;
      hasSpeechStartedRef.current = false; // Reset speech tracker
      lastAudioDetected.current = Date.now();

      // Clear text when STARTING to record?
      // User Request: "display the processed output of the previous speaker as well."
      // So we do NOT clear the *other* person's text.
      // We might want to clear *our* previous text though to indicate new input?
      // Actually, let's keep everything until new data arrives to prevent flickering.

      // VAD Monitoring
      newRecording.setOnRecordingStatusUpdate((status) => {
        if (!isRecordingRef.current) return;

        const currentLevel = status.metering ?? -160;

        if (currentLevel > SILENCE_THRESHOLD_DB) {
          // Speech Detected
          lastAudioDetected.current = Date.now();
          hasSpeechStartedRef.current = true;
        } else {
          // Silence
          const timeSilence = Date.now() - lastAudioDetected.current;
          // Dynamic limit: 5s for Aphasia User, 3s for Partner
          const inputMode = modeRef.current;
          const silenceLimit = inputMode === 'SPEAK' ? 5000 : 3000;

          // Only stop if speech HAS started AND we've exceeded the silence limit
          if (hasSpeechStartedRef.current && timeSilence > silenceLimit) {
            stopRecordingLogic(newRecording);
          }
        }
      });
      // Enable metering
      await newRecording.setProgressUpdateInterval(200);

      // --- Hard Timeout Safety Net (Battery Protection) ---
      // We removed the short 5s limit. Now we just have a long fallback (e.g. 60s)
      // in case someone leaves the app running in a quiet room.
      maxRecordingTimeoutRef.current = setTimeout(() => {
        if (isRecordingRef.current) stopRecordingLogic(newRecording);
      }, 60000);

    } catch (err) {
      console.error('Failed to start recording', err)
      setIsRecording(false)
      isRecordingRef.current = false;
    }
  }

  // Wrapper for manual button (if we keep it) or VAD trigger
  const stopRecording = () => stopRecordingLogic(recording)

  const stopRecordingLogic = async (recInstance) => {
    if (!recInstance) return

    // Prevent double calling
    if (!isRecordingRef.current) return;

    // Clear Hard Timeout
    if (maxRecordingTimeoutRef.current) {
      clearTimeout(maxRecordingTimeoutRef.current);
      maxRecordingTimeoutRef.current = null;
    }

    isRecordingRef.current = false;
    setIsRecording(false); // <--- FIXED: Ensure UI updates immediately
    setIsLoading(true)

    // Stop Web VAD - Removed, integrated in stopAndUnloadAsync

    try {
      await recInstance.stopAndUnloadAsync()
      const uri = recInstance.getURI()
      setRecording(null)

      // Upload to Backend
      const formData = new FormData()

      // Fix for Web: fetch blob
      if (Platform.OS === 'web') {
        const resp = await fetch(uri);
        const blob = await resp.blob();
        formData.append('audio', blob, 'recording.m4a');
      } else {
        // Native
        formData.append('audio', {
          uri,
          type: 'audio/m4a',
          name: 'recording.m4a',
        })
      }

      // Send History
      formData.append('history', JSON.stringify(history))

      // USE REF for determining current mode logic
      // This prevents stale closure issues when simple `isSpeakMode` is captured from old render
      const currentMode = modeRef.current;
      const endpoint = currentMode === 'SPEAK' ? '/api/express/audio' : '/api/listen/audio'

      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`Server status: ${response.status}`);
      }

      const data = await response.json()

      // --- Robustness: Handle Empty Responses ---
      const isEmptySpeak = currentMode === 'SPEAK' && !data.transcript && !data.bestSuggestion;
      const isEmptyListen = currentMode === 'LISTEN' && !data.simplified;

      if (isEmptySpeak || isEmptyListen) {
        if (currentMode === 'SPEAK') setDisplayedSentence("(I didn't hear you, trying again...)");
        if (currentMode === 'LISTEN') setSimplifiedText("(Listening...)");

        // Auto-restart after short delay
        setTimeout(() => {
          if (!isRecordingRef.current) startRecording();
        }, 2000);
        return; // Skip normal processing
      }

      if (currentMode === 'SPEAK') {
        // Show context
        if (data.transcript) {
          // Don't add to history yet, wait for selection
          // setConversationHistory(prev => [...prev, { role: 'user', content: data.transcript }]);
        }

        // Express mode logic
        setDisplayedSentence(data.bestSuggestion || data.transcript)
        setSuggestions(data.suggestions || [])

        // Update History (User's Turn)
        const newHistoryItem = { role: 'user', content: data.bestSuggestion || data.transcript };
        setHistory(prev => [...prev.slice(-5), newHistoryItem]); // Keep last 6 items

        // If we have audio, play it
        if (data.bestSuggestionAudio) {
          console.log("Playing Instant Audio...");
          isSpeakingAudioRef.current = true;
          await playTTSData(data.bestSuggestionAudio);
          isSpeakingAudioRef.current = false;
        } else {
          isSpeakingAudioRef.current = true;
          await playTTS(data.bestSuggestion, false, BACKEND_URL);
          isSpeakingAudioRef.current = false;
        }

        // Auto-Switch to Listen Mode
        setTimeout(() => {
          setMode('LISTEN');
        }, AUTO_SWITCH_DELAY);
      } else {
        // Listen Mode
        if (data.simplified) {
          setDisplayedSentence(data.simplified)
          setSimplifiedText(data.simplified)

          // Update History (Partner's Turn)
          // We store the ORIGINAL transcript or the SIMPLIFIED?
          // Storing the original (transcript) gives the AI better context of what the partner *actually* said.
          const newHistoryItem = { role: 'assistant', content: data.transcript || data.simplified };
          setHistory(prev => [...prev.slice(-5), newHistoryItem]);

          // Play Audio
          if (data.audio) {
            await playTTSData(data.audio)
          } else {
            await playTTS(data.simplified, true, BACKEND_URL);
          }

          // Auto-Switch to Speak Mode
          setTimeout(() => {
            setMode('SPEAK');
          }, AUTO_SWITCH_DELAY);
        }
      }

    } catch (err) {
      console.error('Error processing audio:', err)
      alert('Error connecting to backend: ' + err.message)
    } finally {
      setIsLoading(false)
      // Resume recording if not already started (by manual switch)
      if (!isRecordingRef.current) {
        console.log("Resuming recording...");
        startRecording();
      }
    }
  }



  const handlePhraseSelect = async (text) => {
    setDisplayedSentence(text)
    await playTTS(text, false, BACKEND_URL);
    // Add User to History
    setHistory(prev => [...prev.slice(-5), { role: 'user', content: text }])

    setTimeout(() => setMode('LISTEN'), AUTO_SWITCH_DELAY)
  }

  const handleAcknowledge = () => {
    setMode((prev) => (prev === 'SPEAK' ? 'LISTEN' : 'SPEAK'))
  }

  const handleRepeat = async () => {
    // Re-play TTS of current text if available
    // And also switch mode after delay (User Request)
    // Use REF to catch latent state updates if any
    const currentMode = modeRef.current;

    if (currentMode === 'LISTEN' && simplifiedText) {
      await playTTS(simplifiedText, true, BACKEND_URL); // Slow for Listen Mode
      setTimeout(() => setMode('SPEAK'), AUTO_SWITCH_DELAY);
    } else if (currentMode === 'SPEAK' && displayedSentence) {
      await playTTS(displayedSentence, false, BACKEND_URL); // Normal for Speak Mode
      setTimeout(() => setMode('LISTEN'), AUTO_SWITCH_DELAY);
    }
  }

  // playTTS Moved to utils/ttsUtils.js

  const backgroundColor = isSpeakMode ? '#D6E4F0' : '#DCEFE3'

  // Determine content & rotation
  // Priority: Current Speaker's Text -> Other Speaker's Text (Context) -> Default Prompt
  let mainContent = "";
  let rotation = '0deg';
  let readerHint = "↓ Read this ↓";

  if (isSpeakMode) {
    // User's Turn
    if (displayedSentence) {
      // User has spoken. Show to Partner (unless it's a system message)
      const isSystemMessage = displayedSentence.startsWith('(');
      mainContent = displayedSentence;
      rotation = isSystemMessage ? '0deg' : '180deg';
      readerHint = isSystemMessage ? "↓ Message ↓" : "↑ Show Partner ↑";
    } else {
      // User hasn't spoken. Show Partner's last text (Context for User).
      mainContent = simplifiedText || "Speak now...";
      rotation = '0deg';
      readerHint = "↓ Read context ↓";
    }
  } else {
    // Partner's Turn
    if (simplifiedText) {
      // Partner has spoken. Show to User.
      mainContent = simplifiedText;
      rotation = '0deg';
      readerHint = "↓ Read this ↓";
    } else {
      // Partner hasn't spoken. Show User's last text (Context for Partner).
      mainContent = displayedSentence || "Waiting for partner...";
      rotation = '180deg';
      readerHint = "↑ Partner reading ↑";
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* --- TOP: PARTNER CONTROLS (Rotated) --- */}
      <View style={styles.partnerZone}>
        <View style={styles.rotatedControls}>
          <Pressable
            onPress={handleRepeat}
            disabled={!isPartnerTurn}
            style={[styles.smallButton, styles.repeatButton, !isPartnerTurn && styles.disabledButton]}
          >
            <Text style={styles.buttonText}>Repeat</Text>
          </Pressable>
          <View style={{ width: 15 }} />
          <Pressable
            onPress={handleAcknowledge}
            disabled={!isPartnerTurn}
            style={[styles.smallButton, styles.aphasiaOk, !isPartnerTurn && styles.disabledButton]}
          >
            <Text style={styles.buttonText}>Okay</Text>
          </Pressable>
        </View>
      </View>

      {/* --- CENTER: DYNAMIC ROTATING DISPLAY --- */}
      <View style={styles.sharedDisplayContainer}>
        <View style={[styles.rotatingWrapper, { transform: [{ rotate: rotation }] }]}>
          <Text style={styles.sharedText} numberOfLines={5} adjustsFontSizeToFit>
            {mainContent}
          </Text>
          <Text style={styles.readerHint}>
            {readerHint}
          </Text>
        </View>
      </View>

      {/* --- BOTTOM: USER CONTROLS --- */}
      <View style={styles.userZone}>

        {/* Status */}
        <View style={styles.statusContainer}>
          <Text style={[styles.statusText, isRecording ? styles.recording : null]}>
            {isRecording
              ? (isSpeakMode ? "🎤 Listening..." : "👂 Partner Speaking...")
              : (isLoading ? "⏳ Processing..." : (isSpeakMode ? "Your Turn" : "Partner's Turn"))
            }
          </Text>
        </View>

        {/* Quick Responses (2x2 Grid) - Visible in Speak Mode */}
        {isSpeakMode && (
          <View style={styles.quickPhraseGrid}>
            <View style={styles.gridRow}>
              <Pressable style={[styles.gridBtn, { backgroundColor: '#D1F2EB', marginRight: 10 }]} onPress={() => handlePhraseSelect("Yes")}>
                <Text style={styles.gridTxt}>✅ Yes</Text>
              </Pressable>
              <Pressable style={[styles.gridBtn, { backgroundColor: '#FADBD8' }]} onPress={() => handlePhraseSelect("No")}>
                <Text style={styles.gridTxt}>❌ No</Text>
              </Pressable>
            </View>
            <View style={styles.gridRow}>
              <Pressable style={[styles.gridBtn, { backgroundColor: '#FCF3CF', marginRight: 10 }]} onPress={() => handlePhraseSelect("Please wait")}>
                <Text style={styles.gridTxt}>✋ Wait</Text>
              </Pressable>
              <Pressable style={[styles.gridBtn, { backgroundColor: '#E8DAEF' }]} onPress={() => handlePhraseSelect("I need help")}>
                <Text style={styles.gridTxt}>🆘 Help</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Simplify More */}
        <View style={styles.actionRow}>
          <Pressable
            // Enable ONLY in Speak Mode (User wants to simplify Partner's execution)
            // AND if there is text to simplify
            disabled={!isUserTurn || !String(simplifiedText).trim() || isLoading}
            onPress={async () => {
              if (isLoading) return;

              // Stop current recording to "Restart" session
              if (recording) { try { await recording.stopAndUnloadAsync(); } catch (e) { } }
              setIsRecording(false);
              isRecordingRef.current = false;
              setRecording(null);
              setBestSuggestion(null);
              setDisplayedSentence(''); // Ensure no ghost text triggers a flip
              setIsLoading(true);

              const controller = new AbortController();
              const id = setTimeout(() => controller.abort(), 20000);

              try {
                const res = await fetch(`${BACKEND_URL}/api/listen/simplify-more`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: simplifiedText }),
                  signal: controller.signal
                });
                clearTimeout(id);
                const data = await res.json();
                if (data.simplified) {
                  setSimplifiedText(data.simplified);

                  // Play Audio safe with Lock
                  try {
                    isSpeakingAudioRef.current = true;
                    if (data.audio) await playTTSData(data.audio);
                    else await playTTS(data.simplified, true, BACKEND_URL);
                  } finally {
                    isSpeakingAudioRef.current = false;
                  }

                  // Restart Express Mode (Fresh Timer/Recording)
                  // Add buffer to ensure clean state (500ms - Reduced for responsiveness)
                  setTimeout(async () => {
                    await startRecording();
                  }, 500);
                }
              } catch (e) { alert("Failed."); } finally { setIsLoading(false); }
            }}
            style={({ pressed }) => [
              styles.fullWidthButton,
              {
                backgroundColor: (simplifiedText) ? '#FFD700' : '#E0E0E0',
                opacity: (simplifiedText && !isLoading ? (pressed ? 0.8 : 1) : 0.4)
              }
            ]}
          >
            <Text style={{ fontSize: 24, marginRight: 10 }}>✨</Text>
            <Text style={[styles.buttonText, { color: '#000' }]}>Simplify More</Text>
          </Pressable>
        </View>

        {/* Control Row */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={handleAcknowledge}
            style={[styles.smallButton, styles.aphasiaOk, !isUserTurn && styles.disabledButton]}
            disabled={!isUserTurn}
          >
            <Text style={styles.buttonText}>Okay</Text>
          </Pressable>
          <View style={{ width: 15 }} />
          <Pressable
            onPress={handleRepeat}
            style={[styles.smallButton, styles.repeatButton, !isUserTurn && styles.disabledButton]}
            disabled={!isUserTurn}
          >
            <Text style={styles.buttonText}>Repeat</Text>
          </Pressable>
        </View>

        {/* End */}
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.fullWidthButton, styles.endButton]}
            onPress={async () => {
              if (recording) { try { await recording.stopAndUnloadAsync(); } catch (e) { } }
              setIsRecording(false);
              isRecordingRef.current = false;
              router.replace('/');
            }}
          >
            <Text style={styles.buttonText}>End</Text>
          </Pressable>
        </View>

      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F2E7',
  },

  // --- PARTNER (TOP) ---
  partnerZone: {
    flex: 0.14, // Reduced slightly to give space to User
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#EAEAEA',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingBottom: 10,
  },
  rotatedControls: {
    flexDirection: 'row',
    transform: [{ rotate: '180deg' }],
    justifyContent: 'space-between',
    height: 75,
  },

  // --- CENTER (SHARED) ---
  sharedDisplayContainer: {
    flex: 0.26, // Allocated remaining space
    margin: 15,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#333',
    overflow: 'hidden',
    elevation: 4,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10, // Ensure it's not covered if overlap happens
  },
  rotatingWrapper: {
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  sharedText: {
    fontSize: 24, // Slightly smaller to fit better
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
    marginBottom: 10,
  },
  readerHint: {
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },

  // --- USER (BOTTOM) ---
  userZone: {
    flex: 0.60, // Increased to 60% for Grid + Buttons
    padding: 15,
    justifyContent: 'flex-end',
    paddingBottom: 20,
    gap: 12, // Optimized gap
  },
  statusContainer: {
    alignItems: 'center',
    height: 25,
    marginBottom: 5,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
  },
  recording: { color: '#D32F2F' },

  // Quick Phrases (2x2)
  quickPhraseGrid: {
    height: 160, // Taller Grid (was 140)
    marginBottom: 5,
  },
  gridRow: {
    flex: 1,
    flexDirection: 'row',
    marginBottom: 12, // More space between rows
  },
  gridBtn: {
    flex: 1,
    borderRadius: 20, // Rounder
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3,
  },
  gridTxt: {
    fontSize: 22, // Larger text
    fontWeight: '800', // Bolder
    color: '#333',
  },

  // Actions
  actionRow: {
    flexDirection: 'row',
    height: 75, // Taller rows (was 65)
  },

  // Buttons
  fullWidthButton: {
    flex: 1,
    borderRadius: 25, // Rounder
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 4,
  },
  smallButton: {
    flex: 1,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 4,
  },

  // Colors
  aphasiaOk: { backgroundColor: '#4CAF50' }, // Green
  repeatButton: { backgroundColor: '#2196F3' }, // Blue
  endButton: { backgroundColor: '#F44336' }, // Red
  disabledButton: { opacity: 0.3 },

  buttonText: {
    color: '#FFF',
    fontSize: 24, // Larger text
    fontWeight: '800',
  },
})
