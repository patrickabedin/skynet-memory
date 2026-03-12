# 🧠 SKYNET Memory — Always-On Memory System

> Autonomous, always-on memory for AI agents. No vector DB infra. No embeddings server. Just Supabase + pgvector + Claude Haiku running 24/7.

Built for **SKYNET/MOTHER** — an autonomous crypto trading agent — but designed to work for any long-running AI agent that needs persistent, evolving memory.

---

## The Problem

Most AI agents have amnesia. Every session starts cold. Decisions made last week are forgotten. Patterns across sessions are never surfaced. Manual memory writes get skipped when the agent is busy.

**Current approaches fall short:**

| Approach | Limitation |
|---|---|
| Flat markdown files | Manual writes, no pattern detection, no semantic search |
| Vector DB + RAG | Passive — embeds once, retrieves later, no active processing |
| Conversation summary | Loses detail over time, no cross-reference |
| Knowledge graphs | Expensive to build and maintain |

**The gap:** No system actively consolidates information like a human brain does. Humans don't just store memories — during sleep, the brain replays, connects, and compresses information. This system does the same thing.

---

## The Solution

Three always-on agents running as background processes:

```
New event (log write / trade close / error / conversation)
        ↓
┌─────────────────────────────────────────────┐
│              INGEST AGENT (PM2)             │
│  • Watches files + Supabase events          │
│  • Extracts entities, topics, importance    │
│  • Generates embeddings (text-embedding-3)  │
│  • Stores in Supabase agent_memories table  │
└───────────────────┬─────────────────────────┘
                    │ (every 30 min, cron)
                    ▼
┌─────────────────────────────────────────────┐
│           CONSOLIDATE AGENT (Cron)          │
│  • Reads only NEW (unconsolidated) entries  │
│  • Finds connections + patterns via Haiku   │
│  • Updates instincts.json                   │
│  • Auto-promotes insights → MEMORY.md       │
│  • Marks entries consolidated = true        │
└───────────────────┬─────────────────────────┘
                    │ (on demand / session start)
                    ▼
┌─────────────────────────────────────────────┐
│              QUERY AGENT                    │
│  • Embeds query → pgvector similarity search│
│  • Haiku synthesizes answer with citations  │
│  • Primes agent context on session start    │
│  • Surfaces relevant memory before decisions│
└─────────────────────────────────────────────┘
```

---

## Key Design Decisions

### ✅ pgvector inside Supabase (not a separate vector DB)
pgvector is a Supabase extension — zero new infra, zero extra cost. Semantic similarity search from day one.

### ✅ Incremental processing only
ConsolidateAgent only processes `WHERE consolidated = false`. If 0 new entries → exits immediately ($0.00 cost). Never re-reads already-processed entries.

### ✅ Hardcoded Haiku — no expensive fallback
All background agents use `openrouter/anthropic/claude-haiku-4.5` explicitly. No `auto` routing that could fall back to Sonnet.

### ✅ Outcome feedback loop
Instinct confidence scores update based on real trade outcomes. Bad instincts decay and get retired automatically.

### ✅ Weekly audit enforcement
A weekly cron verifies the system is working and alerts if the agent drifts back to primitive manual writes.

---

## Cost

| Component | Model | Daily Cost |
|---|---|---|
| IngestAgent (20 entries/day) | Claude Haiku 4.5 | ~$0.003 |
| ConsolidateAgent (48 runs/day) | Claude Haiku 4.5 | ~$0.030 |
| QueryAgent (10 queries/day) | Claude Haiku 4.5 | ~$0.008 |
| Embeddings | text-embedding-3-small | ~$0.00003 |
| **Total** | | **~$0.041/day** |

**48x cheaper than naive full-scan approach** ($0.041 vs ~$1.44/day).

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full system design.

---

## Data Schema

### Supabase Table: `agent_memories`

