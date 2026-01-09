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
            timeout: 10000, // 10s timeout to prevent hang
        });
        return response.data.choices[0].message.content;
    } catch (err) {
        console.error("OpenAI API call failed:", err.message);
        throw err;
    }
}

// Express mode: broken speech -> suggestions[] + bestSuggestion
async function getExpressSuggestions(userText, history = []) {
    // Extract last partner message for specific context
    const lastPartnerMsg = history.filter(h => h.role !== 'user').pop()?.content || "No context.";

    // Functional Prompt: Input + Context -> Output
    const prompt = `
Context (Partner's Question): "${lastPartnerMsg}"
User's Input (Broken Speech): "${userText}"

Task: Convert the User's Input into a complete, natural sentence that answers the Partner.
Note: The User is replying to the Partner.

Example:
Context: "How are you?"
Input: "Good"
Output: "I am doing well."

Provide the single best response in JSON:
{
  "bestSuggestion": "..."
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
                    bestSuggestion: "I would like some water, please."
                })
            }
        );

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            console.error("Failed to parse JSON from OpenAI in getExpressSuggestions:", content);
            parsed = { bestSuggestion: content.trim() };
        }

        if (!parsed.bestSuggestion) {
            // Fallback if model behaves unexpectedly
            parsed.bestSuggestion = Array.isArray(parsed.suggestions) ? parsed.suggestions[0] : userText;
        }
        // Ensure suggestions array exists for consistency, even if containing only bestSuggestion
        if (!parsed.suggestions) {
            parsed.suggestions = [parsed.bestSuggestion];
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
async function simplifySpeech(inputText, history = []) {
    // Format history for context (last 3 turns to avoid token limit)
    const recentHistory = history.slice(-3);
    const historyText = recentHistory.map(msg => `${msg.role === 'user' ? 'Aphasia User' : 'Partner'}: "${msg.content}"`).join("\n");

    const prompt = `
You are helping a person with aphasia understand spoken language. The input might be fast, complex, or long.
Your job is to simplify the text for a person with aphasia.

Context (Last 3 turns):
${historyText}

Original speech (Partner said):
"${inputText}"

Rules:
1. Use simple, everyday words.
2. Keep sentences short and clear.
3. Use a maximum of 2 OR 3 short sentences.
4. Do NOT add new information.
5. Reduce size of sentence while keeping original meaning.
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


// Listen mode: Explain/Break down further
async function simplifyMore(inputText) {
    const prompt = `
You are helping a person with aphasia. They need the absolute minimum words to understand.
Convert the text into "Telegraph Usage" or "Broken Speech".
Input Text: "${inputText}"
Rules:
1. Remove all articles (a, an, the).
2. Remove auxiliary verbs if possible (am, is, are, will).
3. Keep only KEY nouns and verbs.
4. STRICTLY Maximum 2 or 3 words (e.g., "Dog happy", "Go store").
5. Example: "What are you doing?" -> "What doing?"
6. Example: "I am going to the store" -> "Go store"
7. Return ONLY the simplified phrase. No bullet points.
`;


    try {
        const content = await openAIChat(
            [
                { role: "system", content: "You simplify language to keywords only." },
                { role: "user", content: prompt },
            ],
            {
                temperature: 0.1,
                max_tokens: 50,
                mockResponse: inputText // Fallback
            }
        );

        return content.trim();
    } catch (error) {
        console.error("Error in simplifyMore:", error.message);
        return "Error explaining.";
    }
}

module.exports = {
    getExpressSuggestions,
    simplifySpeech,
    simplifyMore,
};

