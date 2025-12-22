import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  SafeAreaView,
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
  const [simplifiedText, setSimplifiedText] = useState('') // For Listen Mode

  const isSpeakMode = mode === 'SPEAK'
  const isListenMode = mode === 'LISTEN'


  useFocusEffect(
    useCallback(() => {
      if (startMode === 'SPEAK' || startMode === 'LISTEN') {
        setMode(startMode)
        setDisplayedSentence('')
        setSuggestions([])
        setSimplifiedText('')
      }
    }, [startMode])
  )

  // --- Audio Handlers ---
  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync()
      if (perm.status !== 'granted') {
        alert('Permission to access microphone is required!')
        return
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      })

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      )
      setRecording(recording)
      setIsRecording(true)
    } catch (err) {
      console.error('Failed to start recording', err)
      setIsRecording(false)
    }
  }

  const stopRecording = async () => {
    if (!recording) return
    setIsRecording(false)
    setIsLoading(true)

    try {
      await recording.stopAndUnloadAsync()
      const uri = recording.getURI()
      setRecording(null)

      // Upload to Backend
      const formData = new FormData()
      formData.append('audio', {
        uri,
        type: 'audio/m4a',
        name: 'recording.m4a',
      })

      const endpoint = isSpeakMode ? '/api/express/audio' : '/api/listen/audio'
      console.log('Uploading to:', BACKEND_URL + endpoint)

      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      const data = await response.json()
      console.log('Backend response:', data)

      if (isSpeakMode) {
        if (data.suggestions) {
          setSuggestions(data.suggestions)
        }
        if (data.transcript) {
          // Optionally show transcript immediately?
        }
      } else {
        // Listen Mode
        if (data.simplified) {
          setSimplifiedText(data.simplified)
        }
      }

    } catch (err) {
      console.error('Error processing audio:', err)
      alert('Error connecting to backend')
    } finally {
      setIsLoading(false)
    }
  }



  const handlePhraseSelect = (text) => {
    setDisplayedSentence(text)
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


        <View style={styles.topControls}>
          <Pressable
            style={[
              styles.smallButton,
              isListenMode ? styles.enabledButton : styles.disabledButton,
            ]}
            disabled={!isListenMode}
            onPress={handleAcknowledge}
          >
            <Text style={[styles.smallButtonText, styles.rotated]}>
              OK
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.smallButton,
              isListenMode ? styles.repeatButton : styles.disabledButton,
            ]}
            disabled={!isListenMode}
            onPress={handleRepeat}
          >
            <Text style={styles.smallButtonText}>🔁</Text>
          </Pressable>
        </View>


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
          {isSpeakMode && (
            <View style={styles.phraseGrid}>
              {/* Generated Suggestions */}
              {suggestions.length > 0 ? (
                suggestions.map((sug, idx) => (
                  <Pressable
                    key={idx}
                    style={[styles.phraseButton, styles.suggestionButton]}
                    onPress={() => handlePhraseSelect(sug)}
                  >
                    <Text style={styles.phraseText}>{sug}</Text>
                  </Pressable>
                ))
              ) : (
                <>
                  {/* Default Phrases */}
                  <Pressable
                    style={styles.phraseButton}
                    onPress={() => handlePhraseSelect('I need help')}
                  >
                    <Text style={styles.phraseIcon}>🆘</Text>
                    <Text style={styles.phraseText}>I need help</Text>
                  </Pressable>
                  <Pressable
                    style={styles.phraseButton}
                    onPress={() => handlePhraseSelect('Please wait')}
                  >
                    <Text style={styles.phraseIcon}>⏳</Text>
                    <Text style={styles.phraseText}>Please wait</Text>
                  </Pressable>
                  <Pressable
                    style={styles.phraseButton}
                    onPress={() => handlePhraseSelect('Yes')}
                  >
                    <Text style={styles.phraseIcon}>✅</Text>
                    <Text style={styles.phraseText}>Yes</Text>
                  </Pressable>
                  <Pressable
                    style={styles.phraseButton}
                    onPress={() => handlePhraseSelect('No')}
                  >
                    <Text style={styles.phraseIcon}>❌</Text>
                    <Text style={styles.phraseText}>No</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}

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
          {/* Record Button (Dynamic for both modes) */}
          <Pressable
            style={[
              styles.controlButton,
              isRecording ? styles.recording : styles.recordDefault
            ]}
            onPress={isRecording ? stopRecording : startRecording}
          >
            <Text style={styles.controlText}>
              {isRecording ? '⏹ Stop' : (isLoading ? '⏳...' : '🎤 Record')}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.controlButton,
              styles.aphasiaOk,
              !isSpeakMode && styles.disabledButton,
            ]}
            disabled={!isSpeakMode}
            onPress={handleAcknowledge}
          >
            <Text style={styles.controlText}>OK</Text>
          </Pressable>

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
})


