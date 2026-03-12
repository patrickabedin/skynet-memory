# Implementation Stories

Full PRD: `/root/.openclaw/workspace/PRD-memory-consolidation.md`

## Story 1 — Supabase Table + IngestAgent ✅ In Progress
**Estimate:** 4-5 hours
- Create `agent_memories` table with pgvector
- Create `match_memories` SQL function
- Build IngestAgent (PM2, port 3847)
- File watcher for `memory/YYYY-MM-DD.md`
- Haiku extraction: entities, topics, importance
- text-embedding-3-small embeddings
- HTTP API: POST /ingest, GET /status

## Story 2 — ConsolidateAgent Cron
**Estimate:** 3-4 hours
- OpenClaw cron: every 30min, isolated agentTurn, Haiku hardcoded
- Query `WHERE consolidated = false`
- Find connections between new entries
- Generate insights → update instincts.json
- Mark entries `consolidated = true`
- Lock file to prevent double-runs
- Exit immediately if 0 entries (zero cost)

## Story 3 — QueryAgent + Telegram `/memory`
**Estimate:** 2-3 hours
- Embed query → pgvector cosine search
- Haiku synthesis with source citations
- Telegram command: `/memory [query]`
- Response time target: <10 seconds
- "No relevant memory found" when 0 results (no hallucination)

## Story 4 — Trade Outcome Ingestion
**Estimate:** 2-3 hours
- Supabase realtime subscription on `v4_trades` (status = 'closed')
- Also: `v3_trades` closed positions
- Format: coin, direction, entry/exit, PnL, hold duration, strategy
- Importance scoring: large wins/losses = 0.8+, normal = 0.5
- Tags: win/loss, strategy name, coin, regime

## Story 5 — Auto-Promotion to MEMORY.md
**Estimate:** 2 hours
- ConsolidateAgent: after generating insights, check importance
- If insight importance > 0.8 AND not already promoted → append to MEMORY.md
- Mark `promoted = true`, set `promoted_at`
- Format: clean markdown section with source citations
- Dedup: don't promote same insight twice

## Story 6 — Session Auto-Export (CRITICAL)
**Estimate:** 3-4 hours
- OpenClaw cron: every 60min, isolated Haiku
- Read last N messages from main session via `sessions_history`
- Extract: decisions, corrections, insights, trade discussions
- Skip: casual chat, heartbeat acks, routine tool calls
- POST to IngestAgent API (port 3847)
- Content hash dedup: same exchange never ingested twice
- source_type: `session_export`

## Story 7 — Outcome Feedback Loop
**Estimate:** 3-4 hours
- On trade close: match against instincts.json (coin + direction + RSI range)
- Win → confidence += 0.05 (max 1.0)
- Loss → confidence -= 0.10 (min 0.0)
- confidence < 0.30 → flag `status: "review"` → Telegram alert
- confidence < 0.10 → auto-archive → Telegram alert: "Instinct retired: [content]"

## Story 8 — Session Primer
**Estimate:** 2-3 hours
- On main session start → QueryAgent runs silently
- Fetch: last consolidation time, total entries, top 3 instincts by confidence, last 24h entries
- Prepend to first message: "Memory primed — N entries | last consolidation: Xm ago | N new instincts"
- If memory system down → alert Patrick immediately
- Absence of primer line = system broken

## Story 9 — Proactive Memory Surfacing
**Estimate:** 3-4 hours
- Before trade alert → QueryAgent: "what do we know about [COIN] [DIRECTION]?"
- If similarity > 0.80 → prepend to alert: "⚠️ Memory: [relevant past context]"
- Before config change → QueryAgent: "have we tried this before?"
- Before bug fix → QueryAgent: "is this a known recurring class?"
- If no relevant memory → proceed silently (no noise)

## Story 10 — Memory Decay + Weekly Audit
**Estimate:** 2-3 hours
- Weekly cron: Sunday 02:00 UTC, isolated Haiku
- Archive: `created_at < 90 days AND importance < 0.4 AND consolidated = true`
- Compress archived batch → single summary entry
- Rebuild pgvector IVFFlat index after archival
- Weekly Telegram report to Patrick:
  - New memories this week
  - Consolidation run success rate
  - New instincts generated
  - Manual primitive writes (target: 0)
  - Cost this week
- Alert if: manual writes > 0, consolidation rate < 80%, cost > $0.70/week
