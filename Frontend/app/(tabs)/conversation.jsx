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
      if (startMode === 'SPEAK' || startMode === 'LISTEN') {
        setMode(startMode)
        setDisplayedSentence('')
        setSuggestions([])
        setBestSuggestion(null)
        setSimplifiedText('')
        // Optionally reset history?? No, context is good to keep. 
        // setConversationHistory([]) 
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
      lastAudioDetected.current = Date.now();

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

      const endpoint = isSpeakMode ? '/api/express/audio' : '/api/listen/audio'
      console.log('Uploading to:', BACKEND_URL + endpoint)

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

      if (isSpeakMode) {
        // Show context
        if (data.transcript) {
          // REMOVED onscreen display per user request
          console.log("TRANSCRIPT:", data.transcript);
          setConversationHistory(prev => [...prev, { role: 'user', content: data.transcript }]);
        }

        if (data.bestSuggestion) {
          console.log("Auto-selecting Best Suggestion:", data.bestSuggestion);
          setDisplayedSentence(data.bestSuggestion);
          playTTS(data.bestSuggestion); // Auto-play

          // Optionally add simplified/best text to history? 
          // The user transcript is already added. Let's keep it clean.

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
          playTTS(data.simplified); // Auto-play

          // Auto-Switch after reading time (e.g., 4 seconds)
          setTimeout(() => {
            console.log("Auto-switching to SPEAK...");
            setMode('SPEAK');
          }, 4000);
        }
      }

    } catch (err) {
      console.error('Error processing audio:', err)
      alert('Error connecting to backend: ' + err.message)
    } finally {
      setIsLoading(false)
    }
  }



  const handlePhraseSelect = (text) => {
    setDisplayedSentence(text)
    playTTS(text); // Auto-play
    // Add User to History
    setConversationHistory(prev => [...prev, { role: 'user', content: text }])

    setTimeout(() => setMode('LISTEN'), AUTO_SWITCH_DELAY)
  }

  const handleAcknowledge = () => {
    setMode((prev) => (prev === 'SPEAK' ? 'LISTEN' : 'SPEAK'))
  }

  const handleRepeat = () => {
    // Re-play TTS of current text if available
    if (isListenMode && simplifiedText) {
      playTTS(simplifiedText);
    } else if (isSpeakMode && displayedSentence) {
      playTTS(displayedSentence);
    }
  }

  const playTTS = async (text) => {
    if (!text) return;
    try {
      console.log("Requesting TTS for:", text);
      const response = await fetch(`${BACKEND_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error("TTS Failed");

      const blob = await response.blob();
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const uri = reader.result;
        const { sound } = await Audio.Sound.createAsync({ uri });
        await sound.playAsync();
      };
    } catch (err) {
      console.error("TTS Error:", err);
    }
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

          {isListenMode && simplifiedText ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Simplified Meaning:</Text>
              <Text style={styles.resultText}>{simplifiedText}</Text>
              <Pressable onPress={() => setSimplifiedText('')} style={styles.clearButton}>
                <Text style={styles.clearButtonText}>Clear</Text>
              </Pressable>
            </View>
          ) : null}
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
            onPress={isListenMode ? null : handleRepeat}
            style={[styles.smallButton, styles.repeatButton, isListenMode && styles.disabledButton]}
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


