const sdk = require("microsoft-cognitiveservices-speech-sdk");
const ffmpeg = require("fluent-ffmpeg"); // Requires ffmpeg installed on system
const fs = require("fs");
const path = require("path");
const os = require("os");

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

// Ensure temp directory exists
const TMP_DIR = path.join(__dirname, "tmp");
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR);
}

function createSpeechConfig() {
    if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
        throw new Error("Missing AZURE_SPEECH_KEY or AZURE_SPEECH_REGION");
    }
    return sdk.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);
}

/**
 * Converts input buffer (m4a, webm, etc.) to 16kHz Mono PCM WAV
 * compatible with Azure Speech SDK default.
 */
function convertToWav(inputBuffer) {
    return new Promise((resolve, reject) => {
        const inputPath = path.join(TMP_DIR, `input_${Date.now()}.m4a`); // Assume m4a/generic
        const outputPath = path.join(TMP_DIR, `output_${Date.now()}.wav`);

        // Write input buffer to disk
        fs.writeFileSync(inputPath, inputBuffer);

        ffmpeg(inputPath)
            .toFormat("wav")
            .audioFrequency(16000)
            .audioChannels(1)
            .audioCodec("pcm_s16le")
            .on("error", (err) => {
                console.error("FFmpeg error:", err);
                try { fs.unlinkSync(inputPath); } catch (e) { }
                reject(err);
            })
            .on("end", () => {
                // Read the converted file
                try {
                    const wavBuffer = fs.readFileSync(outputPath);
                    // Cleanup
                    fs.unlinkSync(inputPath);
                    fs.unlinkSync(outputPath);
                    resolve(wavBuffer);
                } catch (readErr) {
                    reject(readErr);
                }
            })
            .save(outputPath);
    });
}

// Helper to transcribe from audio buffer
async function transcribeAudioBuffer(inputBuffer, language = "en-US") {
    let wavBuffer;
    try {
        wavBuffer = await convertToWav(inputBuffer);
    } catch (err) {
        console.error("Audio conversion failed:", err);
        return ""; // Return empty string on conversion fail
    }

    return new Promise((resolve, reject) => {
        const pushStream = sdk.AudioInputStream.createPushStream();

        // Write the converted WAV buffer to the stream
        pushStream.write(wavBuffer);
        pushStream.close();

        const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        const speechConfig = createSpeechConfig();
        speechConfig.speechRecognitionLanguage = language;

        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

        recognizer.recognizeOnceAsync(
            (result) => {
                recognizer.close();
                if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                    resolve(result.text);
                } else {
                    console.log("Speech SDK Reason:", result.reason, result.errorDetails);
                    resolve(""); // No match or cancellation
                }
            },
            (err) => {
                recognizer.close();
                console.error("Recognizer error:", err);
                reject(err);
            }
        );
    });
}

module.exports = {
    transcribeAudioBuffer
};
