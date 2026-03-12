-- SKYNET Memory System — Migration 001
-- Creates the agent_memories table with pgvector support
-- Run once against your Supabase instance

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main memory table
CREATE TABLE IF NOT EXISTS agent_memories (
  id              TEXT PRIMARY KEY,
  content         TEXT NOT NULL,
  source          TEXT NOT NULL,
  source_type     TEXT NOT NULL DEFAULT 'daily_log',
  -- source_type values: daily_log | trade_outcome | error_log | session_export | manual | insight | archive_summary
  entities        TEXT[] DEFAULT '{}',
  topics          TEXT[] DEFAULT '{}',
  tags            TEXT[] DEFAULT '{}',
  importance      FLOAT DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  consolidated    BOOLEAN DEFAULT FALSE,
  promoted        BOOLEAN DEFAULT FALSE,
  connections     JSONB DEFAULT '[]',
  embedding       vector(1536),  -- text-embedding-3-small dimensions
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  consolidated_at TIMESTAMPTZ,
  promoted_at     TIMESTAMPTZ
);

-- Fast query for unconsolidated entries (ConsolidateAgent's primary query)
CREATE INDEX IF NOT EXISTS idx_memories_unconsolidated
  ON agent_memories (consolidated, created_at)
  WHERE consolidated = FALSE;

-- GIN indexes for array filtering
CREATE INDEX IF NOT EXISTS idx_memories_topics ON agent_memories USING GIN (topics);
CREATE INDEX IF NOT EXISTS idx_memories_tags   ON agent_memories USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_memories_entities ON agent_memories USING GIN (entities);

-- IVFFlat index for approximate nearest-neighbor search
-- Note: requires at least 100 rows before this index is useful
-- Rebuild after bulk inserts: REINDEX INDEX idx_memories_embedding;
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON agent_memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Source type index for filtering by ingestion source
CREATE INDEX IF NOT EXISTS idx_memories_source_type ON agent_memories (source_type);

-- Importance index for decay queries
CREATE INDEX IF NOT EXISTS idx_memories_importance ON agent_memories (importance, created_at)
  WHERE consolidated = TRUE;
