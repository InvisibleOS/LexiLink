# LexiLink

LexiLink is an AI-powered communication partner designed for people with **aphasia** (difficulty producing or understanding language after stroke/brain injury). It helps users express themselves and understand others in real-world conversations, using a phone-only MVP (Android first).

This project is being built for the **Microsoft Imagine Cup**, and it is designed to use **Azure OpenAI** and **Azure AI Speech** as core components.

---

## 1. Problem & Solution

### Problem

People with aphasia often:

- Know what they want to say but cannot find or sequence the words.
- Struggle to understand long, complex spoken sentences.
- Rely heavily on caregivers to communicate basic needs.
- Find existing communication tools too rigid, slow, or not tuned for real-time conversations.

### Solution

LexiLink provides a simple phone-based assistant with two modes:

1. **Express mode – “Say what I want”**
   - User speaks a broken or partial phrase.
   - LexiLink uses speech recognition and an LLM to generate 2–3 short, clear, polite sentences they might be trying to say.
   - User taps a suggestion and the app speaks it aloud to the conversation partner.

2. **Listen mode – “Understand what you say”**
   - User taps Listen and points the phone toward the speaker.
   - LexiLink transcribes the speech and simplifies it into a short, easy-to-read sentence using basic vocabulary.

Focus areas:

- Accessibility (large buttons, high contrast, minimal cognitive load).
- Real-time assistance in daily life.
- Clear use of Microsoft Azure AI services.

---

## 2. Tech Stack

### Frontend (mobile)

- **React Native** (likely with Expo)
- Runs entirely inside `mobile/`
- Responsibilities:
  - UI for Express and Listen modes
  - Handling text and (later) audio input
  - Making HTTP calls to the backend
  - Displaying suggestions and simplified text
  - Playing audio returned from the backend (TTS)

### Backend

- **Node.js + Express**
- Lives in `backend/`
- Responsibilities:
  - Provide REST API endpoints consumed by the mobile app
  - Call **Azure OpenAI** for:
    - Generating suggestion sentences (Express)
    - Simplifying input sentences (Listen)
  - Call **Azure AI Speech** for:
    - Speech-to-Text (STT)
    - Text-to-Speech (TTS)

### Cloud services (Microsoft)

- **Azure OpenAI / Azure AI Foundry**
  - Chat Completion model (e.g., GPT-4-class or GPT-4o-mini deployment)
- **Azure AI Speech**
  - Speech-to-Text for transcribing user and partner speech
  - Text-to-Speech for speaking out selected sentences

---

## 3. Repository Structure

```text
lexilink/
  backend/
    index.js          # Express app entry
    package.json      # Backend dependencies and scripts
    .env.example      # Environment variable template
    azureOpenAI.js    # Azure OpenAI helper functions
    azureSpeech.js    # Azure Speech helper functions (STT/TTS)
  mobile/
    ...               # React Native / Expo app
  README.md           # This document
```

---

## 4. Backend API

Base URL (development): `http://localhost:4000` or `http://<LAN-IP>:4000`

### 4.1. GET /health

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "message": "LexiLink backend running"
}
```

---

### 4.2. POST /api/express

Express mode: the user wants to express a thought.

**Request body (v1, text-based):**

```json
{
  "text": "i.. tired.. rest"
}
```

**Response body:**

```json
{
  "transcript": "i.. tired.. rest",
  "suggestions": [
    "I am feeling tired and need to rest.",
    "I'm very tired. Can I rest for a while?",
    "I'm exhausted and would like to lie down."
  ]
}
```

In the future, this route (or `/api/express/audio`) may also accept audio input, perform STT with Azure Speech, and then generate suggestions via Azure OpenAI.

---

### 4.3. POST /api/listen

Listen mode: the user wants to understand what someone else said.

**Request body (v1, text-based):**

```json
{
  "text": "I’ve been feeling unusually tired and lethargic for the past few days."
}
```

**Response body:**

```json
{
  "transcript": "I’ve been feeling unusually tired and lethargic for the past few days.",
  "simplified": "I’ve been very tired for a few days."
}
```

In the future, this can also be driven by audio (Azure Speech STT) instead of text.

---

### 4.4. POST /api/tts

Text-to-Speech: speak out a selected sentence.

**Request body:**

```json
{
  "text": "I am feeling tired and need to rest."
}
```

**Response body (current stub):**

```json
{
  "text": "I am feeling tired and need to rest.",
  "note": "TTS not implemented yet – this will later return audio bytes or a URL."
}
```

Future versions will return audio data or a URL to an audio file synthesized via Azure AI Speech.

---

## 5. Setup & Running (Development)

### 5.1. Backend

1. Go to the backend folder:

   ```bash
   cd backend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and fill in actual values:

   ```bash
   cp .env.example .env
   ```

   Set:

   * `PORT`
   * `AZURE_OPENAI_KEY`
   * `AZURE_OPENAI_ENDPOINT`
   * `AZURE_OPENAI_DEPLOYMENT`
   * `AZURE_SPEECH_KEY`
   * `AZURE_SPEECH_REGION`

