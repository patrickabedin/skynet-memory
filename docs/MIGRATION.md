# Migration Guide — Primitive → Always-On Memory

## The Problem with the Old System

The old system relied on:
- Manual writes to `memory/YYYY-MM-DD.md`
- Manual curation of `MEMORY.md`
- Manual updates to `instincts.json`
- `memory_search` tool for retrieval (keyword-based, not semantic)

**Failure modes:**
- Agent forgets to write → memory lost
- No pattern detection across sessions
- No semantic search ("find situations like this one")
- Instincts never updated based on outcomes

## Migration Phases

### Phase 1: Build (Weeks 1–2)
Stories 1–5: Core pipeline operational.

**Verification:**
```bash
# Check entries flowing in
SELECT count(*), source_type FROM agent_memories GROUP BY source_type;

# Check consolidation running
SELECT * FROM agent_memories WHERE consolidated = true LIMIT 5;

# Check instincts being generated
cat /root/.openclaw/workspace/instincts.json | jq '.generated | length'
```

**Run both systems in parallel** — old manual writes still allowed during this phase.

### Phase 2: Complete (Week 3)
Stories 6–9: Session export, feedback loop, primer, proactive surfacing.

**Verification:**
- Session starts with "Memory primed — N entries" line ✅
- `/memory [query]` returns cited answer in Telegram ✅
- Trade alerts include memory context when relevant ✅

### Phase 3: Cutover (End of Week 3)

**Remove primitive memory instructions:**

```bash
# AGENTS.md: Remove "write to memory/YYYY-MM-DD.md" section
# Replace with: "All memory writes go through IngestAgent API (port 3847)"

# SOUL.md: Add rule
echo "NEVER write memory files manually. Call POST http://localhost:3847/ingest instead." >> SOUL.md

# MEMORY.md: Mark as read-only historical reference
echo "<!-- READ-ONLY: Historical reference. New memories via agent_memories Supabase table. -->" >> MEMORY.md
```

**After cutover, `memory/YYYY-MM-DD.md` files are:**
- Still watched by IngestAgent (auto-ingested if written)
- No longer written manually by MOTHER
- Kept as historical archive

### Phase 4: Enforce (Week 4+)

Story 10 (weekly audit cron) fires. First report confirms:
```
📊 Memory Health — Week 1 Post-Cutover
✅ New memories: 142 (auto-ingested)
✅ Consolidation runs: 336/336 (100%)
✅ New instincts: 7
✅ Manual writes: 0 ← THIS IS THE PROOF
✅ Cost this week: $0.29
```

## Proof It's Working

| Signal | Check |
|---|---|
| Session primer | Every session: "Memory primed — N entries, last consolidation Xm ago" |
| Weekly Telegram | Sunday report with health stats |
| `/memory` works | `/memory HYPE RSI 75` → cited answer |
| Instinct confidence | Scores changing over time in instincts.json |
| Zero manual writes | Weekly audit: 0 primitive writes |

**If any signal is missing → system is broken. Alert MOTHER immediately.**

## Rollback Plan

If the new system fails during Phase 1–2:
1. Old system still active (parallel run) → no data loss
2. Fix the issue, re-verify
3. Do not proceed to Phase 3 until all verification checks pass

After Phase 3 cutover, rollback means:
1. Re-enable manual write instructions in AGENTS.md/SOUL.md
2. Keep `agent_memories` table (don't delete — historical data)
3. Fix the issue, re-migrate
