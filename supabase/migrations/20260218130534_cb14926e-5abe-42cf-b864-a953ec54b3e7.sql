
-- Update search_path on relevant functions to include extensions schema
-- so vector operators resolve without schema prefix in function bodies

ALTER FUNCTION public.match_chunks(extensions.vector, float, int)
  SET search_path = public, extensions;

-- Recreate match_chunks with corrected signature & search_path
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding extensions.vector(1536),
  match_threshold FLOAT  DEFAULT 0.3,
  match_count     INT    DEFAULT 5
)
RETURNS TABLE (
  id          UUID,
  doc_id      TEXT,
  chunk_index INTEGER,
  content     TEXT,
  metadata    JSONB,
  similarity  FLOAT
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT
    rc.id,
    rc.doc_id,
    rc.chunk_index,
    rc.content,
    rc.metadata,
    1 - (rc.embedding <=> query_embedding) AS similarity
  FROM public.rag_chunks rc
  WHERE rc.embedding IS NOT NULL
    AND 1 - (rc.embedding <=> query_embedding) > match_threshold
  ORDER BY rc.embedding <=> query_embedding
  LIMIT match_count;
$$;
