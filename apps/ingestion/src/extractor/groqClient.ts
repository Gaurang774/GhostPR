/**
 * groqClient.ts
 * Thin wrapper around the Groq SDK.
 * Exposes a single callGroq() function used by the decision extractor.
 */

import Groq from 'groq-sdk';

// ─── Client singleton ─────────────────────────────────────────────────────────

let _client: Groq | null = null;

function getClient(): Groq {
  if (!_client) {
    const apiKey = process.env['GROQ_API_KEY'];
    if (!apiKey) {
      throw new Error('GROQ_API_KEY environment variable is not set');
    }
    _client = new Groq({ apiKey });
  }
  return _client;
}

// ─── Model config ─────────────────────────────────────────────────────────────

const MODEL = process.env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile';
const TEMPERATURE = 0.1; // Low temperature for structured extraction (PROJECT.md spec)
const MAX_TOKENS = 1500;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call the Groq LLM with a text prompt and return the raw string response.
 * Throws if the API call fails or returns no content.
 */
export async function callGroq(prompt: string): Promise<string> {
  const client = getClient();

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error('Groq returned an empty response');
  }

  return content.trim();
}
