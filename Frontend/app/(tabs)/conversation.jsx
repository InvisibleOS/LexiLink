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

const BACKEND_URL = 'http://10.68.7.111:4000' // Update if needed


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
  const SILENCE_THRESHOLD_DB = -60 // Even more sensitive
  const isRecordingRef = React.useRef(false); // To track in callbacks without stale closures
  const webAudioRef = React.useRef(null); // Web VAD context

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

  // --- Web Recording Implementation ---
  const startWebRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      source.connect(analyser); // Connect stream to analyser
      // Do NOT connect source to destination (speakers) to avoid feedback, 
      // unless we want self-monitoring (usually no for voice dictation).

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.start();

      let recordingUri = null;
      let isRecordingWeb = true;
      let onStatusUpdate = null;

      // VAD / Metering Loop
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (!isRecordingWeb) return;

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Map 0-255 to dB-ish range for compatibility with existing logic (-160 to 0)
        // Simple mapping: 20*log10(average/255)
        // But our existing VAD logic uses the threshold directly.
        // Let's normalize it to the Expo metering range if possible, or just pass the average 
        // and adjust threshold? 
        // Actually, the existing logic checks `status.metering > SILENCE_THRESHOLD_DB (-60)`.
        // -60dB is very quiet. 
        // Let's just pass a synthetic metering value.
        // If average > 10 (which we used before), that's "Volume Detected".
        // Let's pass -40 if average > 10, else -80.
        // OR better: calculate dB.
        // Gate the metering to prevent noise from keeping it open.
        // Threshold 10/255 is approx -28dB relative to max, but noise floor might be lower.
        // If avg > 10, we say "Speaking" (-40dB > -60dB threshold).
        // If avg <= 10, we say "Silence" (-80dB < -60dB threshold).
        const isSpeaking = average > 10;
        const syntheticMetering = isSpeaking ? -40 : -80;

        // Pass status update
        if (onStatusUpdate) {
          onStatusUpdate({
            isRecording: true,
            metering: syntheticMetering
          });
        }

        requestAnimationFrame(updateMeter);
      };

      updateMeter();

      return {
        stopAndUnloadAsync: async () => {
          isRecordingWeb = false;
          return new Promise((resolve) => {
            mediaRecorder.onstop = () => {
              const blob = new Blob(chunks, { type: mimeType });
              recordingUri = URL.createObjectURL(blob);

              // Cleanup
              stream.getTracks().forEach(t => t.stop());
              audioContext.close();
              resolve();
            };
            mediaRecorder.stop();
          });
        },
        getURI: () => recordingUri,
        setOnRecordingStatusUpdate: (fn) => {
          onStatusUpdate = fn;
        },
        setProgressUpdateInterval: (interval) => {
          // No-op or use for loop throttling if needed
        }
      };
    } catch (err) {
      console.error("Web Recording Error", err);
      throw err;
    }
  }

  // --- Audio Handlers ---
  const startRecording = async () => {
    try {
      // Cleanup any existing
      if (recording) {
        try { await recording.stopAndUnloadAsync() } catch (e) { }
      }

      let newRecording;

      if (Platform.OS === 'web') {
        newRecording = await startWebRecording();
      } else {
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

      // Start Web VAD if needed - Removed, integrated above

      // VAD Monitoring
      newRecording.setOnRecordingStatusUpdate((status) => {
        if (!isRecordingRef.current) return;

        // Debug Log
        console.log(`[VAD] Mode: ${modeRef.current} | Metering: ${status.metering}`);

        const currentLevel = status.metering ?? -160;

        if (currentLevel > SILENCE_THRESHOLD_DB) {
          // Speech Detected
          lastAudioDetected.current = Date.now();
          //  console.log("Speaking...", status.metering);
        } else {
          // Silence
          const timeSilence = Date.now() - lastAudioDetected.current;
          // Dynamic limit: 5s for Aphasia User, 3s for Partner
          const inputMode = modeRef.current;
          const silenceLimit = inputMode === 'SPEAK' ? 5000 : 3000;

          if (timeSilence > silenceLimit) {
            console.log(`Silence limit (${silenceLimit}ms) reached. Stopping...`);
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
      // Safety Timeout (e.g., 8 seconds max for TTS)
      const timeout = setTimeout(() => {
        console.log("TTS Timeout reached. Resolving to unblock.");
        resolve();
      }, 8000);

      try {
        console.log(`Requesting TTS for: "${text}" (Slow: ${isSlow})`);
        const response = await fetch(`${BACKEND_URL}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, slow: isSlow }),
        });

        if (!response.ok) throw new Error("TTS Failed");

        const blob = await response.blob();

        // --- WEB IMPLEMENTATION ---
        if (Platform.OS === 'web') {
          const uri = URL.createObjectURL(blob);
          const audio = new Audio(uri);

          audio.onended = () => {
            console.log("Web Audio Finished");
            clearTimeout(timeout);
            resolve();
          };
          audio.onerror = (e) => {
            console.error("Web Audio Error", e);
            clearTimeout(timeout);
            resolve();
          };

          await audio.play();
          return;
        }

        // --- NATIVE IMPLEMENTATION ---
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const uri = reader.result;
          const { sound } = await Audio.Sound.createAsync({ uri });

          sound.setOnPlaybackStatusUpdate(async (status) => {
            if (status.didJustFinish) {
              clearTimeout(timeout); // Clear timeout on success
              await sound.unloadAsync();
              resolve();
            }
          });

          await sound.playAsync();
        };
      } catch (err) {
        console.error("TTS Error:", err);
        clearTimeout(timeout);
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
              {/* If in Listen Mode but no simplified text yet, keep showing the User's last text (displayedSentence) */}
              {isListenMode
                ? (simplifiedText || displayedSentence || "Listening to partner...")
                : (displayedSentence || "Select a phrase...")
              }
            </Text>
          </View>
        </View>
      </View>


      <View style={styles.bottomZone}>

        {/* PHRASE AREA (LOCKED HEIGHT) */}
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
          {isSpeakMode && simplifiedText && (
            <View style={{ marginTop: 20 }}>
              <Pressable
                disabled={!simplifiedText}
                onPress={async () => {
                  console.log("Simplify More: Clicked");
                  // STOP Recording manually to avoid conflict
                  if (recording) {
                    try {
                      console.log("Simplify More: Stopping current recording...");
                      await recording.stopAndUnloadAsync();
                    } catch (e) {
                      console.log("Simplify More: Stop Error (ignoring)", e);
                    }
                  }
                  setIsRecording(false);
                  isRecordingRef.current = false;
                  setRecording(null);

                  setIsLoading(true);

                  try {
                    console.log("Simplify More: Fetching...");
                    const res = await fetch(`${BACKEND_URL}/api/listen/simplify-more`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ text: simplifiedText })
                    });
                    const data = await res.json();
                    console.log("Simplify More: Got Data", data);

                    if (data.simplified) {
                      setSimplifiedText(data.simplified);

                      // Play TTS and WAIT for it to finish
                      console.log("Simplify More: Playing TTS...");
                      await playTTS(data.simplified, true);
                      console.log("Simplify More: TTS Done.");

                      // Restart Recording manually
                      console.log("Simplify More: Restarting Recording...");
                      await startRecording();
                      console.log("Simplify More: Recording Restarted.");
                    }
                  } catch (e) {
                    console.error("Simplify More Error", e);
                    // Ensure we restart if error
                    await startRecording();
                  } finally {
                    console.log("Simplify More: Finally (Loading False)");
                    setIsLoading(false);
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


