import { Platform } from 'react-native';
import { Audio } from 'expo-av';

/**
 * Plays Text-to-Speech audio.
 * @param {string} text - The text to speak.
 * @param {boolean} isSlow - Whether to speak slowly.
 * @param {string} backendUrl - The backend URL for the TTS API.
 * @returns {Promise<void>}
 */
export const playTTS = (text, isSlow = false, backendUrl) => {
    if (!text) return Promise.resolve();
    return new Promise(async (resolve) => {
        // Safety Timeout (e.g., 8 seconds max for TTS)
        const timeout = setTimeout(() => {
            console.log("TTS Timeout reached. Resolving to unblock.");
            resolve();
        }, 8000);

        try {
            console.log(`Requesting TTS for: "${text}" (Slow: ${isSlow})`);
            const response = await fetch(`${backendUrl}/api/tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, slow: isSlow }),
            });

            if (!response.ok) throw new Error("TTS Failed");

            const blob = await response.blob();

            // --- WEB IMPLEMENTATION ---
            if (Platform.OS === 'web') {
                const uri = URL.createObjectURL(blob);
                const audio = new window.Audio(uri); // Fix: Use window.Audio to avoid shadowing Expo Audio import

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

                // Configure Audio for Playback (Speaker)
                // IMPORTANT: Disabling recording mode ensures output goes to Speaker, not Earpiece.
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    playsInSilentModeIOS: true,
                });

                const { sound } = await Audio.Sound.createAsync({ uri });
                console.log("TTS Sound Object Created. Duration:", (await sound.getStatusAsync()).durationMillis);

                // Explicitly set volume
                await sound.setVolumeAsync(1.0);

                sound.setOnPlaybackStatusUpdate(async (status) => {
                    if (status.didJustFinish) {
                        console.log("TTS Playback Finished");
                        clearTimeout(timeout); // Clear timeout on success
                        await sound.unloadAsync();
                        resolve();
                    }
                });

                console.log("TTS playing async...");
                await sound.playAsync();
            };
        } catch (err) {
            console.error("TTS Error:", err);
            clearTimeout(timeout);
            resolve(); // Resolve anyway
        }
    });
};

/**
 * Plays audio directly from Base64 string.
 * @param {string} base64Data - Base64 encoded audio string.
 * @returns {Promise<void>}
 */
export const playTTSData = (base64Data) => {
    if (!base64Data) return Promise.resolve();

    return new Promise(async (resolve) => {
        try {
            const uri = `data:audio/mp3;base64,${base64Data}`;

            if (Platform.OS === 'web') {
                const audio = new window.Audio(uri);
                audio.onended = () => resolve();
                audio.onerror = (e) => {
                    console.error("Web Audio Data Error", e);
                    resolve();
                };
                await audio.play();
                return;
            }

            // Native
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });

            const { sound } = await Audio.Sound.createAsync({ uri });
            // Max Volume
            await sound.setVolumeAsync(1.0);

            sound.setOnPlaybackStatusUpdate(async (status) => {
                if (status.didJustFinish) {
                    await sound.unloadAsync();
                    resolve();
                }
            });
            await sound.playAsync();

        } catch (e) {
            console.error("playTTSData Error:", e);
            resolve();
        }
    });
};
