const sdk = require("microsoft-cognitiveservices-speech-sdk");

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

// Cache the config to avoid re-creation overhead
let cachedSpeechConfig = null;

function getSpeechConfig() {
    if (cachedSpeechConfig) return cachedSpeechConfig;

    if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
        throw new Error("Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION");
    }

    cachedSpeechConfig = sdk.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
    // Set output format to MP3 for better compatibility/size
    cachedSpeechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

    return cachedSpeechConfig;
}

// TODO: helper to synthesize text to audio (e.g., to a stream or base64)
async function synthesizeTextToAudio(text) {
    const speechConfig = getSpeechConfig();

    // null audio config means synthesize to memory (no playback on server)
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

    return new Promise((resolve, reject) => {
        synthesizer.speakTextAsync(
            text,
            (result) => {
                if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                    // result.audioData is an ArrayBuffer
                    resolve(result.audioData);
                } else {
                    reject(new Error("TTS Synthesis failed: " + result.errorDetails));
                }
                synthesizer.close();
            },
            (err) => {
                console.error("TTS Error:", err);
                synthesizer.close();
                reject(err);
            }
        );
    });
}

module.exports = {
    synthesizeTextToAudio,
};
