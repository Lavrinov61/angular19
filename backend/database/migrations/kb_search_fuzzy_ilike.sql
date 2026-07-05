-- Fix kb_search_fuzzy for Cyrillic text
-- pg_trgm doesn't work with locale C — use ILIKE-based matching instead
-- Applied: 2026-03-08

CREATE OR REPLACE FUNCTION kb_search_fuzzy(
  query_text text,
  similarity_threshold double precision DEFAULT 0.3,
  result_limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  entity_type text,
  slug text,
  name text,
  summary text,
  similarity double precision
) AS $$
BEGIN
  -- pg_trgm doesn't generate trigrams for Cyrillic with locale C
  -- Use ILIKE prefix + contains matching with scored ranking
  RETURN QUERY
  SELECT
    e.id,
    e.entity_type,
    e.slug,
    e.name,
    e.summary,
    CASE
      -- Exact prefix match scores highest
      WHEN lower(e.name) LIKE lower(query_text) || '%' THEN 0.95
      -- Word-start match
      WHEN lower(e.name) LIKE '% ' || lower(query_text) || '%' THEN 0.8
      -- Contains match
      WHEN lower(e.name) LIKE '%' || lower(query_text) || '%' THEN 0.6
      -- Tag match
      WHEN EXISTS (
        SELECT 1 FROM unnest(e.tags) t WHERE lower(t) LIKE '%' || lower(query_text) || '%'
      ) THEN 0.5
      -- Summary match
      WHEN lower(e.summary) LIKE '%' || lower(query_text) || '%' THEN 0.4
      ELSE 0.0
    END::double precision AS similarity
  FROM kb_entities e
  WHERE e.deleted_at IS NULL
    AND e.status = 'active'
    AND (
      lower(e.name) LIKE '%' || lower(query_text) || '%'
      OR lower(e.summary) LIKE '%' || lower(query_text) || '%'
      OR EXISTS (SELECT 1 FROM unnest(e.tags) t WHERE lower(t) LIKE '%' || lower(query_text) || '%')
    )
  ORDER BY similarity DESC, e.name
  LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;
