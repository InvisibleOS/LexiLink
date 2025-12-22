require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");

const { getExpressSuggestions, simplifySpeech } = require("./processing");
const { transcribeAudioBuffer } = require("./stt");
const { synthesizeTextToAudio } = require("./tts");
const upload = multer();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json()); // JSON bodies

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "LexiLink backend running" });
});

/**
 * POST /api/express
 * Express mode: for now expects JSON { text: string }.
 * Later can support audio uploads as well.
 * Returns: { transcript: string, suggestions: string[] }
 */
app.post("/api/express", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const suggestions = await getExpressSuggestions(text);
    res.json({
      transcript: text,
      suggestions,
    });
  } catch (err) {
    console.error("Error in /api/express:", err.response?.data || err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/listen
 * Listen mode: for now expects JSON { text: string }.
 * Returns: { transcript: string, simplified: string }
 */
app.post("/api/listen", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const simplified = await simplifySpeech(text);
    res.json({
      transcript: text,
      simplified,
    });
  } catch (err) {
    console.error("Error in /api/listen:", err.response?.data || err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/tts
 * Text-to-speech: for now stubbed; later will call Azure Speech.
 * Expects JSON { text: string }.
 * For now returns the text back and a note.
 */
app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    // TODO: Integrate Azure Speech TTS and return audio or URL
    res.json({
      text,
      note: "TTS not implemented yet – this will later return audio bytes or a URL.",
    });
  } catch (err) {
    console.error("Error in /api/tts:", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Example placeholder route for future audio-based express endpoint
app.post("/api/express/audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "audio file is required" });
    }
    // TODO:
    // 1. Use Azure Speech STT on req.file.buffer to get transcript
    // 2. Use getExpressSuggestions(transcript)
    // For now, just echo a stub:
    res.json({
      transcript: "TODO: STT from audio",
      suggestions: [
        "Stub suggestion 1 from audio.",
        "Stub suggestion 2 from audio.",
        "Stub suggestion 3 from audio.",
      ],
    });
  } catch (err) {
    console.error("Error in /api/express/audio:", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Global error handler (fallback)
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`LexiLink backend listening on port ${PORT}`);
});
