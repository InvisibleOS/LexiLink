import { View, Text, StyleSheet, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import React from 'react'

const App = () => {
  const router = useRouter()

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Aphasia Assist</Text>

        <Pressable
          style={[styles.cardbutton, styles.listen]}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/conversation',
              params: { startMode: 'LISTEN' },
            })
          }
        >
          <Text style={styles.cardText}>👂 Listen</Text>
        </Pressable>

        <Pressable
          style={[styles.cardbutton, styles.speak]}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/conversation',
              params: { startMode: 'SPEAK' },
            })
          }
        >
          <Text style={styles.cardText}>🗣 Speak</Text>
        </Pressable>

        <Pressable
          style={styles.button}
          onPress={() => router.push('/explore')}
        >
          <Text style={styles.buttonText}>Help</Text>
        </Pressable>
      </View>
    </View>
  )
}

export default App


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F2E7',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },

  content: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },

  title: {
    color: '#1E1E1E',
    fontSize: 36,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 28,
  },

  cardbutton: {
    width: '100%',
    height: 110,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 14,
  },

  cardText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1E1E1E',
    textAlign: 'center',
    letterSpacing: 0.3,
  },

  speak: {
    backgroundColor: '#D6E4F0',
  },

  listen: {
    backgroundColor: '#DCEFE3',
  },

  button: {
    width: '100%',
    maxWidth: 200,
    height: 60,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B2545',
    marginTop: 32,
  },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
})


