/**
 * daily-log-watcher.mjs — Watches memory/*.md files for new content
 * 
 * Tracks byte offsets per file in .watcher-state.json
 * Splits new content into paragraphs and ingests each one
 */

import { watch, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { readdir } from 'fs/promises';

const MEMORY_DIR = '/root/.openclaw/workspace/memory';
const STATE_FILE = '/root/.openclaw/workspace/scripts/ingest-agent/.watcher-state.json';
const MIN_PARAGRAPH_LENGTH = 50;
const IMPORTANCE_THRESHOLD = 0.3; // Only store if importance >= this

let ingestTextFn = null; // Set by index.mjs

/**
 * Load watcher state (byte offsets per file)
 */
function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Save watcher state atomically
 */
function saveState(state) {
  saveStateSync(state);
}

/**
 * Save state synchronously (safe for use in callbacks)
 */
function saveStateSync(state) {
  try {
    writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state, null, 2), 'utf8');
    // Use sync rename via execSync workaround
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('[watcher] Failed to save state:', e.message);
  }
}

/**
 * Process new content from a file since last known offset
 */
async function processFileChanges(filePath, state) {
  if (!existsSync(filePath)) return;
  
  let fileSize;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    return;
  }

  const fileName = basename(filePath);
  const lastOffset = state[fileName] || 0;

  if (fileSize <= lastOffset) {
    // File truncated or no new content
    if (fileSize < lastOffset) {
      console.log(`[watcher] File ${fileName} truncated, resetting offset`);
      state[fileName] = 0;
      saveStateSync(state);
    }
    return;
  }

  // Read only new content
  let newContent;
  try {
    const fullContent = readFileSync(filePath, 'utf8');
    // Estimate byte offset (UTF-8 aware approximation)
    // For simplicity, use character offset (close enough for markdown)
    const charOffset = Math.floor(lastOffset * (fullContent.length / fileSize));
    newContent = fullContent.slice(charOffset);
  } catch (e) {
    console.error(`[watcher] Failed to read ${fileName}:`, e.message);
    return;
  }

  // Update offset
  state[fileName] = fileSize;
  saveStateSync(state);

  // Split into paragraphs (double newline)
  const paragraphs = newContent
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length >= MIN_PARAGRAPH_LENGTH);

  if (paragraphs.length === 0) return;

  console.log(`[watcher] ${fileName}: ${paragraphs.length} new paragraphs to process`);

  for (const paragraph of paragraphs) {
    try {
      if (ingestTextFn) {
        await ingestTextFn(paragraph, fileName, 'daily_log');
      }
    } catch (e) {
      console.error(`[watcher] Failed to ingest paragraph from ${fileName}:`, e.message);
    }
  }
}

/**
 * Initialize watcher state for existing files
 */
async function initializeExistingFiles(state) {
  try {
    const files = await readdir(MEMORY_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    
    for (const file of mdFiles) {
      if (!(file in state)) {
        // New file — start from end (don't re-ingest history)
        const filePath = join(MEMORY_DIR, file);
        try {
          const size = statSync(filePath).size;
          state[file] = size;
          console.log(`[watcher] Initialized ${file} at offset ${size}`);
        } catch {
          state[file] = 0;
        }
      }
    }
    saveStateSync(state);
  } catch (e) {
    console.error('[watcher] Failed to initialize existing files:', e.message);
  }
}

/**
 * Start the daily log watcher
 * @param {Function} ingestFn - async function(content, source, sourceType)
 */
export async function startWatcher(ingestFn) {
  ingestTextFn = ingestFn;
  
  const state = loadState();
  await initializeExistingFiles(state);

  console.log(`[watcher] Watching ${MEMORY_DIR} for *.md changes`);

  // Debounce map to avoid duplicate processing
  const debounceMap = new Map();

  const watcher = watch(MEMORY_DIR, { persistent: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.md')) return;

    const filePath = join(MEMORY_DIR, filename);
    
    // Debounce: wait 500ms after last event for this file
    if (debounceMap.has(filename)) {
      clearTimeout(debounceMap.get(filename));
    }

    const timer = setTimeout(async () => {
      debounceMap.delete(filename);
      const currentState = loadState();
      await processFileChanges(filePath, currentState);
    }, 500);

    debounceMap.set(filename, timer);
  });

  watcher.on('error', (err) => {
    console.error('[watcher] Watch error:', err.message);
  });

  console.log('[watcher] Started successfully');
  return watcher;
}
