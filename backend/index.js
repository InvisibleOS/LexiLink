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
    const { text, history } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    const { suggestions, bestSuggestion } = await getExpressSuggestions(text, history);
    res.json({
      transcript: text,
      suggestions,
      bestSuggestion,
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
    const { text, slow } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    console.log(`Synthesizing TTS for: "${text}" (Slow: ${!!slow})`);
    const audioData = await synthesizeTextToAudio(text, !!slow);

    // Return as MP3 audio
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioData));

  } catch (err) {
    console.error("Error in /api/tts:", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Express mode: Audio -> Transcript -> Suggestions
app.post("/api/express/audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "audio file is required" });
    }

    // 1. STT
    const transcript = await transcribeAudioBuffer(req.file.buffer);
    if (!transcript) {
      return res.json({ transcript: "", suggestions: [] });
    }

    // 2. Processing
    let history = [];
    if (req.body.history) {
      try {
        history = typeof req.body.history === 'string' ? JSON.parse(req.body.history) : req.body.history;
      } catch (e) {
        console.warn("Failed to parse history in /api/express/audio", e);
      }
    }

    const { suggestions, bestSuggestion } = await getExpressSuggestions(transcript, history);

    res.json({
      transcript,
      suggestions,
      bestSuggestion,
    });
  } catch (err) {
    console.error("Error in /api/express/audio:", err.message || err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Listen mode: Audio -> Transcript -> Simplified
app.post("/api/listen/audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "audio file is required" });
    }

    // 1. STT
    const transcript = await transcribeAudioBuffer(req.file.buffer);
    if (!transcript) {
      return res.json({ transcript: "", simplified: "" });
    }

    // 2. Processing
    const simplified = await simplifySpeech(transcript);

    res.json({
      transcript,
      simplified,
    });
  } catch (err) {
    console.error("Error in /api/listen/audio:", err.message || err);
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
