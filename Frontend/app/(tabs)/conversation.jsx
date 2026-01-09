import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  SafeAreaView,
  Platform,
} from 'react-native'
import {
  useLocalSearchParams,
  useRouter,
  useFocusEffect,
} from 'expo-router'
import { Audio } from 'expo-av'

const BACKEND_URL = 'http://localhost:4000' // Update if needed


const AUTO_SWITCH_DELAY = 3000

export default function ConversationScreen() {
  const router = useRouter()
  const { startMode } = useLocalSearchParams()

  const [mode, setMode] = useState('SPEAK')
  const [displayedSentence, setDisplayedSentence] = useState('')

  // Audio & Data State
  const [recording, setRecording] = useState(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([]) // For Speak Mode
  const [bestSuggestion, setBestSuggestion] = useState(null) // New: Best option
  const [simplifiedText, setSimplifiedText] = useState('') // For Listen Mode

  // New: Conversation History State
  const [conversationHistory, setConversationHistory] = useState([])

  // VAD State
  const lastAudioDetected = React.useRef(Date.now())
  const SILENCE_THRESHOLD_DB = -45 // Adjustable
  const isRecordingRef = React.useRef(false); // To track in callbacks without stale closures

  const isSpeakMode = mode === 'SPEAK'
  const isListenMode = mode === 'LISTEN'

  const modeRef = React.useRef(mode);
  React.useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Auto-Start Handling when mode changes
  React.useEffect(() => {
    // Small delay to ensure cleanup of previous mode
    const timer = setTimeout(() => {
      if (!isRecordingRef.current) {
        startRecording();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [mode]);


  useFocusEffect(
    useCallback(() => {
      // If startMode is provided, sync state
      if (startMode === 'SPEAK' || startMode === 'LISTEN') {
        setMode(startMode)
        modeRef.current = startMode; // Sync ref immediately
        // If mode is already same, useEffect[mode] won't trigger re-start.
        // So we explicitly trigger start logic here if needed.
        // Or better: Stop any previous, then start fresh.
        console.log("Focusing Conversation. Mode:", startMode);

        // Reset data
        setDisplayedSentence('')
        setSuggestions([])
        setBestSuggestion(null)
        setSimplifiedText('')

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
      console.log("Unmounting Conversation... Stopping recording.");
      // We can't access 'recording' state reliably directly in return if closure is stale,
      // but we can use a ref or just ensure logic is robust.
      // Best to rely on isRecordingRef to stop loops, and attempt unload if possible.
      // Note: Expo Audio usually handles unloading on app background, but valid to try here.
      isRecordingRef.current = false;
    };
  }, []);

  // --- Audio Handlers ---
  const startRecording = async () => {
    try {
      // Cleanup any existing
      if (recording) {
        try { await recording.stopAndUnloadAsync() } catch (e) { }
      }

      const perm = await Audio.requestPermissionsAsync()
      if (perm.status !== 'granted') {
        // alert('Permission to access microphone is required!') // Silent fail prefer
        return
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      })

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      )

      setRecording(newRecording)
      setIsRecording(true)
      isRecordingRef.current = true;
      setRecording(newRecording)
      setIsRecording(true)
      isRecordingRef.current = true;
      lastAudioDetected.current = Date.now();

      // Clear text when STARTING to record for the NEW mode
      if (isSpeakMode) {
        setDisplayedSentence(''); // Clear user text when user starts speaking
      } else {
        setSimplifiedText(''); // Clear partner text when partner starts speaking
      }

      // VAD Monitoring
      newRecording.setOnRecordingStatusUpdate((status) => {
        if (!isRecordingRef.current) return;

        if (status.metering > SILENCE_THRESHOLD_DB) {
          // Speech Detected
          lastAudioDetected.current = Date.now();
          //  console.log("Speaking...", status.metering);
        } else {
          // Silence
          const timeSilence = Date.now() - lastAudioDetected.current;
          if (timeSilence > 5000) { // 5 Seconds Spec
            console.log("Silence limit reached. Stopping...");
            stopRecordingLogic(newRecording);
          }
        }
      });
      // Enable metering
      await newRecording.setProgressUpdateInterval(200);

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
    isRecordingRef.current = false;
    setIsRecording(false)
    setIsLoading(true)

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
      formData.append('history', JSON.stringify(conversationHistory))

      // USE REF for determining current mode logic
      // This prevents stale closure issues when simple `isSpeakMode` is captured from old render
      const currentMode = modeRef.current;
      const endpoint = currentMode === 'SPEAK' ? '/api/express/audio' : '/api/listen/audio'
      console.log(`Processing Audio for Mode: ${currentMode} -> ${endpoint}`)

      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        body: formData,
        // headers: { 'Content-Type': 'multipart/form-data' }, // Remove for fetch+FormData
      })

      if (!response.ok) {
        throw new Error(`Server status: ${response.status}`);
      }

      const data = await response.json()
      console.log('Backend response:', data)

      if (currentMode === 'SPEAK') {
        // Show context
        if (data.transcript) {
          // REMOVED onscreen display per user request
          console.log("TRANSCRIPT:", data.transcript);
          // Don't add to history yet, wait for selection
          // setConversationHistory(prev => [...prev, { role: 'user', content: data.transcript }]);
        }

        if (data.suggestions) {
          setSuggestions(data.suggestions);
        }

        if (data.bestSuggestion) {
          console.log("Auto-selecting Best Suggestion:", data.bestSuggestion);
          setDisplayedSentence(data.bestSuggestion);
          await playTTS(data.bestSuggestion, false); // Auto-play (Normal)

          // Auto-Switch to Listen Mode
          setTimeout(() => {
            console.log("Auto-switching to LISTEN...");
            setMode('LISTEN');
          }, AUTO_SWITCH_DELAY);
        }
      } else {
        // Listen Mode
        if (data.simplified) {
          setSimplifiedText(data.simplified)
          setConversationHistory(prev => [...prev, { role: 'partner', content: data.simplified }])
          await playTTS(data.simplified, true); // Auto-play (Slow)

          // Auto-Switch to Speak Mode
          setTimeout(() => {
            console.log("Auto-switching to SPEAK...");
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
    await playTTS(text, false); // Auto-play (Normal)
    // Add User to History
    setConversationHistory(prev => [...prev, { role: 'user', content: text }])

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
      await playTTS(simplifiedText, true); // Slow for Listen Mode
      setTimeout(() => setMode('SPEAK'), AUTO_SWITCH_DELAY);
    } else if (currentMode === 'SPEAK' && displayedSentence) {
      await playTTS(displayedSentence, false); // Normal for Speak Mode
      setTimeout(() => setMode('LISTEN'), AUTO_SWITCH_DELAY);
    }
  }

  const playTTS = (text, isSlow = false) => {
    if (!text) return Promise.resolve();
    return new Promise(async (resolve) => {
      try {
        console.log(`Requesting TTS for: "${text}" (Slow: ${isSlow})`);
        const response = await fetch(`${BACKEND_URL}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, slow: isSlow }),
        });

        if (!response.ok) throw new Error("TTS Failed");

        const blob = await response.blob();
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const uri = reader.result;
          const { sound } = await Audio.Sound.createAsync({ uri });

          sound.setOnPlaybackStatusUpdate(async (status) => {
            if (status.didJustFinish) {
              await sound.unloadAsync();
              resolve();
            }
          });

          await sound.playAsync();
        };
      } catch (err) {
        console.error("TTS Error:", err);
        resolve(); // Resolve anyway
      }
    });
  };

  const backgroundColor = isSpeakMode ? '#D6E4F0' : '#DCEFE3'

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]}>


      <View style={styles.topZone}>
        {/* Top Controls (Repeat/Okay) */}
        <View style={[styles.topControls, styles.rotated]}>
          <Pressable
            onPress={isSpeakMode ? null : handleRepeat}
            style={[styles.smallButton, styles.repeatButton, isSpeakMode && styles.disabledButton]}
          >
            <Text style={styles.smallButtonText}>Repeat</Text>
          </Pressable>
          <Pressable
            onPress={isSpeakMode ? null : handleAcknowledge}
            style={[styles.smallButton, styles.aphasiaOk, isSpeakMode && styles.disabledButton]}
          >
            <Text style={styles.smallButtonText}>Okay</Text>
          </Pressable>
        </View>

        <View style={styles.topDisplayArea}>
          {/* Persistent Rotated Display for Partner */}
          <View style={[styles.textBox, styles.rotated, { width: '100%', alignItems: 'center', opacity: 1 }]}>
            <Text style={styles.displayText}>
              {/* Show User Text (Speak Mode) OR Simplified Text (Listen Mode) */}
              {isListenMode
                ? (simplifiedText || "Listening to partner...")
                : (displayedSentence || "Select a phrase...")
              }
            </Text>
          </View>
        </View>
      </View>


      <View style={styles.bottomZone}>

        <View style={styles.phraseArea}>
          {isSpeakMode && (
            <View style={styles.phraseGrid}>
              <Pressable style={styles.phraseButton} onPress={() => handlePhraseSelect("I need help")}>
                <Text style={styles.phraseIcon}>🆘</Text>
                <Text style={styles.phraseText}>I need help</Text>
              </Pressable>
              <Pressable style={styles.phraseButton} onPress={() => handlePhraseSelect("Please wait")}>
                <Text style={styles.phraseIcon}>✋</Text>
                <Text style={styles.phraseText}>Please wait</Text>
              </Pressable>
              <Pressable style={[styles.phraseButton, { backgroundColor: '#E2F0D9' }]} onPress={() => handlePhraseSelect("Yes")}>
                <Text style={styles.phraseIcon}>✅</Text>
                <Text style={styles.phraseText}>Yes</Text>
              </Pressable>
              <Pressable style={[styles.phraseButton, { backgroundColor: '#FADBD8' }]} onPress={() => handlePhraseSelect("No")}>
                <Text style={styles.phraseIcon}>❌</Text>
                <Text style={styles.phraseText}>No</Text>
              </Pressable>
            </View>
          )}

          {/* Logic for Listen Mode Result */}
          {isListenMode && simplifiedText ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Simplified Meaning:</Text>
              <Text style={styles.resultText}>{simplifiedText}</Text>
            </View>
          ) : null}

          {/* Moved Buttons Outside ResultBox for Logic/Accessibility */}
          {isListenMode && (
            <View style={{ marginTop: 20 }}>
              <Pressable
                disabled={!simplifiedText}
                onPress={async () => {
                  // Logic to call Simplify More
                  try {
                    const res = await fetch(`${BACKEND_URL}/api/listen/simplify-more`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ text: simplifiedText })
                    });
                    const data = await res.json();
                    if (data.simplified) {
                      setSimplifiedText(data.simplified);
                      // Play TTS and WAIT for it to finish
                      await playTTS(data.simplified, true);
                      // THEN switch to Speak mode
                      setMode('SPEAK');
                    }
                  } catch (e) {
                    console.error("Simplify More Error", e);
                  }
                }}
                style={({ pressed }) => [
                  styles.smallButton,
                  {
                    backgroundColor: simplifiedText ? '#FFD700' : '#E0E0E0',
                    paddingVertical: 18,
                    borderRadius: 16,
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 8,
                    opacity: pressed ? 0.8 : 1,
                    width: '100%'
                  }
                ]}
              >
                <Text style={{ fontSize: 24, opacity: simplifiedText ? 1 : 0.3 }}>✨</Text>
                <Text style={[styles.smallButtonText, { fontSize: 18, color: simplifiedText ? '#000' : '#999' }]}>Simplify More</Text>
              </Pressable>
            </View>
          )}

          {/* Logic for Speak Mode Suggestions - HIDDEN per user request */
          /* 
          {isSpeakMode && suggestions.length > 0 && (
            <View style={styles.phraseGrid}>
              ...
            </View>
          )} 
          */}
        </View>


        <View style={styles.controls}>
          {/* Status Indicator moved above buttons */}
          <View style={[styles.controlButton, isRecording ? styles.recording : styles.recordDefault, { opacity: 0.9, marginBottom: 20 }]}>
            <Text style={styles.controlText}>
              {isRecording ? (isSpeakMode ? '🎤 Listening...' : '👂 Listening...') : (isLoading ? '⏳ Processing...' : 'Waiting...')}
            </Text>
          </View>
        </View>

        <View style={styles.midControls}>
          <Pressable
            onPress={handleRepeat}
            style={[styles.smallButton, styles.repeatButton]}
          >
            <Text style={styles.smallButtonText}>Repeat</Text>
          </Pressable>

          <Pressable
            onPress={isListenMode ? null : handleAcknowledge}
            style={[styles.smallButton, styles.aphasiaOk, isListenMode && styles.disabledButton]}
          >
            <Text style={styles.smallButtonText}>Okay</Text>
          </Pressable>

          <Pressable
            style={[styles.smallButton, styles.endButton]}
            onPress={async () => {
              // Stop Recording explicitly
              if (recording) {
                try {
                  await recording.stopAndUnloadAsync();
                } catch (e) {
                  console.log("Error stopping on End:", e);
                }
              }
              setIsRecording(false);
              isRecordingRef.current = false;
              router.replace('/');
            }}
          >
            <Text style={styles.smallButtonText}>End</Text>
          </Pressable>
        </View>
      </View>

    </SafeAreaView >
  )
}



const styles = StyleSheet.create({
  container: { flex: 1 },


  topZone: {
    flex: 1,
    padding: 20,
  },

  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 70, // 🔒 locked
  },

  topDisplayArea: {
    minHeight: 150, // 🔒 locked
    justifyContent: 'center',
  },


  smallButton: {
    paddingVertical: 24, // Increased from 14
    paddingHorizontal: 20,
    borderRadius: 22,
    flex: 1, // Ensure they take available space in row
    alignItems: 'center',
    marginHorizontal: 4,
  },

  smallButtonText: {
    color: '#FFFFFF',
    fontSize: 24, // Increased from 18
    fontWeight: '800',
  },

  enabledButton: {
    backgroundColor: '#0B2545',
  },

  repeatButton: {
    backgroundColor: '#C9C3E6',
  },

  disabledButton: {
    backgroundColor: '#BFC8C8',
    opacity: 0.3, // More translucent as requested
  },

  rotated: {
    transform: [{ rotate: '180deg' }],
  },


  textBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 22,
  },

  displayText: {
    fontSize: 22,
    textAlign: 'center',
    fontWeight: '500',
    color: '#1E1E1E',
  },

  turnCue: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 26,
    alignItems: 'center',
  },

  turnCueText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E1E1E',
  },


  bottomZone: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },

  phraseArea: {
    minHeight: 220, // 🔒 locked
    justifyContent: 'center',
  },

  phraseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 14,
  },

  phraseButton: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingVertical: 22,
    alignItems: 'center',
  },

  phraseIcon: {
    fontSize: 34,
    marginBottom: 6,
  },

  phraseText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E1E1E',
  },

  controls: {
    // Was row, now column for stacking status above buttons? 
    // Actually the JSX structure change handles the vertical stacking (controls View above midControls View)
    // But we need to make sure 'controls' (Status) is full width 
    width: '100%',
    alignItems: 'center',
  },

  controlButton: {
    width: '100%', // Full width status bar
    borderRadius: 24,
    paddingVertical: 18,
    alignItems: 'center',
  },

  aphasiaOk: {
    backgroundColor: '#B8E6C9',
  },

  endButton: {
    backgroundColor: '#7A1F1F',
  },

  controlText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  suggestionButton: {
    width: '100%',
    marginVertical: 4,
  },
  recordDefault: {
    backgroundColor: '#007AFF',
  },
  recording: {
    backgroundColor: '#FF3B30',
  },
  resultBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    width: '100%',
    marginBottom: 10,
  },
  resultLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  resultText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1E1E1E',
  },
  clearButton: {
    marginTop: 8,
    alignSelf: 'flex-end',
  },
  clearButtonText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  bestSuggestionButton: {
    borderColor: '#007AFF',
    borderWidth: 2,
    backgroundColor: '#F0F8FF',
  },
  bestLabel: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  bestPhraseText: {
    color: '#007AFF',
  },
  midControls: {
    flexDirection: 'row',
    justifyContent: 'space-between', // Spread them out
    marginBottom: 10,
    gap: 8, // Smaller gap to fit 3 buttons
  },
})


