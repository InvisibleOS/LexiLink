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
    // Add User to History
    setConversationHistory(prev => [...prev, { role: 'user', content: text }])

    setTimeout(() => setMode('LISTEN'), AUTO_SWITCH_DELAY)
  }

  const handleAcknowledge = () => {
    setMode((prev) => (prev === 'SPEAK' ? 'LISTEN' : 'SPEAK'))
  }

  const handleRepeat = () => { }

  const backgroundColor = isSpeakMode ? '#D6E4F0' : '#DCEFE3'

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]}>


      <View style={styles.topZone}>
        <View style={styles.topDisplayArea}>
          {isSpeakMode && (
            <View style={[styles.textBox, styles.rotated]}>
              <Text style={styles.displayText}>
                {displayedSentence || ' '}
              </Text>
            </View>
          )}

          {isListenMode && (
            <View style={[styles.turnCue, styles.rotated]}>
              <Text style={styles.turnCueText}>Your turn to speak</Text>
            </View>
          )}
        </View>
      </View>


      <View style={styles.bottomZone}>

        {/* PHRASE AREA (LOCKED HEIGHT) */}
        <View style={styles.phraseArea}>
          {/* Logic for Listen Mode Result */}
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
          {/* Status Indicator instead of Button */}
          <View style={[styles.controlButton, isRecording ? styles.recording : styles.recordDefault, { opacity: 0.8 }]}>
            <Text style={styles.controlText}>
              {isRecording ? (isSpeakMode ? '🎤 Listening...' : '👂 Listening...') : (isLoading ? '⏳ Processing...' : 'Waiting...')}
            </Text>
          </View>

          <Pressable
            style={[styles.controlButton, styles.endButton]}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.controlText}>❌ End</Text>
          </Pressable>
        </View>
      </View>

    </SafeAreaView>
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
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 22,
  },

  smallButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },

  enabledButton: {
    backgroundColor: '#0B2545',
  },

  repeatButton: {
    backgroundColor: '#C9C3E6',
  },

  disabledButton: {
    backgroundColor: '#BFC8C8',
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
    flexDirection: 'row',
    gap: 12,
  },

  controlButton: {
    flex: 1,
    borderRadius: 24,
    paddingVertical: 22,
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
    fontSize: 18,
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
})