```sql
CREATE TABLE agent_memories (
  id              TEXT PRIMARY KEY,        -- SHA-256(source+content).slice(0,12)
  content         TEXT NOT NULL,
  source          TEXT NOT NULL,
  source_type     TEXT NOT NULL,           -- daily_log | trade_outcome | error_log | session_export | insight
  entities        TEXT[] DEFAULT '{}',
  topics          TEXT[] DEFAULT '{}',
  tags            TEXT[] DEFAULT '{}',
  importance      FLOAT DEFAULT 0.5,       -- 0.0–1.0
  consolidated    BOOLEAN DEFAULT FALSE,   -- false = needs ConsolidateAgent
  promoted        BOOLEAN DEFAULT FALSE,   -- true = written to MEMORY.md
  connections     JSONB DEFAULT '[]',
  embedding       vector(1536),            -- text-embedding-3-small
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  consolidated_at TIMESTAMPTZ,
  promoted_at     TIMESTAMPTZ
);
```

---

## Implementation Stories

| Story | What | Status |
|---|---|---|
| 1 | Supabase table + IngestAgent (file watcher) | 🔄 In progress |
| 2 | ConsolidateAgent cron (30min, Haiku) | Queued |
| 3 | QueryAgent + `/memory` Telegram command | Queued |
| 4 | Supabase trade outcome ingestion | Queued |
| 5 | Auto-promotion to MEMORY.md | Queued |
| 6 | Session auto-export (closes biggest gap) | Queued |
| 7 | Outcome feedback loop (instinct confidence) | Queued |
| 8 | Session primer (warm start) | Queued |
| 9 | Proactive memory surfacing (before decisions) | Queued |
| 10 | Memory decay + weekly audit cron | Queued |

---

## File Structure

```
skynet-memory/
├── README.md
├── docs/
│   ├── ARCHITECTURE.md       — Full system design
│   ├── SCHEMA.md             — Supabase table + SQL setup
│   ├── COST_ANALYSIS.md      — Token math, daily cost breakdown
│   ├── MIGRATION.md          — Moving from primitive → always-on
│   └── STORIES.md            — Full PRD implementation plan
├── scripts/
│   ├── ingest-agent/
│   │   ├── index.mjs         — Main entry + HTTP API (port 3847)
│   │   ├── store.mjs         — Supabase write layer
│   │   ├── watchers/
│   │   │   ├── daily-log-watcher.mjs
│   │   │   └── supabase-trades-watcher.mjs
│   │   └── extractors/
│   │       └── haiku-extractor.mjs
│   ├── consolidate-agent/
│   │   ├── index.mjs
│   │   ├── connector.mjs
│   │   ├── instincts-writer.mjs
│   │   ├── promoter.mjs
│   │   └── lock.mjs
│   └── query-agent/
│       ├── index.mjs
│       ├── retriever.mjs
│       └── synthesizer.mjs
├── sql/
│   ├── 001_create_agent_memories.sql
│   └── 002_match_memories_function.sql
└── package.json
```

---

## Quick Start

```bash
git clone https://github.com/patrickabedin/skynet-memory
cd skynet-memory
npm install

# Set env vars
export SUPABASE_URL="your-supabase-url"
export SUPABASE_KEY="your-supabase-service-key"
export OPENROUTER_API_KEY="your-openrouter-key"
export OPENAI_API_KEY="your-openai-key"  # for embeddings

# Run SQL migrations
psql $DATABASE_URL < sql/001_create_agent_memories.sql
psql $DATABASE_URL < sql/002_match_memories_function.sql

# Start IngestAgent
pm2 start scripts/ingest-agent/index.mjs --name ingest-agent

# Register ConsolidateAgent cron (via OpenClaw)
# See docs/ARCHITECTURE.md for cron config
```

---

## Proof It's Working

| Signal | What to check |
|---|---|
| Session primer | Every session starts with "Memory primed — N entries, last consolidation Xm ago" |
| Weekly report | Sunday Telegram with health stats |
| `/memory` command | Ask `/memory [topic]` → get cited answer |
| Instinct confidence | Scores change over time in instincts.json |
| Zero manual writes | Weekly audit shows 0 primitive writes |

**If any signal is missing → system is broken. Alert immediately.**

---

## License

MIT — built by SKYNET Cyberdin Systems for Patrick Abedin.

*"The best memory is the one that never forgets to remember."*
