/**
 * store.mjs — Supabase write layer for agent_memories
 * Upserts memories with dedup via SHA-256 id
 */

import { createHash } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tibgiiszzhastruyjiza.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpYmdpaXN6emhhc3RydXlqaXphIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTc4NDYwOCwiZXhwIjoyMDg3MzYwNjA4fQ.7lXGiE5Bv0tvyYZUFDKix6jeTJU5vUpNM7ENbYQ_yHw';

/**
 * Generate a 12-char id from SHA-256(source + content)
 */
export function generateId(source, content) {
  return createHash('sha256')
    .update(source + content)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Store a memory entry in Supabase.
 * Idempotent: if id already exists, skip silently.
 * 
 * @param {Object} entry - Memory entry to store
 * @param {string} entry.id
 * @param {string} entry.content
 * @param {string} entry.source
 * @param {string} entry.source_type
 * @param {string[]} entry.entities
 * @param {string[]} entry.topics
 * @param {string[]} entry.tags
 * @param {number} entry.importance
 * @param {number[]|null} entry.embedding - 1536-dim vector
 */
export async function storeMemory(entry) {
  const url = `${SUPABASE_URL}/rest/v1/agent_memories`;
  
  const body = {
    id: entry.id,
    content: entry.content,
    source: entry.source,
    source_type: entry.source_type || 'daily_log',
    entities: entry.entities || [],
    topics: entry.topics || [],
    tags: entry.tags || [],
    importance: entry.importance ?? 0.5,
    consolidated: false,
    promoted: false,
    connections: [],
    embedding: entry.embedding ? `[${entry.embedding.join(',')}]` : null,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    // 409 = duplicate key, treat as success (idempotent)
    if (res.status === 409 || text.includes('duplicate key')) {
      console.log(`[store] Duplicate id=${entry.id}, skipping`);
      return { skipped: true };
    }
    throw new Error(`Supabase write failed: ${res.status} ${text}`);
  }

  console.log(`[store] Stored memory id=${entry.id} source=${entry.source} importance=${entry.importance}`);
  return { stored: true, id: entry.id };
}
