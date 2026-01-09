/**
 * Web Recording Implementation with VAD (Voice Activity Detection)
 */
export const startWebRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);

        analyser.fftSize = 256;
        source.connect(analyser); // Connect stream to analyser

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

        // Debounce State
        let framesAboveThreshold = 0;
        let framesBelowThreshold = 0;
        let isSpeakingState = false;

        const SPEECH_THRESHOLD = 30; // Increased from 20 to 30 to reject background noise
        const MIN_SPEECH_FRAMES = 5;  // ~80ms to confirm speech start
        const MIN_SILENCE_FRAMES = 20; // Increased from 15 to 20 for more stable silence detection

        const updateMeter = () => {
            if (!isRecordingWeb) return;

            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;

            // Hysteresis Logic to filter noise (clicks/pops)
            if (average > SPEECH_THRESHOLD) {
                framesBelowThreshold = 0;
                framesAboveThreshold++;

                if (framesAboveThreshold >= MIN_SPEECH_FRAMES) {
                    isSpeakingState = true;
                }
            } else {
                framesAboveThreshold = 0;
                framesBelowThreshold++;

                if (framesBelowThreshold >= MIN_SILENCE_FRAMES) {
                    isSpeakingState = false;
                }
            }

            // Synthetic Metering: -40 (Speaking) vs -80 (Silence)
            const syntheticMetering = isSpeakingState ? -40 : -80;

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
