# Architecture — SKYNET Memory System

## Overview

Three agents, each with a single responsibility:

| Agent | Runtime | Trigger | Model |
|---|---|---|---|
| IngestAgent | PM2 (always-on) | File change / HTTP POST / Supabase event | Claude Haiku 4.5 |
| ConsolidateAgent | OpenClaw cron (isolated) | Every 30 min | Claude Haiku 4.5 |
| QueryAgent | On-demand | Session start / Patrick command / pre-decision | Claude Haiku 4.5 |

All models hardcoded to `openrouter/anthropic/claude-haiku-4.5`. No auto-routing. No Sonnet fallback.

## Data Flow

```
SOURCES                    INGEST                    STORE
──────                     ──────                    ─────
memory/YYYY-MM-DD.md  ──►  haiku-extractor.mjs  ──► Supabase
  (file watcher)            entities, topics,        agent_memories
                            importance, embedding     (pgvector)
v4_trades (closed)    ──►  trade-formatter.mjs  ──►      │
  (supabase realtime)                                     │
                                                          │
.learnings/ERRORS.md  ──►  error-formatter.mjs  ──►      │
  (file watcher)                                          │
                                                          │
Session history       ──►  session-exporter.mjs ──►      │
  (60min cron)                                            ▼
                                               ┌──────────────────┐
                                               │  agent_memories  │
                                               │  consolidated=F  │
                                               └────────┬─────────┘
                                                        │ (every 30min)
                                                        ▼
                                               ConsolidateAgent
                                               ├── find connections
                                               ├── generate insights
                                               ├── update instincts.json
                                               ├── promote → MEMORY.md
                                               └── mark consolidated=T
                                                        │
                                                        ▼
                                               QueryAgent (on demand)
                                               ├── embed query
                                               ├── pgvector search
                                               └── Haiku synthesis
```

## IngestAgent — HTTP API

Port: **3847**

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/ingest` | POST | `{text, source, source_type}` | Ingest any text |
| `/status` | GET | — | Health check + entry count |
| `/query` | GET | `?q=...` | Quick semantic search |

Other agents call `POST http://localhost:3847/ingest` to add memories without direct DB access.

## ConsolidateAgent — Cron Config

```json
{
  "name": "memory-consolidate",
  "schedule": { "kind": "cron", "expr": "*/30 * * * *" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "model": "openrouter/anthropic/claude-haiku-4.5",
    "message": "Run ConsolidateAgent: node /root/.openclaw/workspace/scripts/consolidate-agent/index.mjs",
    "timeoutSeconds": 120
  }
}
```

**Incremental guarantee:** Only processes `WHERE consolidated = false`. Exits immediately if 0 entries (zero cost).

## Instinct Feedback Loop

```
Trade closes in v4_trades
        ↓
Check instincts.json for matching setup (coin + direction + RSI range)
        ↓
Trade WON  → confidence += 0.05 (max 1.0)
Trade LOST → confidence -= 0.10 (min 0.0)
        ↓
confidence < 0.30 → flag for review → Telegram alert
confidence < 0.10 → auto-archive → Telegram alert
```

## Session Primer

On every main session start, QueryAgent runs silently and prepends:

```
Memory primed — 847 entries | last consolidation: 23 min ago | 3 new instincts this week
```

If this line is absent → memory system is broken.

## Weekly Audit

Every Sunday 02:00 UTC:
- Count new entries this week
- Count consolidation runs (target: 336/336)
- Count new instincts
- Detect any manual primitive writes
- Send Telegram health report to Patrick

## Memory Decay

Weekly archival of entries matching ALL:
- `created_at < NOW() - INTERVAL '90 days'`
- `importance < 0.4`
- `consolidated = true`

Archived entries compressed into a single summary entry. pgvector index rebuilt after archival.