4. Run the backend:

   ```bash
   npm run dev
   ```

5. Test:

   * `GET http://localhost:4000/health`

---

### 5.2. Mobile (React Native / Expo)

Assuming the app was already created (e.g., Expo):

1. Go to the mobile folder:

   ```bash
   cd mobile
   ```

2. Install dependencies (if not already):

   ```bash
   npm install
   ```

3. Start the app:

   ```bash
   npx expo start
   ```

4. Set `BASE_URL` in the mobile app to your backend address, for example:

   ```js
   const BASE_URL = "http://192.168.x.x:4000";
   ```

5. Use the app to:

   * Call `/api/express` and `/api/listen` with typed text (v1).
   * Later, extend to audio-based flows.

---

## 6. Roadmap & Milestones

### Phase 0 – Align frontend and backend contracts

**Goal:** Make sure the existing frontend and the backend agree on endpoints, request bodies, and response shapes.

* [ ] List all API calls made by the frontend (method, path, body, expected response).
* [ ] Ensure backend has matching routes (`/api/express`, `/api/listen`, `/api/tts`).
* [ ] Return mock data that fits what the frontend expects.
* [ ] Confirm flows work end-to-end with mock responses.

---

### Phase 1 – Azure OpenAI integration (text-based)

**Goal:** Replace mock logic with real AI suggestions and simplifications.

* [ ] Create Azure OpenAI resource and model deployment.
* [ ] Fill `AZURE_OPENAI_*` values in `.env`.
* [ ] Implement `getExpressSuggestions(text)` in `azureOpenAI.js`.
* [ ] Implement `simplifySpeech(text)` in `azureOpenAI.js`.
* [ ] Update `/api/express` to use `getExpressSuggestions`.
* [ ] Update `/api/listen` to use `simplifySpeech`.
* [ ] Test with Postman and the mobile app (typed text in both modes).

---

### Phase 2 – Azure Speech integration (STT/TTS)

**Goal:** Move from text-only input to real audio.

* [ ] Create Azure Speech resource and set `AZURE_SPEECH_*` in `.env`.
* [ ] Implement basic Speech helpers in `azureSpeech.js`:

  * [ ] `transcribeAudioBuffer(buffer)` for STT.
  * [ ] `synthesizeTextToAudio(text)` for TTS.
* [ ] Design and implement audio upload route(s):

  * [ ] `/api/express/audio` with `multipart/form-data` (`audio` field).
* [ ] Integrate Speech + OpenAI pipeline:

  * [ ] Express audio -> STT -> suggestions -> JSON.
  * [ ] TTS from text -> audio returned to frontend.
* [ ] Coordinate with frontend to send audio instead of text in Express/Listen modes once stable.

---

### Phase 3 – Accessibility & UX refinement

**Goal:** Make the app truly usable for people with aphasia.

* [ ] Ensure large, high-contrast buttons and text.
* [ ] Simplify labels (“Say what I want”, “Understand what you say”).
* [ ] Minimize steps and screens (low cognitive load).
* [ ] User-testing with proxies (friends, family, or therapists) to improve flow.

---

### Phase 4 – Data, persistence & metrics (optional for MVP)

**Goal:** Store useful data and measure impact.

* [ ] Decide on data store (file-based, SQLite, or cloud DB).
* [ ] Implement saved phrases storage (user favorites).
* [ ] Capture anonymous usage metrics (e.g., count of messages, latency).
* [ ] Add simple analytics (not required for MVP, but helpful for pitch).

---

### Phase 5 – Competition packaging (Imagine Cup)

**Goal:** Turn the project into a strong Imagine Cup submission.

* [ ] Prepare a short pitch deck:

  * [ ] Problem & user story.
  * [ ] Solution demo.
  * [ ] Architecture (frontend + backend + Azure AI).
  * [ ] Impact and accessibility.
  * [ ] Business model and roadmap.
* [ ] Record a 2–3 minute demo video showing both modes.
* [ ] Fill in Imagine Cup submission form, clearly mentioning:

  * [ ] Use of Azure OpenAI.
  * [ ] Use of Azure AI Speech.
  * [ ] How LexiLink supports accessibility and inclusion.

---

## 7. Contribution Guidelines

* Backend changes in `backend/`.
* Frontend changes in `mobile/`.
* Keep API contracts stable:

  * Discuss any breaking changes before implementing.
* Use environment variables for secrets:

  * Copy `.env.example` to `.env` locally.
* Use issues or TODO comments to track future improvements.

---

This README should give any new contributor (or judge) a clear understanding of what LexiLink is, how it is structured, how to run it, and how the project will evolve toward a competition-ready product.
