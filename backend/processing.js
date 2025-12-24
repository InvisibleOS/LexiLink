const axios = require("axios");
require("dotenv").config();

const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;

// Helper for chat completions
async function openAIChat(messages, options = {}) {
    // Guard clause for missing config
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_DEPLOYMENT) {
        console.warn("Azure OpenAI config missing. Returning mock response.");
        return options.mockResponse || "Azure OpenAI not configured.";
    }

    const apiUrl = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=2024-02-15-preview`;

    const body = {
        messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.max_tokens ?? 256,
    };

    try {
        const response = await axios.post(apiUrl, body, {
            headers: {
                "Content-Type": "application/json",
                "api-key": AZURE_OPENAI_KEY,
            },
        });
        return response.data.choices[0].message.content;
    } catch (err) {
        console.error("OpenAI API call failed:", err.message);
        throw err;
    }
}

// Express mode: broken speech -> suggestions[] + bestSuggestion
async function getExpressSuggestions(userText, history = []) {
    // Format history for the prompt
    const historyText = history.map(msg => `${msg.role === 'user' ? 'User' : 'Partner'}: "${msg.content}"`).join("\n");

    const prompt = `
You are helping a person with aphasia communicate. They often speak in broken, incomplete, or keyword-based language.

Conversation History:
${historyText}

Current User Input (Broken Speech): "${userText}"

Your job:
1. Infer the intended meaning from the broken speech, using the conversation history as context.
2. Reconstruct it into grammatical, complete, and polite English sentences.
3. Provide 3 diverse options ranging from casual to slightly formal.
4. Select the "best" option that fits the conversation flow most naturally.
5. Return ONLY valid JSON like:
{
  "suggestions": ["Option 1", "Option 2", "Option 3"],
  "bestSuggestion": "Option 1"
}
`;

    try {
        const content = await openAIChat(
            [
                { role: "system", content: "You are a helpful communication assistant for people with aphasia." },
                { role: "user", content: prompt },
            ],
            {
                temperature: 0.5,
                max_tokens: 300,
                mockResponse: JSON.stringify({
                    suggestions: ["I would like some water, please.", "Could you help me with this?", "I am feeling tired today."],
                    bestSuggestion: "I would like some water, please."
                })
            }
        );

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            console.error("Failed to parse JSON from OpenAI in getExpressSuggestions:", content);
            parsed = { suggestions: [content.trim()], bestSuggestion: content.trim() };
        }

        if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
            parsed.suggestions = [userText];
        }
        if (!parsed.bestSuggestion) {
            parsed.bestSuggestion = parsed.suggestions[0];
        }

        return parsed; // Returns { suggestions: [], bestSuggestion: "" }
    } catch (error) {
        console.error("Error in getExpressSuggestions:", error.message);
        return {
            suggestions: ["Error generating suggestions.", "Please try again later.", "Check backend logs."],
            bestSuggestion: "Error generating suggestions."
        };
    }
}

// Listen mode: complex sentence -> simplified sentences
async function simplifySpeech(inputText) {
    const prompt = `
You are helping a person with aphasia understand spoken language. The input might be fast, complex, or long.
Your job is to simplify the text for a person with aphasia.
Original speech:
"${inputText}"

Rules:
1. Use simple, everyday words.
2. Keep sentences short and clear.
3. Use a maximum of 2 OR3 short sentences.
4. Do NOT add new information.
5. Do NOT change the original meaning.
6. Remove extra or unnecessary words.
7. Do NOT explain your changes.
8. Return ONLY the simplified text.
`;

    try {
        const content = await openAIChat(
            [
                { role: "system", content: "You simplify language for people with aphasia." },
                { role: "user", content: prompt },
            ],
            {
                temperature: 0.3,
                max_tokens: 150,
                mockResponse: "Simplified speech placeholder."
            }
        );

        return content.trim();
    } catch (error) {
        console.error("Error in simplifySpeech:", error.message);
        return "Error simplifying speech.";
    }
}


module.exports = {
    getExpressSuggestions,
    simplifySpeech,
};

