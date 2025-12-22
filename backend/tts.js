const sdk = require("microsoft-cognitiveservices-speech-sdk");

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

function createSpeechConfig() {
    if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
        throw new Error("Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION");
    }
    return sdk.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
}

// TODO: helper to synthesize text to audio (e.g., to a stream or base64)
async function synthesizeTextToAudio(text) {
    // Will be implemented later using SpeechSynthesizer
    throw new Error("synthesizeTextToAudio not implemented yet");
}

module.exports = {
    synthesizeTextToAudio,
};
