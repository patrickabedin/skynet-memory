-- SKYNET Memory System — Migration 002
-- Creates the semantic search function using pgvector cosine similarity

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.75,
  match_count     int   DEFAULT 10,
  filter_topics   text[] DEFAULT NULL,
  filter_tags     text[] DEFAULT NULL
)
RETURNS TABLE(
  id          text,
  content     text,
  source      text,
  source_type text,
  topics      text[],
  tags        text[],
  importance  float,
  created_at  timestamptz,
  similarity  float
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.id,
    m.content,
    m.source,
    m.source_type,
    m.topics,
    m.tags,
    m.importance,
    m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM agent_memories m
  WHERE
    m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
    AND (filter_topics IS NULL OR m.topics && filter_topics)
    AND (filter_tags   IS NULL OR m.tags   && filter_tags)
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Convenience function: search by topic only (no embedding needed)
CREATE OR REPLACE FUNCTION search_memories_by_topic(
  search_topics text[],
  min_importance float DEFAULT 0.0,
  result_limit   int   DEFAULT 20
)
RETURNS TABLE(
  id         text,
  content    text,
  source     text,
  topics     text[],
  importance float,
  created_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT id, content, source, topics, importance, created_at
  FROM agent_memories
  WHERE topics && search_topics
    AND importance >= min_importance
  ORDER BY importance DESC, created_at DESC
  LIMIT result_limit;
$$;
