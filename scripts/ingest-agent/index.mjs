/**
 * index.mjs — IngestAgent main entry point
 * 
 * - Starts the daily log file watcher
 * - Exports ingestText() for programmatic use
 * - HTTP server on port 3847 for POST /ingest
 * 
 * Environment (loaded from /root/.openclaw/.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   OPENROUTER_API_KEY
 *   OPENAI_API_KEY (optional, for embeddings)
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load env from /root/.openclaw/.env if not already set
const ENV_FILE = '/root/.openclaw/.env';
if (existsSync(ENV_FILE)) {
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

import { extractAll } from './extractors/haiku-extractor.mjs';
import { storeMemory, generateId } from './store.mjs';
import { startWatcher } from './watchers/daily-log-watcher.mjs';

const PORT = 3847;
const IMPORTANCE_THRESHOLD = 0.3;

/**
 * Core ingest function — extract metadata + store memory
 * Idempotent: same content ingested twice = one entry
 * 
 * @param {string} content - Text content to ingest
 * @param {string} source - Source identifier (filename, 'manual', etc)
 * @param {string} sourceType - Type: 'daily_log', 'manual', etc
 * @returns {Promise<{id, stored, skipped, error}>}
 */
export async function ingestText(content, source, sourceType = 'daily_log') {
  if (!content || content.trim().length < 10) {
    return { skipped: true, reason: 'too_short' };
  }

  const id = generateId(source, content.trim());
  
  try {
    // Extract metadata + embedding in parallel
    const { entities, topics, tags, importance, embedding } = await extractAll(content);

    // Skip low-importance content
    if (importance < IMPORTANCE_THRESHOLD) {
      console.log(`[ingest] Skipping low-importance content (${importance}) from ${source}`);
      return { skipped: true, reason: 'low_importance', importance };
    }

    const result = await storeMemory({
      id,
      content: content.trim(),
      source,
      source_type: sourceType,
      entities,
      topics,
      tags,
      importance,
      embedding,
    });

    return { id, ...result };
  } catch (err) {
    console.error(`[ingest] Error processing content from ${source}:`, err.message);
    return { id, error: err.message };
  }
}

/**
 * HTTP server for external agents to call POST /ingest
 */
function startHttpServer() {
  const server = createServer(async (req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'ingest-agent', port: PORT }));
      return;
    }

    // POST /ingest
    if (req.method === 'POST' && req.url === '/ingest') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { text, source = 'api', source_type = 'manual' } = JSON.parse(body);
          
          if (!text) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'text field required' }));
            return;
          }

          const result = await ingestText(text, source, source_type);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          console.error('[http] Request error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ingest-agent] HTTP server listening on port ${PORT}`);
  });

  server.on('error', (err) => {
    console.error('[ingest-agent] HTTP server error:', err.message);
  });

  return server;
}

/**
 * Main startup
 */
async function main() {
  console.log('[ingest-agent] Starting SKYNET Memory IngestAgent...');
  console.log(`[ingest-agent] SUPABASE_URL: ${process.env.SUPABASE_URL || '(not set)'}`);
  console.log(`[ingest-agent] OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? '***set***' : '(not set)'}`);

  // Start HTTP server
  startHttpServer();

  // Start file watcher
  await startWatcher(ingestText);

  console.log('[ingest-agent] Ready. Watching for memory changes...');
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[ingest-agent] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[ingest-agent] SIGINT received, shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[ingest-agent] Uncaught exception:', err.message, err.stack);
  // Don't crash — log and continue
});

process.on('unhandledRejection', (reason) => {
  console.error('[ingest-agent] Unhandled rejection:', reason);
  // Don't crash — log and continue
});

main().catch(err => {
  console.error('[ingest-agent] Fatal startup error:', err.message);
  process.exit(1);
});
