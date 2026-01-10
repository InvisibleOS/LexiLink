# Aphasia Assist Backend

## Prerequisites
- Node.js (v18+)
- FFmpeg (must be installed and in your PATH) for microphone testing.
- Azure Cognitive Services keys in `.env`

## Setup
1. `npm install`
2. Create `.env` based on `.env.example`.

## Running the Server
- `npm start`
- `npm run dev` (with nodemon)

## Developer Tools

### Microphone Test (No Frontend)
You can test the STT -> Processing pipeline using your computer's microphone.

**Setup:**
- Ensure `ffmpeg` is installed.
- **Windows Users:** You likely need to specify your microphone device name.
    1. Run `ffmpeg -list_devices true -f dshow -i dummy` to see available devices.
    2. Pass the device name to the script using `--device="Your Device Name"`.

**Running:**
```bash
# Test 'Speak' (Express) mode
npm run mic:speak -- --device="Microphone (Realtek Audio)"

# Test 'Listen' (Comprehend) mode
npm run mic:listen -- --device="Microphone (Realtek Audio)"
```
*Note: On macOS, `--device` is usually not needed if you want the default mic.*
