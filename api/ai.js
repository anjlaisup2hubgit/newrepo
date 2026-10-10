// POST /api/ai   { "prompt": "..." }   ->   { "text": "..." }
//
// Runs on Vercel and forwards the prompt to the Gemini Interactions API, so the
// API key never reaches the browser. Set GEMINI_API_KEY in the Vercel project's
// Environment Variables. GEMINI_MODEL is optional.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_PROMPT_CHARS = 8000;
const MAX_OUTPUT_TOKENS = 4096;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server.' });
  }

  // Vercel parses JSON bodies lazily and throws here if the JSON is malformed.
  let body;
  try {
    body = req.body;
  } catch {
    body = null;
  }
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ error: 'Send JSON like { "prompt": "your text" }.' });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: `Prompt is too long (max ${MAX_PROMPT_CHARS} characters).` });
  }

  let upstream;
  let data;
  try {
    upstream = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: MODEL,
        input: prompt,
        store: false,
        generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
      }),
    });
    data = await upstream.json();
  } catch (err) {
    console.error('Gemini request failed:', err);
    return res.status(502).json({ error: 'Could not reach Gemini.' });
  }

  if (!upstream.ok) {
    console.error('Gemini error', upstream.status, JSON.stringify(data));
    if (upstream.status === 429) {
      return res.status(429).json({ error: 'Too many requests. Try again in a moment.' });
    }
    return res.status(502).json({ error: `Gemini returned an error (status ${upstream.status}).` });
  }

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const text = steps
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');

  if (!text) {
    console.error('Gemini returned no text:', JSON.stringify(data));
    return res.status(502).json({ error: 'Gemini returned no text.' });
  }

  return res.status(200).json({ text });
};
