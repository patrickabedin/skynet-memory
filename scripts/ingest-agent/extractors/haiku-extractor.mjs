/**
 * haiku-extractor.mjs — LLM extraction + embedding generation
 * 
 * Uses OpenRouter claude-haiku-4.5 for entity/topic/tag extraction
 * Uses OpenRouter for embeddings (text-embedding-3-small via OpenAI compatible endpoint)
 * 
 * Model is HARDCODED: openrouter/anthropic/claude-haiku-4.5
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 
  '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';

const HAIKU_MODEL = 'anthropic/claude-haiku-4-5'; // OpenRouter model id
const EMBEDDING_MODEL = 'text-embedding-3-small';

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the following text and extract structured metadata.

Return ONLY valid JSON with this exact structure:
{
  "entities": ["list of named entities: people, coins, systems, tools"],
  "topics": ["list of topic categories: trading, risk, strategy, market, technical, etc"],
  "tags": ["list of specific tags: RSI, funding_rate, SHORT, LONG, etc"],
  "importance": 0.7
}

Rules:
- entities: proper nouns, coin names (BTC, ETH, HYPE), system names, people
- topics: broad categories (max 5)
- tags: specific keywords useful for search (max 10)
- importance: float 0.0-1.0 (0=noise, 0.5=normal, 0.8+=critical trading signal)
- Higher importance for: trade signals, errors, decisions, risk events
- Lower importance for: routine logs, status updates, timestamps

Text to analyze:
`;

/**
 * Extract entities, topics, tags, and importance from text using Haiku
 * @param {string} text
 * @returns {Promise<{entities: string[], topics: string[], tags: string[], importance: number}>}
 */
export async function extractMetadata(text) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://skynet.cyberdin.com',
      'X-Title': 'SKYNET Memory Ingest',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      messages: [
        {
          role: 'user',
          content: EXTRACTION_PROMPT + text,
        }
      ],
      max_tokens: 500,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Haiku extraction failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  
  // Parse JSON, handle markdown code blocks
  let parsed;
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.warn(`[haiku-extractor] JSON parse failed, using defaults. Raw: ${raw.slice(0, 200)}`);
    parsed = {};
  }

  return {
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
  };
}

/**
 * Generate embedding for text using OpenAI text-embedding-3-small via OpenRouter
 * Falls back to null if embedding fails (memory still stored without vector)
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
export async function generateEmbedding(text) {
  // Try OpenAI directly if key available, else use OpenRouter
  const openaiKey = process.env.OPENAI_API_KEY;
  
  if (openaiKey) {
    return generateEmbeddingOpenAI(text, openaiKey);
  }
  
  // Use OpenRouter's OpenAI-compatible endpoint
  return generateEmbeddingOpenRouter(text);
}

async function generateEmbeddingOpenAI(text, apiKey) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // token limit safety
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

async function generateEmbeddingOpenRouter(text) {
  // OpenRouter supports OpenAI-compatible embeddings endpoint
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://skynet.cyberdin.com',
      'X-Title': 'SKYNET Memory Ingest',
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-small',
      input: text.slice(0, 8000),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn(`[haiku-extractor] OpenRouter embedding failed: ${res.status} ${err.slice(0, 200)}`);
    return null;
  }

  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

/**
 * Full extraction pipeline: metadata + embedding
 * @param {string} text
 * @returns {Promise<{entities, topics, tags, importance, embedding}>}
 */
export async function extractAll(text) {
  const [metadata, embedding] = await Promise.allSettled([
    extractMetadata(text),
    generateEmbedding(text),
  ]);

  const meta = metadata.status === 'fulfilled' ? metadata.value : {
    entities: [], topics: [], tags: [], importance: 0.5,
  };

  if (metadata.status === 'rejected') {
    console.error(`[haiku-extractor] Metadata extraction error:`, metadata.reason?.message);
  }

  const emb = embedding.status === 'fulfilled' ? embedding.value : null;
  if (embedding.status === 'rejected') {
    console.error(`[haiku-extractor] Embedding error:`, embedding.reason?.message);
  }

  return { ...meta, embedding: emb };
}
