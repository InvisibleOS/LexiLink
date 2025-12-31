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
// TODO: helper to synthesize text to audio (e.g., to a stream or base64)
async function synthesizeTextToAudio(text, slow = false) {
    const speechConfig = getSpeechConfig();

    // null audio config means synthesize to memory (no playback on server)
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

    // Construct SSML for optional slow speed
    // User requested 0.75 rate with GAPS between words for clarity
    let rate = "1.0";
    let textToSpeak = text;

    if (slow) {
        rate = "0.75";
        // Inject pauses between words: replace spaces with a break
        // Check for non-empty text to avoid errors
        if (text) {
            textToSpeak = text.split(' ').join(' <break time="150ms"/> ');
        }
    }

    const ssml = `
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="en-US-AvaMultilingualNeural">
            <prosody rate="${rate}">
                ${textToSpeak}
            </prosody>
        </voice>
    </speak>`;

    return new Promise((resolve, reject) => {
        // Use speakSsmlAsync instead of speakTextAsync
        synthesizer.speakSsmlAsync(
            ssml,
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
