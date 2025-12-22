const sdk = require("microsoft-cognitiveservices-speech-sdk");

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

function createSpeechConfig() {
    if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
        throw new Error("Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION");
    }
    return sdk.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
}

// Helper to transcribe from audio buffer
async function transcribeAudioBuffer(buffer, language = "en-US") {
    return new Promise((resolve, reject) => {
        const pushStream = sdk.AudioInputStream.createPushStream();

        // Write the buffer to the stream
        pushStream.write(buffer);
        pushStream.close();

        const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        const speechConfig = createSpeechConfig();
        speechConfig.speechRecognitionLanguage = language;

        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

        let transcript = "";

        recognizer.recognized = (s, e) => {
            if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
                transcript += e.result.text;
            }
        };

        recognizer.canceled = (s, e) => {
            if (e.reason === sdk.CancellationReason.Error) {
                reject(new Error(`Canceled: ${e.errorDetails}`));
            }
            recognizer.close();
        };

        recognizer.sessionStopped = (s, e) => {
            recognizer.stopContinuousRecognitionAsync(() => {
                recognizer.close();
                resolve(transcript);
            });
        };

        // For a single short utterance, recognizeOnceAsync is simpler, 
        // but if we are streaming a buffer that might be longer, continuous might be safer.
        // However, for "mic test" clips (5-8s), recognizeOnceAsync is usually sufficient.
        // Let's stick to recognizeOnceAsync for simplicity as requested by the "short duration" requirement.

        recognizer.recognizeOnceAsync(
            (result) => {
                recognizer.close();
                if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                    resolve(result.text);
                } else if (result.reason === sdk.ResultReason.NoMatch) {
                    resolve(""); // No speech recognized
                } else if (result.reason === sdk.ResultReason.Canceled) {
                    reject(new Error(`Canceled: ${result.errorDetails}`));
                }
            },
            (err) => {
                recognizer.close();
                reject(err);
            }
        );
    });
}


module.exports = {
    transcribeAudioBuffer
};
