--
-- PostgreSQL database dump
--

\restrict eltbh903NaZJC3ub0KW4vbDVJExABVIOjbyVRPRaE2ylzfaAHndFAb7QUxuSrJz

-- Dumped from database version 16.10 (Ubuntu 16.10-201-yandex.57618.c888a668ba)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgvector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgvector WITH SCHEMA public;


--
-- Name: EXTENSION pgvector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgvector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: channel_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.channel_type AS ENUM (
    'telegram',
    'vk',
    'whatsapp',
    'instagram',
    'max',
    'email',
    'web'
);


--
-- Name: kb_create_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_create_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only create version if content actually changed
  IF OLD.name IS DISTINCT FROM NEW.name
     OR OLD.summary IS DISTINCT FROM NEW.summary
     OR OLD.content IS DISTINCT FROM NEW.content
     OR OLD.metadata IS DISTINCT FROM NEW.metadata
     OR OLD.tags IS DISTINCT FROM NEW.tags
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.visibility IS DISTINCT FROM NEW.visibility
  THEN
    INSERT INTO kb_entity_versions (
      entity_id, version, name, summary, content, metadata, tags,
      status, visibility, change_type, changed_by, diff
    ) VALUES (
      OLD.id,
      OLD.version,
      OLD.name,
      OLD.summary,
      OLD.content,
      OLD.metadata,
      OLD.tags,
      OLD.status,
      OLD.visibility,
      CASE
        WHEN OLD.status != NEW.status AND NEW.status = 'archived' THEN 'archive'
        WHEN OLD.status != NEW.status AND OLD.status = 'archived' THEN 'restore'
        WHEN OLD.is_verified != NEW.is_verified AND NEW.is_verified THEN 'verify'
        WHEN NEW.source_type IN ('ai_generated', 'ai_enriched') THEN 'enrich'
        ELSE 'update'
      END,
      NEW.updated_by,
      jsonb_build_object(
        'changed_fields', (
          SELECT jsonb_object_agg(key, value)
          FROM jsonb_each(to_jsonb(NEW))
          WHERE key IN ('name', 'summary', 'content', 'metadata', 'tags', 'status', 'visibility')
            AND value IS DISTINCT FROM (to_jsonb(OLD))->key
        )
      )
    );

    -- Increment version
    NEW.version = OLD.version + 1;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: kb_metric_series(text, text, date, date, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_metric_series(p_metric_slug text, p_period_type text DEFAULT 'monthly'::text, p_from date DEFAULT ((CURRENT_DATE - '1 year'::interval))::date, p_to date DEFAULT CURRENT_DATE, p_dimensions jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(period_start date, period_end date, metric_value numeric, dimensions jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT m.period_start, m.period_end, m.metric_value, m.dimensions
  FROM kb_metrics m
  JOIN kb_metric_definitions d ON d.id = m.definition_id
  WHERE d.slug = p_metric_slug
    AND m.period_type = p_period_type
    AND m.period_start >= p_from
    AND m.period_end <= p_to
    AND (p_dimensions = '{}' OR m.dimensions @> p_dimensions)
  ORDER BY m.period_start;
END;
$$;


--
-- Name: kb_price_comparison(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_price_comparison(p_service_slug text DEFAULT NULL::text) RETURNS TABLE(service_name text, our_price numeric, competitor_name text, competitor_price numeric, price_diff_percent numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    our.name AS service_name,
    (our.metadata->>'base_price')::DECIMAL AS our_price,
    comp.name AS competitor_name,
    (comp.metadata->'pricing'->>our.slug)::DECIMAL AS competitor_price,
    ROUND(
      ((our.metadata->>'base_price')::DECIMAL - (comp.metadata->'pricing'->>our.slug)::DECIMAL)
      / NULLIF((comp.metadata->'pricing'->>our.slug)::DECIMAL, 0) * 100,
      1
    ) AS price_diff_percent
  FROM kb_entities our
  CROSS JOIN kb_entities comp
  WHERE our.entity_type = 'service'
    AND comp.entity_type = 'competitor'
    AND our.status = 'active'
    AND comp.status = 'active'
    AND our.deleted_at IS NULL
    AND comp.deleted_at IS NULL
    AND comp.metadata->'pricing' ? our.slug
    AND (p_service_slug IS NULL OR our.slug = p_service_slug)
  ORDER BY our.name, comp.name;
END;
$$;


--
-- Name: kb_search_combined(text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_search_combined(query_text text, category_filter text DEFAULT NULL::text, type_filter text DEFAULT NULL::text, result_limit integer DEFAULT 20) RETURNS TABLE(id uuid, entity_type text, slug text, name text, summary text, category_path text, search_method text, score double precision)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH fts AS (
    SELECT r.id, r.entity_type, r.slug, r.name, r.summary,
           r.category_path, 'fts'::TEXT AS search_method,
           r.rank::FLOAT AS score
    FROM kb_search_text(query_text, category_filter, type_filter) r
  ),
  fuzzy AS (
    SELECT e.id, e.entity_type, e.slug, e.name, e.summary,
           c.path AS category_path, 'fuzzy'::TEXT AS search_method,
           similarity(e.name, query_text)::FLOAT * 0.5 AS score  -- lower weight for fuzzy
    FROM kb_entities e
    JOIN kb_categories c ON c.id = e.category_id
    WHERE e.deleted_at IS NULL AND e.status = 'active'
      AND similarity(e.name, query_text) >= 0.3
      AND (category_filter IS NULL OR c.path LIKE category_filter || '%')
      AND (type_filter IS NULL OR e.entity_type = type_filter)
      AND e.id NOT IN (SELECT fts.id FROM fts)
  ),
  combined AS (
    SELECT * FROM fts
    UNION ALL
    SELECT * FROM fuzzy
  )
  SELECT * FROM combined
  ORDER BY score DESC
  LIMIT result_limit;
END;
$$;


--
-- Name: kb_search_fuzzy(text, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_search_fuzzy(query_text text, similarity_threshold double precision DEFAULT 0.3, result_limit integer DEFAULT 10) RETURNS TABLE(id uuid, entity_type text, slug text, name text, summary text, similarity double precision)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  -- pg_trgm doesn't work with Cyrillic on locale C
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
$$;


--
-- Name: kb_search_semantic(public.vector, double precision, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_search_semantic(query_embedding public.vector, similarity_threshold double precision DEFAULT 0.7, category_filter text DEFAULT NULL::text, type_filter text DEFAULT NULL::text, result_limit integer DEFAULT 20) RETURNS TABLE(id uuid, entity_type text, slug text, name text, summary text, category_path text, similarity double precision)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.entity_type, e.slug, e.name, e.summary,
    c.path,
    (1 - (e.embedding <=> query_embedding))::FLOAT AS similarity
  FROM kb_entities e
  JOIN kb_categories c ON c.id = e.category_id
  WHERE e.embedding IS NOT NULL
    AND e.deleted_at IS NULL
    AND e.status = 'active'
    AND (category_filter IS NULL OR c.path LIKE category_filter || '%')
    AND (type_filter IS NULL OR e.entity_type = type_filter)
    AND (1 - (e.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT result_limit;
END;
$$;


--
-- Name: kb_search_text(text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_search_text(query_text text, category_filter text DEFAULT NULL::text, type_filter text DEFAULT NULL::text, status_filter text DEFAULT 'active'::text, result_limit integer DEFAULT 20, result_offset integer DEFAULT 0) RETURNS TABLE(id uuid, entity_type text, slug text, name text, summary text, category_path text, tags text[], confidence numeric, is_verified boolean, rank real, headline text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.entity_type, e.slug, e.name, e.summary,
    c.path, e.tags, e.confidence, e.is_verified,
    ts_rank_cd(e.search_vector, websearch_to_tsquery('russian', query_text)) AS rank,
    ts_headline('russian', COALESCE(e.summary, e.name),
                websearch_to_tsquery('russian', query_text),
                'MaxWords=50, MinWords=20, StartSel=**, StopSel=**') AS headline
  FROM kb_entities e
  JOIN kb_categories c ON c.id = e.category_id
  WHERE e.search_vector @@ websearch_to_tsquery('russian', query_text)
    AND e.deleted_at IS NULL
    AND (status_filter IS NULL OR e.status = status_filter)
    AND (category_filter IS NULL OR c.path LIKE category_filter || '%')
    AND (type_filter IS NULL OR e.entity_type = type_filter)
  ORDER BY rank DESC
  LIMIT result_limit OFFSET result_offset;
END;
$$;


--
-- Name: kb_update_category_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_update_category_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE kb_categories SET entity_count = entity_count + 1 WHERE id = NEW.category_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE kb_categories SET entity_count = entity_count - 1 WHERE id = OLD.category_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.category_id != NEW.category_id THEN
    UPDATE kb_categories SET entity_count = entity_count - 1 WHERE id = OLD.category_id;
    UPDATE kb_categories SET entity_count = entity_count + 1 WHERE id = NEW.category_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: kb_update_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_update_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector = (
    setweight(to_tsvector('russian', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('russian', COALESCE(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('russian', COALESCE(NEW.content, '')), 'C') ||
    setweight(to_tsvector('russian', COALESCE(array_to_string(NEW.tags, ' '), '')), 'B')
  );
  RETURN NEW;
END;
$$;


--
-- Name: kb_update_source_entity_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_update_source_entity_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE kb_data_sources SET entity_count = entity_count + 1 WHERE id = NEW.source_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE kb_data_sources SET entity_count = entity_count - 1 WHERE id = OLD.source_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: kb_update_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: notify_conversion_task_new(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_conversion_task_new() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify('conversion_tasks_new', json_build_object(
    'id', NEW.id,
    'job_id', NEW.job_id,
    'source_type', NEW.source_type
  )::text);
  RETURN NEW;
END;
$$;


--
-- Name: notify_pos_transaction_new(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_pos_transaction_new() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM pg_notify('pos_transactions_new', json_build_object(
      'id', NEW.id,
      'studio_id', NEW.studio_id,
      'agent_id', NEW.agent_id,
      'transaction_type', NEW.transaction_type,
      'amount', NEW.amount,
      'status', NEW.status
    )::text);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: notify_print_job_new(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_print_job_new() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify('print_jobs_new', json_build_object(
    'id', NEW.id,
    'printer_id', NEW.printer_id,
    'studio_id', NEW.studio_id,
    'status', NEW.status
  )::text);
  RETURN NEW;
END;
$$;


--
-- Name: notify_print_job_retry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_print_job_retry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'queued' AND OLD.status != 'queued' THEN
    PERFORM pg_notify('print_jobs_new', json_build_object(
      'id', NEW.id,
      'printer_id', NEW.printer_id,
      'studio_id', NEW.studio_id,
      'status', NEW.status
    )::text);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: on_print_jobs_all_done(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_print_jobs_all_done() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only act when status transitions to a terminal state
  IF NEW.status NOT IN ('completed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Only act if there's an order_id linked
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if ALL print_jobs for this order are in terminal state
  -- If none remain in non-terminal state, mark order as 'ready'
  UPDATE photo_print_orders
  SET status = 'ready',
      updated_at = NOW()
  WHERE order_id = NEW.order_id
    AND status = 'processing'
    AND NOT EXISTS (
      SELECT 1 FROM print_jobs
      WHERE order_id = NEW.order_id
        AND status NOT IN ('completed', 'cancelled')
    );

  RETURN NEW;
END;
$$;


--
-- Name: resolve_conversation_id(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_conversation_id(p_id text) RETURNS uuid
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_uuid UUID;
  v_result UUID;
BEGIN
  -- Try to cast input to UUID
  BEGIN
    v_uuid := p_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  -- Direct ID lookup
  SELECT id INTO v_result FROM conversations WHERE id = v_uuid;
  IF v_result IS NOT NULL THEN
    RETURN v_result;
  END IF;

  -- Fallback: legacy_session_id lookup
  SELECT id INTO v_result
  FROM conversations
  WHERE legacy_session_id = v_uuid
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN v_result;
END;
$$;


--
-- Name: set_visitor_chat_cart_items_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_visitor_chat_cart_items_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: staff_chat_auto_leave_on_deactivation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_chat_auto_leave_on_deactivation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.is_active = true AND NEW.is_active = false THEN
    -- Deactivated: leave all chats
    UPDATE staff_conversation_participants
    SET left_at = NOW()
    WHERE user_id = NEW.id
      AND left_at IS NULL;
  ELSIF OLD.is_active = false AND NEW.is_active = true THEN
    -- Reactivated: auto-rejoin general chat only
    UPDATE staff_conversation_participants
    SET left_at = NULL
    WHERE user_id = NEW.id
      AND conversation_id IN (SELECT id FROM staff_conversations WHERE type = 'general' AND deleted_at IS NULL)
      AND left_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: trg_chat_msg_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_chat_msg_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE visitor_chat_sessions SET
    message_count = GREATEST(message_count - 1, 0),
    unread_count = CASE WHEN OLD.sender_type = 'visitor' AND OLD.is_read = false THEN GREATEST(unread_count - 1, 0) ELSE unread_count END,
    updated_at = NOW()
  WHERE id = OLD.session_id;
  RETURN OLD;
END;
$$;


--
-- Name: trg_chat_msg_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_chat_msg_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE visitor_chat_sessions SET
    message_count = message_count + 1,
    unread_count = CASE WHEN NEW.sender_type = 'visitor' THEN unread_count + 1 ELSE unread_count END,
    last_message_content = NEW.content,
    last_message_at = COALESCE(NEW.created_at, NOW()),
    updated_at = NOW()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;


--
-- Name: trg_marketing_campaigns_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_marketing_campaigns_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_agents_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_agents_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_conversation_counters(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_conversation_counters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE conversations SET
      message_count = COALESCE(message_count, 0) + 1,
      last_message_content = NEW.content,
      last_message_at = NEW.created_at,
      unread_count = CASE
        WHEN NEW.sender_type = 'visitor' THEN COALESCE(unread_count, 0) + 1
        ELSE unread_count
      END,
      updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE conversations SET
      message_count = GREATEST(0, COALESCE(message_count, 0) - 1),
      unread_count = CASE
        WHEN OLD.sender_type = 'visitor' THEN GREATEST(0, COALESCE(unread_count, 0) - 1)
        ELSE unread_count
      END,
      updated_at = NOW()
    WHERE id = OLD.conversation_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_conversations_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_conversations_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_customers_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customers_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_outbound_queue_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_outbound_queue_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_partner_commission_rules_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_partner_commission_rules_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_photographer_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_photographer_rating() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    avg_rating NUMERIC;
    total_reviews INTEGER;
BEGIN
    SELECT 
        COALESCE(AVG(rating), 0),
        COUNT(*)
    INTO avg_rating, total_reviews
    FROM reviews
    WHERE photographer_id = COALESCE(NEW.photographer_id, OLD.photographer_id);

    UPDATE photographers
    SET rating = jsonb_build_object(
        'average', ROUND(avg_rating::numeric, 2),
        'totalReviews', total_reviews
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE id = COALESCE(NEW.photographer_id, OLD.photographer_id);

    RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: update_session_last_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_session_last_message() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE visitor_chat_sessions 
    SET last_message_at = NEW.created_at
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$;


--
-- Name: update_staff_conv_last_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_staff_conv_last_message() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE staff_conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(NEW.content, 100)
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;


--
-- Name: update_studio_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_studio_rating() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    avg_rating NUMERIC;
    total_reviews INTEGER;
BEGIN
    SELECT 
        COALESCE(AVG(rating), 0),
        COUNT(*)
    INTO avg_rating, total_reviews
    FROM studio_reviews
    WHERE studio_id = COALESCE(NEW.studio_id, OLD.studio_id);

    UPDATE studios
    SET rating = jsonb_build_object(
        'average', ROUND(avg_rating::numeric, 2),
        'totalReviews', total_reviews
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE id = COALESCE(NEW.studio_id, OLD.studio_id);

    RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_visitor_push_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_visitor_push_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_visitor_session_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_visitor_session_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    studio_id uuid NOT NULL,
    agent_type character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    hostname character varying(255),
    current_version character varying(20),
    target_version character varying(20),
    mqtt_username character varying(100) NOT NULL,
    mqtt_password_hash character varying(255) NOT NULL,
    is_online boolean DEFAULT false,
    last_heartbeat_at timestamp with time zone,
    last_connected_at timestamp with time zone,
    last_disconnected_at timestamp with time zone,
    os_version character varying(100),
    os_arch character varying(20),
    config_version integer DEFAULT 0,
    desired_config jsonb DEFAULT '{}'::jsonb,
    applied_config jsonb DEFAULT '{}'::jsonb,
    uptime_seconds bigint DEFAULT 0,
    last_restart_reason character varying(200),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT agents_agent_type_check CHECK (((agent_type)::text = ANY ((ARRAY['print'::character varying, 'pos'::character varying, 'vision'::character varying, 'monitor'::character varying, 'guard'::character varying])::text[])))
);


--
-- Name: agent_fleet_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.agent_fleet_status AS
 SELECT agent_type,
    current_version,
    count(*) AS total,
    count(*) FILTER (WHERE is_online) AS online,
    count(*) FILTER (WHERE (NOT is_online)) AS offline,
    count(*) FILTER (WHERE ((target_version IS NOT NULL) AND ((target_version)::text <> (current_version)::text))) AS pending_update
   FROM public.agents a
  WHERE is_active
  GROUP BY agent_type, current_version;


--
-- Name: agent_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_releases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_type character varying(20) NOT NULL,
    version character varying(20) NOT NULL,
    platform character varying(20) NOT NULL,
    artifact_url text NOT NULL,
    artifact_hash_sha256 character varying(64) NOT NULL,
    artifact_size_bytes bigint NOT NULL,
    release_notes text,
    is_stable boolean DEFAULT false,
    min_os_version character varying(50),
    released_by uuid,
    released_at timestamp with time zone DEFAULT now(),
    promoted_at timestamp with time zone,
    download_count integer DEFAULT 0,
    CONSTRAINT agent_releases_agent_type_check CHECK (((agent_type)::text = ANY ((ARRAY['print'::character varying, 'pos'::character varying, 'vision'::character varying, 'monitor'::character varying])::text[]))),
    CONSTRAINT agent_releases_platform_check CHECK (((platform)::text = ANY ((ARRAY['windows_x64'::character varying, 'linux_x64'::character varying, 'linux_arm64'::character varying])::text[])))
);


--
-- Name: agent_update_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_update_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    release_id uuid NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    error_message text,
    previous_version character varying(20),
    rollback_url text,
    initiated_by uuid,
    initiated_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    progress_percent integer DEFAULT 0,
    rollout_id uuid,
    scheduled_at timestamp with time zone,
    CONSTRAINT agent_update_commands_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'downloading'::character varying, 'installing'::character varying, 'completed'::character varying, 'failed'::character varying, 'rolled_back'::character varying])::text[])))
);


--
-- Name: ai_retouch_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_retouch_jobs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    approval_session_id uuid NOT NULL,
    source_photo_id uuid,
    source_photo_url text NOT NULL,
    operations jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying,
    current_operation integer DEFAULT 0,
    total_operations integer DEFAULT 0,
    intermediate_urls jsonb DEFAULT '[]'::jsonb,
    result_url text,
    result_thumbnail_url text,
    result_photo_id uuid,
    cost_estimate_usd numeric(8,5) DEFAULT 0,
    actual_cost_usd numeric(8,5) DEFAULT 0,
    error text,
    error_operation integer,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT ai_retouch_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_type character varying(20),
    alert_type character varying(50) NOT NULL,
    severity character varying(10) NOT NULL,
    condition_config jsonb NOT NULL,
    notification_channels jsonb DEFAULT '["telegram"]'::jsonb,
    cooldown_minutes integer DEFAULT 30,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT alert_rules_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: app_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_events (
    id bigint NOT NULL,
    event_name character varying(100) NOT NULL,
    screen character varying(100),
    properties jsonb DEFAULT '{}'::jsonb,
    user_id character varying(50),
    visitor_id character varying(50) NOT NULL,
    session_id character varying(50) NOT NULL,
    app_version character varying(20),
    platform character varying(20) DEFAULT 'android'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: app_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_events_id_seq OWNED BY public.app_events.id;


--
-- Name: app_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_logs (
    id integer NOT NULL,
    level character varying(10) NOT NULL,
    message text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb,
    app_version character varying(20),
    device_info character varying(255),
    visitor_id character varying(64),
    created_at timestamp without time zone DEFAULT now(),
    source character varying(20) DEFAULT 'frontend'::character varying,
    service character varying(100),
    user_id uuid,
    url text,
    http_status integer,
    http_method character varying(10),
    http_url text,
    stack_trace text,
    fingerprint character varying(64)
);


--
-- Name: app_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_logs_id_seq OWNED BY public.app_logs.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    user_name character varying(255),
    action character varying(50) NOT NULL,
    entity_type character varying(30) NOT NULL,
    entity_id character varying(100),
    details jsonb DEFAULT '{}'::jsonb,
    ip character varying(45),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: behavior_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.behavior_events (
    id bigint NOT NULL,
    session_id uuid NOT NULL,
    visitor_id character varying(64) NOT NULL,
    event_type character varying(50) NOT NULL,
    event_category character varying(30),
    page_path text,
    page_title text,
    element_selector text,
    element_text text,
    value_numeric numeric,
    value_text text,
    properties jsonb DEFAULT '{}'::jsonb,
    click_x integer,
    click_y integer,
    viewport_width integer,
    viewport_height integer,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    time_on_page_ms integer
);


--
-- Name: behavior_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.behavior_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: behavior_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.behavior_events_id_seq OWNED BY public.behavior_events.id;


--
-- Name: booking_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    old_status character varying(20),
    new_status character varying(20) NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_by uuid
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id uuid,
    photographer_id uuid,
    service_id character varying(255),
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    price jsonb DEFAULT '{}'::jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    studio_id uuid,
    client_name character varying(255),
    client_phone character varying(20),
    service_name character varying(255),
    source character varying(20) DEFAULT 'crm'::character varying,
    client_email character varying(255),
    confirmation_sent_at timestamp with time zone,
    reminder_24h_sent_at timestamp with time zone,
    reminder_1h_sent_at timestamp with time zone,
    partner_promo_code character varying(50),
    service_category_slug character varying(100),
    CONSTRAINT bookings_source_check CHECK (((source)::text = ANY ((ARRAY['crm'::character varying, 'website'::character varying, 'telegram'::character varying, 'phone'::character varying, 'walk_in'::character varying, 'photographer_page'::character varying])::text[]))),
    CONSTRAINT bookings_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('confirmed'::character varying)::text, ('cancelled'::character varying)::text, ('completed'::character varying)::text, ('no-show'::character varying)::text])))
);


--
-- Name: bot_message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bot_message_templates (
    event_type character varying(80) NOT NULL,
    content text NOT NULL,
    description character varying(255),
    is_active boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: bridge_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bridge_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    studio_id uuid,
    api_key character varying(128) NOT NULL,
    name character varying(100) NOT NULL,
    hostname character varying(255),
    bridge_version character varying(50),
    os_version character varying(100),
    is_online boolean DEFAULT false,
    last_connected_at timestamp with time zone,
    last_disconnected_at timestamp with time zone,
    last_heartbeat_at timestamp with time zone,
    mqtt_username character varying(100) NOT NULL,
    mqtt_password_hash character varying(255) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    agent_type character varying(20) DEFAULT 'pos_bridge'::character varying,
    cups_version character varying(50)
);


--
-- Name: broadcast_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcast_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    user_name text,
    channels text[] NOT NULL,
    message text NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    queued integer DEFAULT 0 NOT NULL,
    dry_run boolean DEFAULT false NOT NULL,
    min_last_activity date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: call_entity_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_entity_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_log_id uuid NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id character varying(100) NOT NULL
);


--
-- Name: call_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voximplant_session_id character varying(100),
    direction character varying(10) NOT NULL,
    caller_number character varying(20),
    called_number character varying(20),
    client_user_id uuid,
    operator_user_id uuid,
    status character varying(20) DEFAULT 'ringing'::character varying,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_seconds integer,
    recording_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT call_logs_direction_check CHECK (((direction)::text = ANY (ARRAY[('inbound'::character varying)::text, ('outbound'::character varying)::text])))
);


--
-- Name: cameras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cameras (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    studio_id uuid NOT NULL,
    agent_id uuid,
    name character varying(100) NOT NULL,
    camera_type character varying(20),
    rtsp_url text,
    onvif_url text,
    location_description character varying(200),
    is_online boolean DEFAULT false,
    last_snapshot_at timestamp with time zone,
    motion_detection_enabled boolean DEFAULT false,
    motion_sensitivity integer DEFAULT 50,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT cameras_camera_type_check CHECK (((camera_type)::text = ANY ((ARRAY['ip'::character varying, 'usb'::character varying, 'rtsp'::character varying])::text[])))
);


--
-- Name: campaign_promo_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_promo_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    promotion_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE campaign_promo_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.campaign_promo_codes IS 'Связь маркетинговых кампаний с промоакциями (M:N)';


--
-- Name: cdr_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cdr_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    date date NOT NULL,
    files_scanned integer DEFAULT 0,
    files_cleaned integer DEFAULT 0,
    files_quarantined integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: channel_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel public.channel_type NOT NULL,
    name character varying(200) NOT NULL,
    is_active boolean DEFAULT true,
    credentials jsonb DEFAULT '{}'::jsonb NOT NULL,
    rate_limit_max integer DEFAULT 30,
    rate_limit_duration_ms integer DEFAULT 1000,
    capabilities jsonb DEFAULT '{}'::jsonb,
    token_expires_at timestamp with time zone,
    token_refreshed_at timestamp with time zone,
    webhook_url text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_health_check_at timestamp with time zone,
    health_check_ok boolean,
    health_check_error text
);


--
-- Name: COLUMN channel_accounts.last_health_check_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.channel_accounts.last_health_check_at IS 'Timestamp of last active health probe';


--
-- Name: COLUMN channel_accounts.health_check_ok; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.channel_accounts.health_check_ok IS 'Result of last credential verification';


--
-- Name: COLUMN channel_accounts.health_check_error; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.channel_accounts.health_check_error IS 'Error message from last failed health probe';


--
-- Name: channel_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel character varying(20) NOT NULL,
    external_user_id character varying(255) NOT NULL,
    display_name character varying(255),
    username character varying(255),
    phone character varying(20),
    customer_id uuid,
    opted_in boolean DEFAULT true,
    opted_in_at timestamp with time zone,
    opted_out_at timestamp with time zone,
    raw_profile jsonb DEFAULT '{}'::jsonb,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    contact_id uuid,
    user_id uuid,
    verified_at timestamp with time zone,
    linked_by character varying(20) DEFAULT 'auto'::character varying
);


--
-- Name: chat_followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_followups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    operator_id uuid NOT NULL,
    follow_up_at timestamp with time zone NOT NULL,
    note text,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chat_followups_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('done'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: chat_order_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_order_number_seq
    START WITH 1001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_quick_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_quick_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trigger_keywords text[],
    category character varying(50),
    title character varying(100) NOT NULL,
    content text NOT NULL,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid
);


--
-- Name: TABLE chat_quick_replies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.chat_quick_replies IS 'Быстрые ответы для бота и операторов';


--
-- Name: chat_session_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_session_number_seq
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(50) NOT NULL,
    color character varying(20) DEFAULT '#757575'::character varying NOT NULL,
    icon character varying(30),
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_task_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_task_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    chat_session_id uuid,
    bitrix_chat_id character varying(100),
    messenger_type character varying(20),
    linked_at timestamp with time zone DEFAULT now(),
    linked_by uuid
);


--
-- Name: client_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_phone character varying(20) NOT NULL,
    author_id uuid NOT NULL,
    text text NOT NULL,
    pinned boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: combo_package_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combo_package_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    combo_package_id uuid NOT NULL,
    service_option_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0
);


--
-- Name: combo_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combo_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    combo_price numeric(10,2) NOT NULL,
    original_total numeric(10,2),
    savings_label character varying(100),
    display_channels text[] DEFAULT '{crm,pos}'::text[],
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: consumable_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumable_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_option_id uuid NOT NULL,
    product_stock_id uuid NOT NULL,
    quantity_per_unit numeric(10,3) NOT NULL,
    unit_label character varying(50),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: consumable_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumable_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    station_id uuid NOT NULL,
    consumable_type character varying(50) NOT NULL,
    current_amount double precision DEFAULT 0 NOT NULL,
    max_capacity double precision,
    unit character varying(20) DEFAULT 'ml'::character varying NOT NULL,
    low_threshold double precision,
    cost_per_unit double precision,
    last_refilled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: consumable_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumable_transactions (
    id bigint NOT NULL,
    stock_id uuid NOT NULL,
    job_id uuid,
    transaction_type character varying(20) NOT NULL,
    amount double precision NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT consumable_transactions_transaction_type_check CHECK (((transaction_type)::text = ANY ((ARRAY['usage'::character varying, 'refill'::character varying, 'adjustment'::character varying, 'waste'::character varying])::text[])))
);


--
-- Name: consumable_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.consumable_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: consumable_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.consumable_transactions_id_seq OWNED BY public.consumable_transactions.id;


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name character varying(255),
    phone character varying(20),
    email character varying(255),
    user_id uuid,
    source character varying(30) NOT NULL,
    avatar_url text,
    metadata jsonb DEFAULT '{}'::jsonb,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: conversation_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    tag character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel public.channel_type NOT NULL,
    account_id uuid,
    external_chat_id character varying(255),
    contact_id uuid,
    user_id uuid,
    visitor_id character varying(64),
    visitor_name character varying(200),
    visitor_phone character varying(20),
    visitor_email character varying(255),
    status character varying(20) DEFAULT 'open'::character varying,
    assigned_operator_id uuid,
    source character varying(20) DEFAULT 'web'::character varying,
    entry_context jsonb DEFAULT '{}'::jsonb,
    page_url character varying(500),
    selected_service character varying(100),
    selected_price integer,
    message_count integer DEFAULT 0,
    unread_count integer DEFAULT 0,
    last_message_content text,
    last_message_at timestamp with time zone,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    csat_score smallint,
    csat_comment text,
    context jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    booking_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    user_agent text,
    ip_address inet,
    legacy_session_id uuid,
    csat_submitted_at timestamp with time zone,
    session_number integer,
    auto_reply_sent boolean DEFAULT false,
    CONSTRAINT conversations_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'waiting'::character varying, 'active'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: conversations_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations_archive (
    id uuid NOT NULL,
    channel public.channel_type,
    account_id uuid,
    external_chat_id character varying(255),
    contact_id uuid,
    user_id uuid,
    visitor_id character varying(64),
    visitor_name character varying(200),
    visitor_phone character varying(20),
    visitor_email character varying(255),
    status character varying(20),
    assigned_operator_id uuid,
    source character varying(20),
    entry_context jsonb,
    page_url character varying(500),
    selected_service character varying(100),
    selected_price integer,
    message_count integer,
    unread_count integer,
    last_message_content text,
    last_message_at timestamp with time zone,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    csat_score smallint,
    csat_comment text,
    context jsonb,
    metadata jsonb,
    booking_id uuid,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    closed_at timestamp with time zone,
    user_agent text,
    ip_address inet,
    legacy_session_id uuid,
    csat_submitted_at timestamp with time zone
);


--
-- Name: conversion_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversion_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    source_url text NOT NULL,
    source_type character varying(10) NOT NULL,
    pages integer[],
    dpi integer DEFAULT 300 NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    error_message text,
    total_pages integer,
    converted_pages integer DEFAULT 0,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT conversion_tasks_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['pdf'::character varying, 'docx'::character varying, 'xlsx'::character varying, 'doc'::character varying, 'xls'::character varying])::text[]))),
    CONSTRAINT conversion_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'downloading'::character varying, 'converting_to_pdf'::character varying, 'rendering'::character varying, 'uploading'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: crm_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_files (
    id integer NOT NULL,
    uuid character varying(36) NOT NULL,
    filename character varying(255) NOT NULL,
    original_name character varying(500) NOT NULL,
    mime_type character varying(100) NOT NULL,
    size_bytes bigint NOT NULL,
    storage_path text NOT NULL,
    entity_type character varying(50),
    entity_id character varying(100),
    uploaded_by uuid,
    is_public boolean DEFAULT false,
    tags text[] DEFAULT '{}'::text[],
    clamav_status character varying(20) DEFAULT 'pending'::character varying,
    clamav_result text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT crm_files_clamav_status_check CHECK (((clamav_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('clean'::character varying)::text, ('infected'::character varying)::text, ('error'::character varying)::text, ('skipped'::character varying)::text])))
);


--
-- Name: crm_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crm_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crm_files_id_seq OWNED BY public.crm_files.id;


--
-- Name: crm_inbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_inbox (
    type text NOT NULL,
    id text NOT NULL,
    client_name character varying,
    client_phone character varying(20),
    preview text,
    status character varying,
    priority integer DEFAULT 2 NOT NULL,
    sort_time timestamp with time zone,
    channel text,
    assigned_to text,
    assigned_to_name text,
    unread boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: photo_approval_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photo_approval_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    public_token character varying(64) NOT NULL,
    client_name character varying(255),
    client_phone character varying(20),
    client_id uuid,
    photographer_id uuid NOT NULL,
    order_id uuid,
    task_id uuid,
    status character varying(30) DEFAULT 'pending'::character varying,
    title character varying(255),
    description text,
    deadline timestamp with time zone,
    total_photos integer DEFAULT 0,
    approved_count integer DEFAULT 0,
    rejected_count integer DEFAULT 0,
    link_sent_via character varying(20),
    link_sent_at timestamp with time zone,
    first_viewed_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    chat_session_id uuid,
    sla_hours integer DEFAULT 48,
    expired_at timestamp with time zone,
    reminder_sent_at timestamp with time zone,
    original_photo_url text,
    original_thumbnail_url text,
    current_revision_round integer DEFAULT 1,
    contact_id uuid,
    download_expires_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT photo_approval_sessions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_review'::character varying, 'approved'::character varying, 'partially_approved'::character varying, 'changes_requested'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: photo_print_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photo_print_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id character varying(50) NOT NULL,
    mode character varying(20) NOT NULL,
    contact_name character varying(255),
    contact_phone character varying(20),
    contact_email character varying(255),
    comments text,
    total_price numeric(10,2),
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(50) DEFAULT 'new'::character varying,
    processed_by uuid,
    processed_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    payment_status character varying(50) DEFAULT 'none'::character varying,
    payment_id character varying(100),
    payment_amount numeric(10,2),
    paid_at timestamp with time zone,
    receipt_url text,
    payment_card_info character varying(100),
    telegram_user_id bigint,
    telegram_username character varying(255),
    chat_session_id uuid,
    fail_reason text,
    delivery_cost numeric(10,2) DEFAULT 0,
    delivery_address text,
    delivery_postal_code character varying(10),
    tracking_number character varying(50),
    shipment_id character varying(100),
    shipment_status character varying(50) DEFAULT 'none'::character varying,
    label_url text,
    shipment_created_at timestamp with time zone,
    shipment_weight_grams integer,
    promo_code character varying(50),
    promo_discount numeric(10,2) DEFAULT 0,
    reminder_sent_at timestamp with time zone,
    final_reminder_sent_at timestamp with time zone,
    priority character varying(10) DEFAULT 'normal'::character varying NOT NULL,
    assigned_employee_id uuid,
    assigned_at timestamp with time zone,
    customer_id uuid,
    service_type character varying(100),
    delivery_method character varying(20) DEFAULT 'electronic'::character varying,
    partner_promo_code character varying(50),
    queue_position integer,
    estimated_ready_at timestamp with time zone,
    processing_started_at timestamp with time zone,
    processing_duration_minutes integer,
    payment_reminder_sent boolean DEFAULT false,
    paid_amount numeric(10,2) DEFAULT 0,
    payment_mode character varying(20) DEFAULT 'full'::character varying,
    uniform_type character varying(100),
    photo_format character varying(50),
    campaign_id uuid,
    payment_reminder_count integer DEFAULT 0 NOT NULL,
    deadline_at timestamp with time zone,
    description text,
    source character varying(20) DEFAULT 'online'::character varying,
    tip_amount numeric(10,2) DEFAULT 0 NOT NULL,
    document_template_id uuid,
    photo_size character varying(20),
    medals_required boolean DEFAULT false,
    medals_description text,
    wishes text,
    employee_reminder jsonb DEFAULT '[]'::jsonb,
    reminder_ab_variant character varying(1),
    CONSTRAINT photo_print_orders_delivery_method_check CHECK (((delivery_method)::text = ANY (ARRAY[('electronic'::character varying)::text, ('pickup'::character varying)::text, ('postal'::character varying)::text]))),
    CONSTRAINT photo_print_orders_mode_check CHECK (((mode)::text = ANY ((ARRAY['simple'::character varying, 'custom'::character varying, 'crm'::character varying])::text[]))),
    CONSTRAINT photo_print_orders_status_check CHECK (((status)::text = ANY (ARRAY[('new'::character varying)::text, ('pending_payment'::character varying)::text, ('payment_failed'::character varying)::text, ('paid'::character varying)::text, ('processing'::character varying)::text, ('ready'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text, ('expired'::character varying)::text])))
);


--
-- Name: COLUMN photo_print_orders.campaign_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.photo_print_orders.campaign_id IS 'Маркетинговая кампания, привлёкшая этот заказ';


--
-- Name: COLUMN photo_print_orders.tip_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.photo_print_orders.tip_amount IS 'Tip/donation amount (e.g. "Support team" +39). Separate from total_price for accounting.';


--
-- Name: COLUMN photo_print_orders.reminder_ab_variant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.photo_print_orders.reminder_ab_variant IS 'A/B test variant: A=standard, B=volume+urgency';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255),
    username character varying(100),
    display_name character varying(255),
    first_name character varying(100),
    last_name character varying(100),
    phone character varying(20),
    photo_url text,
    role character varying(20) DEFAULT 'client'::character varying NOT NULL,
    email_verified boolean DEFAULT false,
    phone_verified boolean DEFAULT false,
    is_active boolean DEFAULT true,
    yandex_id character varying(255),
    yandex_email character varying(255),
    personal_data jsonb DEFAULT '{}'::jsonb,
    preferences jsonb DEFAULT '{}'::jsonb,
    linked_accounts jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    telegram_id character varying(255),
    telegram_username character varying(255),
    password_hash character varying(255),
    skills text[] DEFAULT '{}'::text[],
    last_password_change timestamp with time zone,
    force_password_change boolean DEFAULT false,
    accept_calls boolean DEFAULT false,
    two_factor_enabled boolean DEFAULT false,
    two_factor_method character varying(20),
    google_id character varying(255),
    apple_id character varying(255),
    vk_id character varying(255),
    sber_id character varying(255),
    mts_id character varying(255),
    hired_date date,
    last_seen_at timestamp with time zone,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('employee'::character varying)::text, ('manager'::character varying)::text, ('client'::character varying)::text, ('photographer'::character varying)::text]))),
    CONSTRAINT users_two_factor_method_check CHECK (((two_factor_method)::text = ANY (ARRAY[('sms'::character varying)::text, ('telegram'::character varying)::text])))
);


--
-- Name: work_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_number integer NOT NULL,
    task_type character varying(30) NOT NULL,
    order_id uuid,
    print_order_id uuid,
    booking_id uuid,
    chat_session_id uuid,
    client_id uuid,
    assigned_to uuid,
    assigned_studio_id uuid,
    priority character varying(10) DEFAULT 'normal'::character varying,
    status character varying(20) DEFAULT 'open'::character varying,
    title character varying(255) NOT NULL,
    description text,
    client_name character varying(255),
    client_phone character varying(20),
    client_channel character varying(20),
    due_date timestamp with time zone,
    ai_summary text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_by uuid,
    unified_customer_id integer,
    sla_deadline timestamp with time zone,
    CONSTRAINT work_tasks_priority_check CHECK (((priority)::text = ANY (ARRAY[('low'::character varying)::text, ('normal'::character varying)::text, ('high'::character varying)::text, ('urgent'::character varying)::text]))),
    CONSTRAINT work_tasks_status_check CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('assigned'::character varying)::text, ('in_progress'::character varying)::text, ('waiting'::character varying)::text, ('handed_off'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text]))),
    CONSTRAINT work_tasks_task_type_check CHECK (((task_type)::text = ANY (ARRAY[('photo_order'::character varying)::text, ('chat_inquiry'::character varying)::text, ('walk_in'::character varying)::text, ('callback'::character varying)::text, ('retouch'::character varying)::text, ('delivery'::character varying)::text, ('internal'::character varying)::text, ('cross_location'::character varying)::text])))
);


--
-- Name: crm_inbox_view; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.crm_inbox_view AS
 SELECT (s.id)::text AS id,
    'chat'::text AS type,
    COALESCE(ct.display_name, client_u.display_name, s.visitor_name) AS client_name,
    COALESCE(ct.phone, client_u.phone, s.visitor_phone) AS client_phone,
    COALESCE(s.last_message_content, 'Новый разговор'::text) AS preview,
    s.status,
        CASE s.status
            WHEN 'open'::text THEN 1
            WHEN 'waiting'::text THEN 2
            ELSE 3
        END AS priority,
    COALESCE(s.last_message_at, s.created_at) AS sort_time,
    (s.channel)::text AS channel,
    (s.assigned_operator_id)::text AS assigned_to,
    u_op.display_name AS assigned_to_name,
    (s.unread_count > 0) AS unread,
    jsonb_build_object('messageCount', s.message_count, 'channel', s.channel, 'createdAt', s.created_at, 'firstResponseAt', s.first_response_at, 'userId', COALESCE(ct.user_id, s.user_id), 'unreadCount', s.unread_count, 'slaStatus',
        CASE
            WHEN (s.first_response_at IS NOT NULL) THEN 'ok'::text
            WHEN (EXTRACT(epoch FROM (now() - s.created_at)) >= (300)::numeric) THEN 'breached'::text
            WHEN (EXTRACT(epoch FROM (now() - s.created_at)) >= (210)::numeric) THEN 'warning'::text
            ELSE NULL::text
        END) AS metadata
   FROM (((public.conversations s
     LEFT JOIN public.contacts ct ON ((ct.id = s.contact_id)))
     LEFT JOIN public.users client_u ON ((client_u.id = COALESCE(ct.user_id, s.user_id))))
     LEFT JOIN public.users u_op ON ((u_op.id = s.assigned_operator_id)))
  WHERE ((s.status)::text = ANY ((ARRAY['open'::character varying, 'waiting'::character varying, 'active'::character varying])::text[]))
UNION ALL
 SELECT (t.id)::text AS id,
    'task'::text AS type,
    t.client_name,
    t.client_phone,
    ((('#'::text || t.task_number) || ' '::text) || (t.title)::text) AS preview,
    t.status,
        CASE t.priority
            WHEN 'urgent'::text THEN 0
            WHEN 'high'::text THEN 1
            WHEN 'normal'::text THEN 2
            ELSE 3
        END AS priority,
    COALESCE(t.updated_at, t.created_at) AS sort_time,
    t.client_channel AS channel,
    (t.assigned_to)::text AS assigned_to,
    u.display_name AS assigned_to_name,
    false AS unread,
    jsonb_build_object('taskNumber', t.task_number, 'taskType', t.task_type, 'dueDate', t.due_date) AS metadata
   FROM (public.work_tasks t
     LEFT JOIN public.users u ON ((u.id = t.assigned_to)))
  WHERE ((t.status)::text <> ALL ((ARRAY['completed'::character varying, 'cancelled'::character varying])::text[]))
UNION ALL
 SELECT (b.id)::text AS id,
    'booking'::text AS type,
    b.client_name,
    b.client_phone,
    COALESCE(b.service_name, 'Запись'::character varying) AS preview,
    b.status,
        CASE
            WHEN ((b.start_time)::date = CURRENT_DATE) THEN 1
            ELSE 2
        END AS priority,
    b.start_time AS sort_time,
    b.source AS channel,
    NULL::text AS assigned_to,
    NULL::text AS assigned_to_name,
    false AS unread,
    jsonb_build_object('startTime', b.start_time, 'endTime', b.end_time, 'source', b.source) AS metadata
   FROM public.bookings b
  WHERE ((b.start_time > (now() - '1 day'::interval)) AND ((b.status)::text <> ALL ((ARRAY['cancelled'::character varying, 'completed'::character varying, 'no-show'::character varying])::text[])))
UNION ALL
 SELECT (o.id)::text AS id,
    'order'::text AS type,
    o.contact_name AS client_name,
    o.contact_phone AS client_phone,
    (((
        CASE
            WHEN ((o.order_id)::text ~ '^SF-'::text) THEN (o.order_id)::text
            ELSE ('Заказ #'::text || "right"((o.order_id)::text, 8))
        END || ' — '::text) || round((o.total_price)::numeric, 0)) || '₽'::text) AS preview,
    o.status,
        CASE o.priority
            WHEN 'vip'::text THEN 0
            WHEN 'urgent'::text THEN 1
            ELSE 2
        END AS priority,
    COALESCE(o.updated_at, o.created_at) AS sort_time,
    NULL::text AS channel,
    NULL::text AS assigned_to,
    NULL::text AS assigned_to_name,
    false AS unread,
    jsonb_build_object('orderId', o.order_id, 'paymentStatus', o.payment_status, 'totalPrice', o.total_price) AS metadata
   FROM public.photo_print_orders o
  WHERE ((o.status)::text <> ALL ((ARRAY['completed'::character varying, 'cancelled'::character varying])::text[]))
UNION ALL
 SELECT (s.id)::text AS id,
    'approval'::text AS type,
    s.client_name,
    s.client_phone,
    COALESCE(s.title, 'Согласование фото'::character varying) AS preview,
    s.status,
        CASE
            WHEN ((s.status)::text = ANY ((ARRAY['in_review'::character varying, 'changes_requested'::character varying])::text[])) THEN 1
            ELSE 2
        END AS priority,
    COALESCE(s.updated_at, s.created_at) AS sort_time,
    NULL::text AS channel,
    (s.photographer_id)::text AS assigned_to,
    u.display_name AS assigned_to_name,
    (((s.status)::text = ANY ((ARRAY['in_review'::character varying, 'changes_requested'::character varying])::text[])) AND (s.first_viewed_at IS NULL)) AS unread,
    jsonb_build_object('totalPhotos', s.total_photos, 'approvedCount', s.approved_count, 'rejectedCount', s.rejected_count, 'viewed', (s.first_viewed_at IS NOT NULL)) AS metadata
   FROM (public.photo_approval_sessions s
     LEFT JOIN public.users u ON ((u.id = s.photographer_id)))
  WHERE ((s.status)::text <> 'completed'::text)
  WITH NO DATA;


--
-- Name: crm_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id character varying(100) NOT NULL,
    author_id uuid,
    author_name character varying(255),
    note_type character varying(30) DEFAULT 'comment'::character varying,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: customer_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_name text,
    client_phone text,
    client_id uuid,
    employee_id uuid,
    rating smallint NOT NULL,
    service text,
    source text NOT NULL,
    entity_type text,
    entity_id uuid,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_feedback_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: TABLE customer_feedback; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_feedback IS 'Unified satisfaction signals. Sources: approval_*, review_click, order_completed, manual, nps_positive, nps_negative';


--
-- Name: customer_tag_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_tag_assignments (
    customer_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(50) NOT NULL,
    color character varying(7) DEFAULT '#6b7280'::character varying NOT NULL,
    icon character varying(50) DEFAULT 'label'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone character varying(20),
    email character varying(255),
    name character varying(255),
    visitor_ids text[] DEFAULT '{}'::text[],
    telegram_user_id bigint,
    telegram_username character varying(255),
    total_orders integer DEFAULT 0,
    total_spent numeric(10,2) DEFAULT 0,
    first_order_at timestamp with time zone,
    last_order_at timestamp with time zone,
    used_basic_promo boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: design_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.design_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid,
    name character varying(200) NOT NULL,
    category character varying(50) NOT NULL,
    width_mm double precision NOT NULL,
    height_mm double precision NOT NULL,
    canvas_json text,
    thumbnail_url text,
    editable_fields jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: document_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    name character varying(200) NOT NULL,
    category character varying(50) NOT NULL,
    country_code character varying(3) DEFAULT 'RU'::character varying,
    photo_width_mm double precision NOT NULL,
    photo_height_mm double precision NOT NULL,
    head_height_min_mm double precision,
    head_height_max_mm double precision,
    eye_line_from_bottom_mm double precision,
    background_color character varying(7) DEFAULT '#FFFFFF'::character varying,
    default_media_size character varying(30) DEFAULT '10x15'::character varying,
    photos_per_sheet integer DEFAULT 1,
    layout_rows integer DEFAULT 1,
    layout_cols integer DEFAULT 1,
    cut_margin_mm double precision DEFAULT 0,
    validation_rules jsonb DEFAULT '{}'::jsonb,
    overlay_svg text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: dynamic_pricing_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dynamic_pricing_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    config_key character varying(100) NOT NULL,
    config_value jsonb NOT NULL,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_attachments (
    id integer NOT NULL,
    email_id integer,
    crm_file_id integer,
    filename character varying(500) NOT NULL,
    mime_type character varying(100),
    size_bytes bigint,
    content_id character varying(200),
    content_disposition character varying(20) DEFAULT 'attachment'::character varying,
    s3_key text,
    storage_url text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_attachments_id_seq OWNED BY public.email_attachments.id;


--
-- Name: email_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_messages (
    id integer NOT NULL,
    direction character varying(10) NOT NULL,
    from_address text NOT NULL,
    to_address text NOT NULL,
    cc_addresses text[],
    subject text,
    body_text text,
    body_html text,
    customer_phone character varying(30),
    thread_id character varying(200),
    in_reply_to character varying(200),
    message_id character varying(200),
    entity_type character varying(50),
    entity_id character varying(100),
    status character varying(20) DEFAULT 'received'::character varying,
    sent_by uuid,
    has_attachments boolean DEFAULT false,
    attachment_count integer DEFAULT 0,
    error_message text,
    imap_uid bigint,
    imap_folder character varying(100) DEFAULT 'INBOX'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    raw_source_key text,
    is_bounce boolean DEFAULT false,
    CONSTRAINT email_messages_direction_check CHECK (((direction)::text = ANY (ARRAY[('inbound'::character varying)::text, ('outbound'::character varying)::text]))),
    CONSTRAINT email_messages_status_check CHECK (((status)::text = ANY (ARRAY[('received'::character varying)::text, ('read'::character varying)::text, ('replied'::character varying)::text, ('archived'::character varying)::text, ('draft'::character varying)::text, ('sent'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: email_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_messages_id_seq OWNED BY public.email_messages.id;


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id integer NOT NULL,
    slug character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    subject_template text NOT NULL,
    body_template text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb,
    category character varying(50) DEFAULT 'general'::character varying,
    is_active boolean DEFAULT true,
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_templates_id_seq OWNED BY public.email_templates.id;


--
-- Name: employee_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_achievements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(100) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    icon character varying(50) NOT NULL,
    category character varying(50) DEFAULT 'general'::character varying,
    xp_reward integer DEFAULT 0,
    condition jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_commission_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_commission_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    period character varying(7) NOT NULL,
    total_sales numeric(12,2) DEFAULT 0,
    total_receipts integer DEFAULT 0,
    total_commission numeric(12,2) DEFAULT 0,
    plan_target numeric(12,2),
    plan_percent numeric(5,2) GENERATED ALWAYS AS (
CASE
    WHEN (plan_target > (0)::numeric) THEN ((total_sales / plan_target) * (100)::numeric)
    ELSE (0)::numeric
END) STORED,
    plan_bonus numeric(12,2) DEFAULT 0,
    status character varying(20) DEFAULT 'draft'::character varying,
    approved_by uuid,
    approved_at timestamp with time zone,
    CONSTRAINT employee_commission_payouts_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'approved'::character varying, 'paid'::character varying])::text[])))
);


--
-- Name: employee_commission_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_commission_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid,
    role character varying(50),
    category_slug character varying(100),
    rate numeric(5,4) NOT NULL,
    min_receipt_total numeric(12,2) DEFAULT 0,
    is_active boolean DEFAULT true,
    priority integer DEFAULT 0
);


--
-- Name: employee_compensation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_compensation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    daily_rate numeric(10,2) NOT NULL,
    commission_rate numeric(5,2) DEFAULT 10.0 NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_until date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_daily_quests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_daily_quests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    quest_date date DEFAULT CURRENT_DATE NOT NULL,
    quest_type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    target integer NOT NULL,
    progress integer DEFAULT 0,
    xp_reward integer NOT NULL,
    completed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    service_option_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_manual_revenue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_manual_revenue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    month character varying(7) NOT NULL,
    amount numeric(10,2) DEFAULT 0 NOT NULL,
    description text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    keys jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    receipt_total numeric(12,2) NOT NULL,
    commission_rate numeric(5,4) DEFAULT 0,
    commission_amount numeric(12,2) GENERATED ALWAYS AS ((receipt_total * commission_rate)) STORED,
    category_slug character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    shift_date date NOT NULL,
    start_time time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    end_time time without time zone DEFAULT '19:30:00'::time without time zone NOT NULL,
    status character varying(20) DEFAULT 'scheduled'::character varying,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    checked_in_at timestamp with time zone,
    checked_out_at timestamp with time zone,
    cash_at_open numeric(12,2),
    cash_at_close numeric(12,2),
    CONSTRAINT employee_shifts_cash_at_close_nonnegative CHECK (((cash_at_close IS NULL) OR (cash_at_close >= (0)::numeric))),
    CONSTRAINT employee_shifts_cash_at_open_nonnegative CHECK (((cash_at_open IS NULL) OR (cash_at_open >= (0)::numeric))),
    CONSTRAINT employee_shifts_status_check CHECK (((status)::text = ANY (ARRAY[('scheduled'::character varying)::text, ('active'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: employee_tax_deductions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_tax_deductions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    deduction_category character varying(30) NOT NULL,
    amount numeric(10,2) NOT NULL,
    refund_amount numeric(10,2) GENERATED ALWAYS AS (round((amount * 0.13), 2)) STORED,
    description text NOT NULL,
    tax_year integer DEFAULT EXTRACT(year FROM CURRENT_DATE) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    document_url text,
    approved_by uuid,
    approved_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT employee_tax_deductions_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT employee_tax_deductions_deduction_category_check CHECK (((deduction_category)::text = ANY ((ARRAY['medical'::character varying, 'education'::character varying, 'sport'::character varying, 'property'::character varying, 'children'::character varying, 'charity'::character varying, 'professional'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT employee_tax_deductions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'applied'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: TABLE employee_tax_deductions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.employee_tax_deductions IS 'Налоговые вычеты сотрудников (возврат НДФЛ 13%)';


--
-- Name: COLUMN employee_tax_deductions.deduction_category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_tax_deductions.deduction_category IS 'medical=лечение, education=обучение, sport=спорт, property=имущественный, children=на детей, charity=благотворительность, professional=профессиональный';


--
-- Name: COLUMN employee_tax_deductions.refund_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_tax_deductions.refund_amount IS 'Расчётная сумма возврата = amount × 13% (auto-computed)';


--
-- Name: COLUMN employee_tax_deductions.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_tax_deductions.status IS 'pending=на рассмотрении, approved=одобрен, applied=применён к зарплате, rejected=отклонён';


--
-- Name: employee_unlocked_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_unlocked_achievements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    achievement_id uuid NOT NULL,
    unlocked_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_upsell_bonuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_upsell_bonuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    bonus_type character varying(30) NOT NULL,
    period character varying(10) NOT NULL,
    amount numeric(10,2) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_upsell_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_upsell_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    order_id uuid,
    offered_items text[] NOT NULL,
    accepted boolean DEFAULT false NOT NULL,
    shift_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_xp_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_xp_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    xp_amount integer NOT NULL,
    action_type character varying(50) NOT NULL,
    entity_id uuid,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: face_validations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.face_validations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    photo_approval_id uuid,
    message_id uuid,
    image_url text NOT NULL,
    image_dpi integer,
    dpi_source character varying(20),
    face_detected boolean DEFAULT false NOT NULL,
    face_count integer DEFAULT 0,
    face_height_px integer,
    face_height_mm numeric(5,1),
    face_width_px integer,
    face_width_mm numeric(5,1),
    forehead_y integer,
    chin_y integer,
    eye_level_delta_px integer,
    landmarks_count integer,
    is_valid_passport boolean,
    is_valid_greencard boolean,
    verdict character varying(20) DEFAULT 'unknown'::character varying,
    verdict_details jsonb DEFAULT '{}'::jsonb,
    validated_by uuid,
    processing_time_ms integer,
    created_at timestamp with time zone DEFAULT now(),
    gost_height_mm numeric(5,1),
    gost_height_min_mm numeric(5,1),
    gost_height_max_mm numeric(5,1),
    gost_pass boolean,
    gost_notes text,
    document_type character varying(50)
);


--
-- Name: COLUMN face_validations.gost_height_mm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.face_validations.gost_height_mm IS 'Measured face height in mm (forehead to chin) per MediaPipe landmarks';


--
-- Name: COLUMN face_validations.gost_pass; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.face_validations.gost_pass IS 'TRUE if face height >= gost_height_min_mm AND <= gost_height_max_mm';


--
-- Name: COLUMN face_validations.document_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.face_validations.document_type IS 'Document category: passport|visa|greencard|driver_license|medical_book etc';


--
-- Name: feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(100) NOT NULL,
    description text,
    enabled boolean DEFAULT false,
    platforms text[],
    min_app_version character varying(20) DEFAULT NULL::character varying,
    rollout_percentage integer DEFAULT 100,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT feature_flags_rollout_percentage_check CHECK (((rollout_percentage >= 0) AND (rollout_percentage <= 100)))
);


--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.files (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    file_name character varying(255) NOT NULL,
    original_name character varying(255),
    file_path text NOT NULL,
    file_size bigint NOT NULL,
    mime_type character varying(100),
    storage_type character varying(50) DEFAULT 'local'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: gallery_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gallery_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(255) NOT NULL,
    file_url text NOT NULL,
    thumbnail_url text,
    title character varying(500) NOT NULL,
    description text,
    category character varying(100) DEFAULT 'other'::character varying NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    photographer_id uuid,
    is_public boolean DEFAULT true NOT NULL,
    is_featured boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    width integer,
    height integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: icc_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.icc_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    media_type character varying(100) NOT NULL,
    profile_name character varying(200) NOT NULL,
    file_key text NOT NULL,
    calibrated_at timestamp with time zone,
    calibrated_by uuid,
    is_default boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: infra_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.infra_alerts (
    id bigint NOT NULL,
    studio_id uuid NOT NULL,
    agent_id uuid,
    alert_type character varying(50) NOT NULL,
    severity character varying(10) NOT NULL,
    title character varying(200) NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    is_acknowledged boolean DEFAULT false,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    telegram_notified_at timestamp with time zone,
    CONSTRAINT infra_alerts_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: infra_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.infra_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: infra_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.infra_alerts_id_seq OWNED BY public.infra_alerts.id;


--
-- Name: inventory_audit_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_audit_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audit_id uuid NOT NULL,
    product_stock_id uuid NOT NULL,
    system_quantity numeric(12,3) NOT NULL,
    actual_quantity numeric(12,3),
    discrepancy numeric(12,3) GENERATED ALWAYS AS ((actual_quantity - system_quantity)) STORED
);


--
-- Name: inventory_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_audits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    studio_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    status character varying(20) DEFAULT 'in_progress'::character varying,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    notes text,
    CONSTRAINT inventory_audits_status_check CHECK (((status)::text = ANY ((ARRAY['in_progress'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: inventory_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    supplier character varying(255),
    invoice_number character varying(100),
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_items integer DEFAULT 0,
    notes text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_stock_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    type character varying(30) NOT NULL,
    quantity numeric(12,3) NOT NULL,
    reference_id character varying(100),
    reference_type character varying(30),
    employee_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_transactions_type_check CHECK (((type)::text = ANY ((ARRAY['receipt_deduction'::character varying, 'consumable_deduction'::character varying, 'receipt_refund'::character varying, 'manual_receive'::character varying, 'manual_writeoff'::character varying, 'transfer_out'::character varying, 'transfer_in'::character varying, 'audit_adjustment'::character varying])::text[])))
);


--
-- Name: kb_access_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_access_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role text NOT NULL,
    category_slug text,
    entity_type text,
    can_read boolean DEFAULT true NOT NULL,
    can_create boolean DEFAULT false NOT NULL,
    can_update boolean DEFAULT false NOT NULL,
    can_delete boolean DEFAULT false NOT NULL,
    can_verify boolean DEFAULT false NOT NULL,
    can_export boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE kb_access_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_access_rules IS 'RBAC for KB — role × category × entity_type → permissions';


--
-- Name: kb_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    sort_order integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    entity_count integer DEFAULT 0 NOT NULL,
    depth integer DEFAULT 0 NOT NULL,
    path text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE kb_categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_categories IS 'Hierarchical taxonomy tree — 14 root domains, 70+ leaves';


--
-- Name: kb_category_tree; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.kb_category_tree AS
 WITH RECURSIVE tree AS (
         SELECT kb_categories.id,
            kb_categories.parent_id,
            kb_categories.slug,
            kb_categories.name,
            kb_categories.icon,
            kb_categories.sort_order,
            kb_categories.depth,
            kb_categories.path,
            kb_categories.entity_count,
            kb_categories.is_active,
            kb_categories.name AS full_name
           FROM public.kb_categories
          WHERE (kb_categories.parent_id IS NULL)
        UNION ALL
         SELECT c.id,
            c.parent_id,
            c.slug,
            c.name,
            c.icon,
            c.sort_order,
            c.depth,
            c.path,
            c.entity_count,
            c.is_active,
            ((tree_1.full_name || ' → '::text) || c.name)
           FROM (public.kb_categories c
             JOIN tree tree_1 ON ((tree_1.id = c.parent_id)))
        )
 SELECT id,
    parent_id,
    slug,
    name,
    icon,
    sort_order,
    depth,
    path,
    entity_count,
    is_active,
    full_name
   FROM tree
  ORDER BY path, sort_order;


--
-- Name: kb_competitor_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_competitor_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    competitor_id uuid NOT NULL,
    service_name text NOT NULL,
    service_category text DEFAULT 'other'::text NOT NULL,
    price_min integer,
    price_max integer,
    price_text text NOT NULL,
    unit text DEFAULT 'шт'::text,
    notes text,
    scraped_at timestamp with time zone DEFAULT now() NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    source_url text,
    extraction_method text DEFAULT 'scraper'::text
);


--
-- Name: kb_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE kb_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_config IS 'KB system configuration — embedding model, enrichment settings, thresholds';


--
-- Name: kb_crawled_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_crawled_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_slug text NOT NULL,
    url text NOT NULL,
    page_type text DEFAULT 'content'::text,
    depth integer DEFAULT 0,
    last_crawled_at timestamp with time zone,
    content_hash text,
    has_prices boolean DEFAULT false,
    title text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: kb_data_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_data_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    source_type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    sync_schedule text,
    last_synced_at timestamp with time zone,
    sync_status text DEFAULT 'idle'::text,
    sync_error text,
    entity_count integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_content_hash text,
    CONSTRAINT kb_data_sources_source_type_check CHECK ((source_type = ANY (ARRAY['file'::text, 'url'::text, 'api'::text, 'database'::text, 'manual'::text, 'conversation'::text, 'scraper'::text]))),
    CONSTRAINT kb_data_sources_sync_status_check CHECK ((sync_status = ANY (ARRAY['idle'::text, 'syncing'::text, 'error'::text])))
);


--
-- Name: TABLE kb_data_sources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_data_sources IS 'Data provenance registry — where knowledge comes from (files, URLs, APIs, conversations)';


--
-- Name: kb_enrichment_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_enrichment_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid,
    task_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    priority integer DEFAULT 5 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    error text,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    retry_after timestamp with time zone,
    scheduled_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    cron_expression text,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_enrichment_tasks_priority_check CHECK (((priority >= 1) AND (priority <= 10))),
    CONSTRAINT kb_enrichment_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'scheduled'::text])))
);


--
-- Name: TABLE kb_enrichment_tasks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_enrichment_tasks IS 'AI pipeline queue — embedding, summarization, relation extraction, competitor scraping, price analysis';


--
-- Name: kb_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_entities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    entity_type text NOT NULL,
    slug text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    visibility text DEFAULT 'internal'::text NOT NULL,
    name text NOT NULL,
    summary text,
    content text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    source_type text DEFAULT 'manual'::text NOT NULL,
    source_ref text,
    confidence numeric(3,2) DEFAULT 1.00 NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    search_vector tsvector,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    embedding public.vector(1024),
    CONSTRAINT kb_entities_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT kb_entities_source_type_check CHECK ((source_type = ANY (ARRAY['manual'::text, 'import'::text, 'ai_generated'::text, 'ai_enriched'::text, 'web_scraped'::text, 'analytics'::text, 'conversation'::text, 'api'::text]))),
    CONSTRAINT kb_entities_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text, 'deprecated'::text, 'review'::text]))),
    CONSTRAINT kb_entities_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'internal'::text, 'confidential'::text])))
);


--
-- Name: TABLE kb_entities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_entities IS 'Core knowledge entries — services, equipment, locations, people, competitors, processes, FAQs, USPs, market insights';


--
-- Name: kb_enrichment_ready; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.kb_enrichment_ready AS
 SELECT t.id,
    t.entity_id,
    t.task_type,
    t.status,
    t.priority,
    t.payload,
    t.result,
    t.error,
    t.attempts,
    t.max_attempts,
    t.retry_after,
    t.scheduled_at,
    t.started_at,
    t.completed_at,
    t.cron_expression,
    t.last_run_at,
    t.next_run_at,
    t.created_at,
    e.name AS entity_name,
    e.entity_type
   FROM (public.kb_enrichment_tasks t
     LEFT JOIN public.kb_entities e ON ((e.id = t.entity_id)))
  WHERE ((t.status = 'pending'::text) AND (t.scheduled_at <= now()) AND (t.attempts < t.max_attempts))
  ORDER BY t.priority, t.scheduled_at;


--
-- Name: kb_entities_pending_review; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.kb_entities_pending_review AS
 SELECT e.id,
    e.entity_type,
    e.name,
    e.summary,
    e.source_type,
    e.confidence,
    e.created_at,
    e.updated_at,
    c.name AS category_name,
    c.path AS category_path,
    (((u.first_name)::text || ' '::text) || (u.last_name)::text) AS created_by_name
   FROM ((public.kb_entities e
     JOIN public.kb_categories c ON ((c.id = e.category_id)))
     LEFT JOIN public.users u ON ((u.id = e.created_by)))
  WHERE ((e.is_verified = false) AND (e.status = ANY (ARRAY['active'::text, 'review'::text])) AND (e.deleted_at IS NULL))
  ORDER BY e.confidence, e.created_at DESC;


--
-- Name: kb_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_relations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_entity_id uuid NOT NULL,
    to_entity_id uuid NOT NULL,
    relation_type text NOT NULL,
    label text,
    weight numeric(5,2) DEFAULT 1.0 NOT NULL,
    bidirectional boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_type text DEFAULT 'manual'::text NOT NULL,
    confidence numeric(3,2) DEFAULT 1.00 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_relations_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT kb_relations_no_self_ref CHECK ((from_entity_id <> to_entity_id)),
    CONSTRAINT kb_relations_source_type_check CHECK ((source_type = ANY (ARRAY['manual'::text, 'ai_generated'::text, 'import'::text, 'inferred'::text]))),
    CONSTRAINT kb_relations_weight_check CHECK (((weight >= (0)::numeric) AND (weight <= (100)::numeric)))
);


--
-- Name: TABLE kb_relations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_relations IS 'Knowledge graph edges — typed, weighted, optional bidirectional';


--
-- Name: kb_entity_graph; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.kb_entity_graph AS
 SELECT id,
    name,
    entity_type,
    slug,
    status,
    ( SELECT jsonb_agg(jsonb_build_object('relation_type', r.relation_type, 'direction', 'outgoing', 'target_id', r.to_entity_id, 'target_name', t.name, 'target_type', t.entity_type, 'weight', r.weight)) AS jsonb_agg
           FROM (public.kb_relations r
             JOIN public.kb_entities t ON ((t.id = r.to_entity_id)))
          WHERE (r.from_entity_id = e.id)) AS outgoing_relations,
    ( SELECT jsonb_agg(jsonb_build_object('relation_type', r.relation_type, 'direction', 'incoming', 'source_id', r.from_entity_id, 'source_name', s.name, 'source_type', s.entity_type, 'weight', r.weight)) AS jsonb_agg
           FROM (public.kb_relations r
             JOIN public.kb_entities s ON ((s.id = r.from_entity_id)))
          WHERE (r.to_entity_id = e.id)) AS incoming_relations
   FROM public.kb_entities e
  WHERE (deleted_at IS NULL);


--
-- Name: kb_entity_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_entity_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    summary text,
    content text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    status text NOT NULL,
    visibility text NOT NULL,
    change_type text DEFAULT 'update'::text NOT NULL,
    change_reason text,
    diff jsonb,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_entity_versions_change_type_check CHECK ((change_type = ANY (ARRAY['create'::text, 'update'::text, 'verify'::text, 'archive'::text, 'restore'::text, 'enrich'::text, 'merge'::text])))
);


--
-- Name: TABLE kb_entity_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_entity_versions IS 'Full audit trail — every entity change creates a version snapshot';


--
-- Name: kb_metric_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_metric_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    unit text DEFAULT 'count'::text NOT NULL,
    aggregation text DEFAULT 'sum'::text NOT NULL,
    category text DEFAULT 'business'::text NOT NULL,
    is_cumulative boolean DEFAULT false NOT NULL,
    alert_threshold jsonb,
    dashboard_config jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_metric_definitions_aggregation_check CHECK ((aggregation = ANY (ARRAY['sum'::text, 'avg'::text, 'min'::text, 'max'::text, 'count'::text, 'median'::text, 'last'::text, 'first'::text, 'weighted_avg'::text])))
);


--
-- Name: TABLE kb_metric_definitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_metric_definitions IS 'Metric catalog — defines what metrics exist, units, aggregation rules, alert thresholds';


--
-- Name: kb_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    metric_value numeric NOT NULL,
    dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    period_type text DEFAULT 'daily'::text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    source_type text DEFAULT 'manual'::text NOT NULL,
    source_ref text,
    confidence numeric(3,2) DEFAULT 1.00 NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_metrics_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT kb_metrics_period_type_check CHECK ((period_type = ANY (ARRAY['hourly'::text, 'daily'::text, 'weekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text, 'custom'::text]))),
    CONSTRAINT kb_metrics_period_valid CHECK ((period_end >= period_start)),
    CONSTRAINT kb_metrics_source_type_check CHECK ((source_type = ANY (ARRAY['manual'::text, 'pos'::text, 'analytics'::text, 'ai_calculated'::text, 'web_scraped'::text, 'api'::text, 'import'::text])))
);


--
-- Name: TABLE kb_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_metrics IS 'Time-series business data — revenue, conversion, satisfaction, competitor prices';


--
-- Name: kb_price_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_price_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    competitor_id uuid NOT NULL,
    alert_type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    read_by uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kb_price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_price_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    competitor_id uuid NOT NULL,
    service_name text NOT NULL,
    service_category text DEFAULT 'other'::text NOT NULL,
    old_price integer,
    new_price integer,
    change_pct numeric(6,2),
    change_type text DEFAULT 'update'::text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kb_scrape_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_scrape_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_slug text NOT NULL,
    competitor_slug text,
    status text NOT NULL,
    pages_discovered integer DEFAULT 0 NOT NULL,
    pages_scraped integer DEFAULT 0 NOT NULL,
    items_found integer DEFAULT 0 NOT NULL,
    prices_extracted integer DEFAULT 0 NOT NULL,
    prices_saved integer DEFAULT 0 NOT NULL,
    extraction_method text,
    chrome_used boolean DEFAULT false NOT NULL,
    reqwest_used boolean DEFAULT false NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kb_source_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_source_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    source_id uuid NOT NULL,
    external_id text,
    sync_hash text,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE kb_source_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_source_links IS 'Entity ↔ source mapping with sync hash for incremental updates';


--
-- Name: kpi_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    metric_code character varying(60) NOT NULL,
    alert_type character varying(20) NOT NULL,
    severity character varying(10) NOT NULL,
    period_type character varying(10) NOT NULL,
    period_start date NOT NULL,
    current_value numeric(14,4) NOT NULL,
    target_value numeric(14,4),
    message text NOT NULL,
    acknowledged boolean DEFAULT false,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT kpi_alerts_alert_type_check CHECK (((alert_type)::text = ANY ((ARRAY['underperformance'::character varying, 'excellence'::character varying, 'trend_decline'::character varying, 'target_missed'::character varying])::text[]))),
    CONSTRAINT kpi_alerts_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: kpi_composite_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_composite_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    period_type character varying(10) NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    composite_score numeric(6,2) NOT NULL,
    rating character varying(20) NOT NULL,
    category_scores jsonb DEFAULT '{}'::jsonb NOT NULL,
    weights_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT kpi_composite_scores_period_type_check CHECK (((period_type)::text = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying])::text[]))),
    CONSTRAINT kpi_composite_scores_rating_check CHECK (((rating)::text = ANY ((ARRAY['exceptional'::character varying, 'good'::character varying, 'meeting'::character varying, 'below'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: kpi_metric_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_metric_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(60) NOT NULL,
    name character varying(255) NOT NULL,
    name_ru character varying(255) NOT NULL,
    category character varying(30) NOT NULL,
    unit character varying(20) DEFAULT 'count'::character varying NOT NULL,
    direction character varying(20) DEFAULT 'higher_better'::character varying NOT NULL,
    default_weight numeric(4,2) DEFAULT 1.00 NOT NULL,
    applicable_roles text[] DEFAULT '{employee,photographer,admin,manager}'::text[],
    description text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT kpi_metric_definitions_category_check CHECK (((category)::text = ANY ((ARRAY['productivity'::character varying, 'quality'::character varying, 'speed'::character varying, 'revenue'::character varying, 'satisfaction'::character varying, 'attendance'::character varying])::text[]))),
    CONSTRAINT kpi_metric_definitions_direction_check CHECK (((direction)::text = ANY ((ARRAY['higher_better'::character varying, 'lower_better'::character varying])::text[]))),
    CONSTRAINT kpi_metric_definitions_unit_check CHECK (((unit)::text = ANY ((ARRAY['count'::character varying, 'percent'::character varying, 'seconds'::character varying, 'rubles'::character varying, 'number'::character varying, 'hours'::character varying])::text[])))
);


--
-- Name: kpi_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    metric_code character varying(60) NOT NULL,
    period_type character varying(10) NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    value numeric(14,4) NOT NULL,
    sample_size integer,
    computed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT kpi_snapshots_period_type_check CHECK (((period_type)::text = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying])::text[])))
);


--
-- Name: kpi_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    metric_code character varying(60) NOT NULL,
    scope character varying(20) NOT NULL,
    scope_value character varying(100),
    target_value numeric(14,4) NOT NULL,
    stretch_value numeric(14,4),
    minimum_value numeric(14,4),
    effective_from date NOT NULL,
    effective_until date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT kpi_targets_scope_check CHECK (((scope)::text = ANY ((ARRAY['global'::character varying, 'role'::character varying, 'employee'::character varying])::text[])))
);


--
-- Name: kpi_weight_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_weight_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    scope character varying(20) NOT NULL,
    scope_value character varying(50),
    weights jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT kpi_weight_profiles_scope_check CHECK (((scope)::text = ANY ((ARRAY['global'::character varying, 'role'::character varying])::text[])))
);


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    ip character varying(45),
    user_agent text,
    success boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: login_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_attempts_id_seq OWNED BY public.login_attempts.id;


--
-- Name: loyalty_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    telegram_user_id uuid,
    points integer DEFAULT 0,
    total_points_earned integer DEFAULT 0,
    level integer DEFAULT 1,
    current_streak integer DEFAULT 0,
    longest_streak integer DEFAULT 0,
    last_daily_claim timestamp with time zone,
    referral_code character varying(20),
    referred_by uuid,
    total_orders integer DEFAULT 0,
    total_spent numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    referred_by_user_id uuid,
    customer_id uuid
);


--
-- Name: marketing_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    campaign_type character varying(30) NOT NULL,
    channel character varying(30),
    status character varying(20) DEFAULT 'draft'::character varying,
    budget numeric(10,2),
    spent numeric(10,2) DEFAULT 0,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    utm_source character varying(100),
    utm_campaign character varying(100),
    utm_medium character varying(50),
    target_location character varying(255),
    target_audience text,
    print_quantity integer,
    distributed_quantity integer DEFAULT 0,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT marketing_campaigns_campaign_type_check CHECK (((campaign_type)::text = ANY ((ARRAY['flyer'::character varying, 'email'::character varying, 'sms'::character varying, 'social'::character varying, 'paid_ads'::character varying, 'partner'::character varying])::text[]))),
    CONSTRAINT marketing_campaigns_channel_check CHECK (((channel)::text = ANY ((ARRAY['print'::character varying, 'digital'::character varying, 'mixed'::character varying])::text[]))),
    CONSTRAINT marketing_campaigns_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'paused'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: TABLE marketing_campaigns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.marketing_campaigns IS 'Маркетинговые кампании (флайеры, email, SMS, соцсети, реклама, партнёры)';


--
-- Name: COLUMN marketing_campaigns.campaign_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.marketing_campaigns.campaign_type IS 'Тип: flyer | email | sms | social | paid_ads | partner';


--
-- Name: COLUMN marketing_campaigns.channel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.marketing_campaigns.channel IS 'Канал распространения: print | digital | mixed';


--
-- Name: COLUMN marketing_campaigns.target_location; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.marketing_campaigns.target_location IS 'Локация раздачи (для флайеров — адрес/район)';


--
-- Name: COLUMN marketing_campaigns.print_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.marketing_campaigns.print_quantity IS 'Кол-во напечатанных материалов (флайеры, визитки)';


--
-- Name: COLUMN marketing_campaigns.distributed_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.marketing_campaigns.distributed_quantity IS 'Кол-во розданных/распространённых материалов';


--
-- Name: material_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id uuid,
    work_log_id uuid,
    product_id uuid NOT NULL,
    quantity numeric(10,3) NOT NULL,
    unit character varying(20) DEFAULT 'sheets'::character varying NOT NULL,
    studio_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT material_usage_unit_check CHECK (((unit)::text = ANY (ARRAY[('sheets'::character varying)::text, ('ml'::character varying)::text, ('pieces'::character varying)::text, ('meters'::character varying)::text])))
);


--
-- Name: media_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    s3_key character varying(500) NOT NULL,
    s3_url text NOT NULL,
    media_type character varying(20) NOT NULL,
    mime_type character varying(100) NOT NULL,
    file_size_bytes bigint,
    file_name character varying(500),
    width integer,
    height integer,
    duration_seconds integer,
    original_url text,
    original_mime character varying(100),
    processing_status character varying(20) DEFAULT 'pending'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    av_status character varying(20) DEFAULT 'pending'::character varying,
    CONSTRAINT media_attachments_media_type_check CHECK (((media_type)::text = ANY ((ARRAY['image'::character varying, 'video'::character varying, 'audio'::character varying, 'file'::character varying, 'sticker'::character varying])::text[]))),
    CONSTRAINT media_attachments_processing_status_check CHECK (((processing_status)::text = ANY ((ARRAY['pending'::character varying, 'downloading'::character varying, 'processing'::character varying, 'uploaded'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: message_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    status character varying(20) NOT NULL,
    error_code character varying(50),
    error_message text,
    external_status_id character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT message_statuses_status_check CHECK (((status)::text = ANY ((ARRAY['accepted'::character varying, 'sent'::character varying, 'delivered'::character varying, 'read'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_type character varying(20) NOT NULL,
    sender_id character varying(100),
    sender_name character varying(200),
    message_type character varying(20) DEFAULT 'text'::character varying,
    content text NOT NULL,
    external_message_id character varying(255),
    client_message_id character varying(255),
    reply_to_message_id uuid,
    is_forwarded boolean DEFAULT false,
    forwarded_from_name character varying(200),
    delivery_status character varying(20) DEFAULT 'accepted'::character varying,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    is_read boolean DEFAULT false,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    legacy_message_id uuid,
    event_type character varying(50),
    attachment_url character varying(500),
    CONSTRAINT messages_delivery_status_check CHECK (((delivery_status)::text = ANY ((ARRAY['accepted'::character varying, 'sent'::character varying, 'delivered'::character varying, 'read'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT messages_message_type_check CHECK (((message_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'file'::character varying, 'video'::character varying, 'audio'::character varying, 'system'::character varying, 'interactive'::character varying, 'location'::character varying, 'contact'::character varying, 'sticker'::character varying])::text[]))),
    CONSTRAINT messages_sender_type_check CHECK (((sender_type)::text = ANY ((ARRAY['visitor'::character varying, 'operator'::character varying, 'bot'::character varying, 'system'::character varying, 'internal_note'::character varying])::text[])))
);


--
-- Name: messages_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages_archive (
    id uuid NOT NULL,
    conversation_id uuid,
    sender_type character varying(20),
    sender_id character varying(100),
    sender_name character varying(200),
    message_type character varying(20),
    content text,
    external_message_id character varying(255),
    client_message_id character varying(255),
    reply_to_message_id uuid,
    is_forwarded boolean,
    forwarded_from_name character varying(200),
    delivery_status character varying(20),
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    is_read boolean,
    metadata jsonb,
    created_at timestamp with time zone,
    legacy_message_id uuid
);


--
-- Name: mobile_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    visitor_id character varying(255),
    device_id character varying(255) NOT NULL,
    platform character varying(20) NOT NULL,
    push_provider character varying(20) NOT NULL,
    token text NOT NULL,
    app_version character varying(20),
    device_model character varying(100),
    os_version character varying(20),
    locale character varying(10) DEFAULT 'ru'::character varying,
    is_active boolean DEFAULT true,
    last_used_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT mobile_push_tokens_platform_check CHECK (((platform)::text = ANY ((ARRAY['android'::character varying, 'ios'::character varying])::text[]))),
    CONSTRAINT mobile_push_tokens_push_provider_check CHECK (((push_provider)::text = ANY ((ARRAY['fcm'::character varying, 'hms'::character varying, 'rustore'::character varying, 'apns'::character varying])::text[])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    body text NOT NULL,
    type character varying(50),
    data jsonb DEFAULT '{}'::jsonb,
    read boolean DEFAULT false,
    "timestamp" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: option_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.option_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_category_id uuid NOT NULL,
    slug character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    selection_type character varying(20) DEFAULT 'single'::character varying NOT NULL,
    is_required boolean DEFAULT false,
    min_selections integer DEFAULT 0,
    max_selections integer DEFAULT 1,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT option_groups_selection_type_check CHECK (((selection_type)::text = ANY (ARRAY[('single'::character varying)::text, ('multi'::character varying)::text, ('quantity'::character varying)::text])))
);


--
-- Name: option_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.option_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_category_id uuid,
    rule_type character varying(20) NOT NULL,
    source_option_id uuid NOT NULL,
    target_option_id uuid NOT NULL,
    override_price numeric(10,2),
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    source_category_id uuid,
    CONSTRAINT option_rules_rule_type_check CHECK (((rule_type)::text = ANY (ARRAY[('requires'::character varying)::text, ('excludes'::character varying)::text, ('includes'::character varying)::text, ('price_override'::character varying)::text])))
);


--
-- Name: order_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(100) NOT NULL,
    order_type character varying(30) NOT NULL,
    order_summary text,
    source character varying(20) DEFAULT 'online'::character varying,
    studio_id uuid,
    assigned_to uuid,
    assigned_at timestamp with time zone,
    deadline_at timestamp with time zone,
    estimated_minutes integer,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    completed_at timestamp with time zone,
    help_request text,
    help_requested_at timestamp with time zone,
    helpers uuid[] DEFAULT '{}'::uuid[],
    priority integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_assignments_order_type_check CHECK (((order_type)::text = ANY (ARRAY[('print'::character varying)::text, ('retouch'::character varying)::text, ('photo'::character varying)::text, ('marketplace'::character varying)::text, ('scan'::character varying)::text, ('design'::character varying)::text, ('other'::character varying)::text]))),
    CONSTRAINT order_assignments_source_check CHECK (((source)::text = ANY (ARRAY[('online'::character varying)::text, ('pos'::character varying)::text, ('chat'::character varying)::text, ('phone'::character varying)::text, ('walk_in'::character varying)::text]))),
    CONSTRAINT order_assignments_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('in_progress'::character varying)::text, ('help_needed'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: order_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(50) NOT NULL,
    s3_key character varying(500) NOT NULL,
    s3_url character varying(1000) NOT NULL,
    file_name character varying(255),
    mime_type character varying(100),
    file_size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    attachment_type character varying(30) DEFAULT 'client_photo'::character varying,
    sort_order integer DEFAULT 0
);


--
-- Name: order_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_comments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    user_id uuid NOT NULL,
    comment text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: order_delay_compensations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_delay_compensations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(100) NOT NULL,
    reason character varying(100) NOT NULL,
    compensation_amount numeric(10,2) DEFAULT 0 NOT NULL,
    message_sent boolean DEFAULT false NOT NULL,
    chat_session_id uuid,
    credited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_delay_daily_total; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.order_delay_daily_total AS
 SELECT credited_by,
    date(created_at) AS day,
    sum(compensation_amount) AS total
   FROM public.order_delay_compensations
  WHERE (created_at >= CURRENT_DATE)
  GROUP BY credited_by, (date(created_at));


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(100) NOT NULL,
    order_type character varying(20) NOT NULL,
    service_option_id uuid,
    product_id uuid,
    name character varying(255) NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    delivery_method character varying(20),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT order_items_delivery_method_check CHECK (((delivery_method)::text = ANY (ARRAY[('electronic'::character varying)::text, ('pickup'::character varying)::text, ('postal'::character varying)::text]))),
    CONSTRAINT order_items_order_type_check CHECK (((order_type)::text = ANY ((ARRAY['chat'::character varying, 'app'::character varying, 'pos'::character varying, 'crm'::character varying])::text[])))
);


--
-- Name: order_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_number_seq
    START WITH 1043
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(100) NOT NULL,
    old_status character varying(30),
    new_status character varying(30) NOT NULL,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: order_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    icon character varying(50) DEFAULT 'bookmark'::character varying NOT NULL,
    description text,
    created_by uuid NOT NULL,
    scope character varying(20) DEFAULT 'personal'::character varying NOT NULL,
    option_slugs text[] DEFAULT '{}'::text[] NOT NULL,
    usage_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_templates_scope_check CHECK (((scope)::text = ANY ((ARRAY['personal'::character varying, 'shared'::character varying])::text[])))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id uuid,
    photographer_id uuid,
    booking_id uuid,
    type character varying(50),
    status character varying(50) DEFAULT 'pending'::character varying,
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    total_amount numeric(10,2),
    currency character varying(10) DEFAULT 'RUB'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: outbound_delivery_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound_delivery_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel character varying(20) NOT NULL,
    external_chat_id character varying(255),
    content text,
    message_type character varying(20) DEFAULT 'text'::character varying,
    attachment_url text,
    source_message_id uuid,
    session_id uuid,
    status character varying(20) DEFAULT 'pending'::character varying,
    delivered_at timestamp with time zone,
    last_error text,
    attempts integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: outbound_delivery_log_archived; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound_delivery_log_archived (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel character varying(20) NOT NULL,
    external_chat_id character varying(255) NOT NULL,
    content text NOT NULL,
    message_type character varying(20) DEFAULT 'text'::character varying,
    attachment_url text,
    source_message_id uuid,
    session_id uuid,
    status character varying(20) DEFAULT 'pending'::character varying,
    attempts integer DEFAULT 0,
    last_error text,
    created_at timestamp with time zone DEFAULT now(),
    delivered_at timestamp with time zone,
    CONSTRAINT outbound_delivery_log_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'delivered'::character varying, 'failed'::character varying, 'dead_letter'::character varying])::text[])))
);


--
-- Name: outbound_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel public.channel_type NOT NULL,
    account_id uuid,
    external_chat_id character varying(255) NOT NULL,
    content text NOT NULL,
    message_type character varying(20) DEFAULT 'text'::character varying,
    media_attachment_id uuid,
    attachment_url text,
    source_message_id uuid,
    conversation_id uuid,
    status character varying(20) DEFAULT 'pending'::character varying,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 5,
    next_retry_at timestamp with time zone DEFAULT now(),
    last_error text,
    delivered_at timestamp with time zone,
    external_response jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reply_to_external_id text,
    CONSTRAINT outbound_queue_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'delivered'::character varying, 'failed'::character varying, 'dead_letter'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: COLUMN outbound_queue.reply_to_external_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.outbound_queue.reply_to_external_id IS 'External message ID of the message being replied to (e.g. tg:123, vk:456, wamid.xxx)';


--
-- Name: partner_commission_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_commission_rules (
    id integer NOT NULL,
    partner_id integer NOT NULL,
    service_category_slug character varying(100),
    order_type character varying(20),
    commission_percent numeric(5,2),
    commission_fixed numeric(10,2),
    min_order_amount numeric(10,2) DEFAULT 0,
    is_active boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_commission_value CHECK (((commission_percent IS NOT NULL) OR (commission_fixed IS NOT NULL)))
);


--
-- Name: partner_commission_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.partner_commission_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: partner_commission_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.partner_commission_rules_id_seq OWNED BY public.partner_commission_rules.id;


--
-- Name: partner_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_payouts (
    id integer NOT NULL,
    partner_id integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    method character varying(20) DEFAULT 'card'::character varying NOT NULL,
    payout_details jsonb DEFAULT '{}'::jsonb,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    notes text,
    processed_by uuid,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: partner_payouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.partner_payouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: partner_payouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.partner_payouts_id_seq OWNED BY public.partner_payouts.id;


--
-- Name: partner_referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_referrals (
    id integer NOT NULL,
    partner_id integer NOT NULL,
    order_id character varying(50),
    order_type character varying(20) DEFAULT 'print'::character varying,
    order_amount numeric(10,2) NOT NULL,
    commission_amount numeric(10,2) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    promo_code character varying(50),
    referral_url text,
    client_phone character varying(20),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    commission_type character varying(20) DEFAULT 'first'::character varying NOT NULL,
    client_order_count integer DEFAULT 1 NOT NULL,
    CONSTRAINT partner_referrals_commission_type_check CHECK (((commission_type)::text = ANY (ARRAY[('first'::character varying)::text, ('repeat'::character varying)::text, ('lifetime'::character varying)::text])))
);


--
-- Name: partner_referrals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.partner_referrals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: partner_referrals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.partner_referrals_id_seq OWNED BY public.partner_referrals.id;


--
-- Name: partner_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_tiers (
    id integer NOT NULL,
    slug character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    min_monthly_revenue numeric(12,2) DEFAULT 0 NOT NULL,
    commission_first_percent numeric(5,2) NOT NULL,
    commission_repeat_percent numeric(5,2) NOT NULL,
    commission_lifetime_percent numeric(5,2) NOT NULL,
    client_discount_percent numeric(5,2) DEFAULT 0 NOT NULL,
    cookie_ttl_days integer DEFAULT 30 NOT NULL,
    is_manual_only boolean DEFAULT false NOT NULL,
    downgrade_grace_months integer DEFAULT 2 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: partner_tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.partner_tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: partner_tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.partner_tiers_id_seq OWNED BY public.partner_tiers.id;


--
-- Name: partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partners (
    id integer NOT NULL,
    user_id uuid,
    name character varying(100) NOT NULL,
    email character varying(255),
    phone character varying(20),
    type character varying(20) DEFAULT 'referral'::character varying NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    commission_rate numeric(5,2) DEFAULT 50.00,
    balance numeric(10,2) DEFAULT 0.00,
    total_earned numeric(10,2) DEFAULT 0.00,
    promo_code character varying(50),
    referral_url text,
    payout_details jsonb DEFAULT '{}'::jsonb,
    notes text,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tier_slug character varying(50) DEFAULT 'start'::character varying NOT NULL,
    tier_updated_at timestamp with time zone,
    monthly_revenue numeric(12,2) DEFAULT 0 NOT NULL,
    monthly_revenue_at timestamp with time zone,
    downgrade_months_count integer DEFAULT 0 NOT NULL,
    inn character varying(12),
    self_employed_status character varying(20) DEFAULT 'not_checked'::character varying,
    self_employed_verified_at timestamp with time zone,
    self_employed_checked_by character varying(50),
    hourly_rate numeric(8,2) DEFAULT NULL::numeric,
    CONSTRAINT partners_self_employed_status_check CHECK (((self_employed_status)::text = ANY ((ARRAY['not_checked'::character varying, 'pending'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: TABLE partners; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.partners IS 'Партнёрская программа: реферальные, бизнес, аффилиат партнёры';


--
-- Name: partners_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.partners_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: partners_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.partners_id_seq OWNED BY public.partners.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(100) NOT NULL,
    event_type character varying(50) NOT NULL,
    transaction_id character varying(100),
    amount numeric(10,2),
    card_info character varying(100),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payment_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(100) NOT NULL,
    installment_number integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_id character varying(100),
    payment_status character varying(30) DEFAULT 'pending'::character varying,
    card_info character varying(100),
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payment_installments_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'failed'::character varying, 'refunded'::character varying])::text[])))
);


--
-- Name: pending_oauth_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_oauth_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(20) NOT NULL,
    provider_id character varying(255) NOT NULL,
    token character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    photo_ids uuid[] DEFAULT ARRAY[]::uuid[],
    purpose text,
    status character varying(50) DEFAULT 'pending'::character varying,
    granted_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    session_id uuid,
    type character varying(50) DEFAULT 'all_photos'::character varying NOT NULL,
    purposes text[] DEFAULT ARRAY[]::text[] NOT NULL,
    comments text,
    signature_image text,
    signed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoke_reason text
);


--
-- Name: photo_approval_annotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photo_approval_annotations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    approval_id uuid NOT NULL,
    user_id uuid,
    annotation jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: photo_approval_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photo_approval_revisions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    approval_id uuid NOT NULL,
    revision_number integer DEFAULT 1 NOT NULL,
    variants_snapshot jsonb DEFAULT '[]'::jsonb,
    client_comment text,
    annotations_snapshot jsonb DEFAULT '[]'::jsonb,
    status character varying(30) NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: photo_approval_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photo_approval_variants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    approval_id uuid NOT NULL,
    variant_url text NOT NULL,
    thumbnail_url text,
    label character varying(100),
    sort_order integer DEFAULT 0,
    is_selected boolean DEFAULT false,
    selected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: photo_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photo_approvals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id uuid,
    photographer_id uuid,
    session_id uuid,
    photo_id uuid,
    status character varying(50) DEFAULT 'pending'::character varying,
    comment text,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    original_photo_url text,
    retouched_photo_url text,
    retouch_type character varying(20) DEFAULT 'basic'::character varying,
    order_id uuid,
    approval_session_id uuid,
    revision_count integer DEFAULT 1,
    selected_variant_id uuid,
    thumbnail_url text,
    original_thumbnail_url text,
    revision_round integer DEFAULT 1,
    approved_by uuid,
    approved_by_role character varying(20),
    CONSTRAINT photo_approvals_approved_by_role_check CHECK (((approved_by_role)::text = ANY ((ARRAY['client'::character varying, 'employee'::character varying, 'anonymous'::character varying])::text[]))),
    CONSTRAINT photo_approvals_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('changes_requested'::character varying)::text])))
);


--
-- Name: COLUMN photo_approvals.approved_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.photo_approvals.approved_by IS 'User ID who approved (null for anonymous token approval)';


--
-- Name: COLUMN photo_approvals.approved_by_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.photo_approvals.approved_by_role IS 'Role of approver: client, employee, or anonymous (token)';


--
-- Name: photo_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photo_selections (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    selected_photo_ids uuid[] DEFAULT ARRAY[]::uuid[],
    status character varying(50) DEFAULT 'pending_payment'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: photo_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photo_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id uuid NOT NULL,
    photographer_id uuid NOT NULL,
    booking_id uuid,
    date date NOT NULL,
    location character varying(255),
    status character varying(50) DEFAULT 'pending'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: photographer_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photographer_services (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    photographer_id uuid NOT NULL,
    service_id character varying(255) NOT NULL,
    is_enabled boolean DEFAULT false,
    price numeric(10,2),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: photographers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photographers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    bio text,
    location jsonb DEFAULT '{}'::jsonb NOT NULL,
    experience integer DEFAULT 0,
    specializations text[] DEFAULT ARRAY[]::text[],
    services text[] DEFAULT ARRAY[]::text[],
    equipment text[] DEFAULT ARRAY[]::text[],
    portfolio jsonb[] DEFAULT ARRAY[]::jsonb[],
    availability jsonb DEFAULT '{}'::jsonb,
    pricing jsonb DEFAULT '{}'::jsonb,
    rating jsonb DEFAULT '{"average": 0, "totalReviews": 0}'::jsonb,
    social_media jsonb DEFAULT '{}'::jsonb,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid NOT NULL,
    file_id uuid,
    file_url text NOT NULL,
    thumbnail_url text,
    file_name character varying(255),
    file_size bigint,
    mime_type character varying(100),
    width integer,
    height integer,
    selected boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: points_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.points_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loyalty_profile_id uuid NOT NULL,
    amount integer NOT NULL,
    balance_after integer NOT NULL,
    action character varying(50) NOT NULL,
    description text,
    reference_id character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_points_action CHECK (((action)::text = ANY ((ARRAY['first_visit'::character varying, 'daily_checkin'::character varying, 'streak_bonus'::character varying, 'referral_bonus'::character varying, 'referral_welcome'::character varying, 'online_order'::character varying, 'pos_order'::character varying, 'pos_spend'::character varying, 'admin_adjust'::character varying, 'admin_deduct'::character varying, 'chat_order'::character varying, 'review_bonus'::character varying, 'achievement_bonus'::character varying])::text[])))
);


--
-- Name: pos_cash_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_cash_counts (
    id integer NOT NULL,
    shift_id uuid NOT NULL,
    denomination numeric(10,2) NOT NULL,
    denomination_type text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pos_cash_counts_denomination_type_check CHECK ((denomination_type = ANY (ARRAY['banknote'::text, 'coin'::text])))
);


--
-- Name: pos_cash_counts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pos_cash_counts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pos_cash_counts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pos_cash_counts_id_seq OWNED BY public.pos_cash_counts.id;


--
-- Name: pos_receipt_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_receipt_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    receipt_id uuid NOT NULL,
    product_id uuid,
    product_name character varying(255) NOT NULL,
    quantity numeric(10,3) NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0,
    discount_percent numeric(5,2) DEFAULT 0,
    points_used numeric(10,2) DEFAULT 0,
    subscription_credits_used numeric(10,2) DEFAULT 0,
    total numeric(10,2) NOT NULL,
    vat_rate character varying(20),
    vat_amount numeric(10,2) DEFAULT 0,
    sort_order integer DEFAULT 0,
    discount_type character varying(30),
    discount_label text
);


--
-- Name: COLUMN pos_receipt_items.discount_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pos_receipt_items.discount_type IS 'Тип скидки: degressive, category_degressive, volume, subscription, cross_category';


--
-- Name: COLUMN pos_receipt_items.discount_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pos_receipt_items.discount_label IS 'Описание скидки для отчётов, напр. "2-й комплект: экономия 130₽"';


--
-- Name: pos_receipt_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_receipt_payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    receipt_id uuid NOT NULL,
    payment_type character varying(20) NOT NULL,
    amount numeric(10,2) NOT NULL,
    card_info character varying(50),
    transaction_id character varying(100),
    sbp_qr_url character varying(500),
    status character varying(20) DEFAULT 'completed'::character varying,
    CONSTRAINT pos_receipt_payments_payment_type_check CHECK (((payment_type)::text = ANY (ARRAY[('cash'::character varying)::text, ('card'::character varying)::text, ('sbp'::character varying)::text, ('online'::character varying)::text, ('subscription'::character varying)::text, ('transfer'::character varying)::text]))),
    CONSTRAINT pos_receipt_payments_status_check CHECK (((status)::text = ANY (ARRAY[('completed'::character varying)::text, ('pending'::character varying)::text, ('failed'::character varying)::text, ('refunded'::character varying)::text])))
);


--
-- Name: pos_receipt_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pos_receipt_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pos_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_receipts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    receipt_number character varying(20) NOT NULL,
    shift_id uuid,
    employee_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    customer_phone character varying(20),
    customer_name character varying(255),
    loyalty_profile_id uuid,
    subscription_id uuid,
    is_refund boolean DEFAULT false,
    refund_receipt_id uuid,
    subtotal numeric(10,2) NOT NULL,
    discount_total numeric(10,2) DEFAULT 0,
    points_discount numeric(10,2) DEFAULT 0,
    subscription_credit_used numeric(10,2) DEFAULT 0,
    total numeric(10,2) NOT NULL,
    fiscal_receipt_url character varying(500),
    fiscal_receipt_number character varying(50),
    fiscal_sign character varying(50),
    fiscal_source character varying(20) DEFAULT 'atol27f'::character varying,
    print_order_id uuid,
    task_id integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    customer_id uuid,
    idempotency_key uuid,
    void_reason text,
    voided_at timestamp with time zone,
    voided_by uuid,
    refund_items jsonb,
    fiscal_status text DEFAULT 'pending'::text,
    fiscal_attempts integer DEFAULT 0,
    fiscal_last_error text,
    fiscal_queued_at timestamp with time zone,
    promo_code character varying(50),
    partner_id integer,
    CONSTRAINT pos_receipts_fiscal_source_check CHECK (((fiscal_source)::text = ANY (ARRAY[('atol27f'::character varying)::text, ('cloudkassir'::character varying)::text]))),
    CONSTRAINT pos_receipts_fiscal_status_check CHECK ((fiscal_status = ANY (ARRAY['pending'::text, 'queued'::text, 'processing'::text, 'success'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: pos_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_shifts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    shift_number integer NOT NULL,
    opened_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    cash_at_open numeric(10,2) DEFAULT 0,
    cash_at_close numeric(10,2),
    expected_cash numeric(10,2),
    status character varying(20) DEFAULT 'open'::character varying,
    total_sales numeric(10,2) DEFAULT 0,
    total_refunds numeric(10,2) DEFAULT 0,
    receipt_count integer DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    cash_collected numeric(12,2) DEFAULT 0,
    collection_count integer DEFAULT 0,
    fiscal_enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT pos_shifts_status_check CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('closed'::character varying)::text])))
);


--
-- Name: pos_shifts_shift_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pos_shifts_shift_number_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pos_shifts_shift_number_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pos_shifts_shift_number_seq OWNED BY public.pos_shifts.shift_number;


--
-- Name: pos_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    studio_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    transaction_type character varying(20) NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency character varying(3) DEFAULT 'RUB'::character varying,
    terminal_response jsonb DEFAULT '{}'::jsonb,
    fiscal_receipt jsonb DEFAULT '{}'::jsonb,
    order_id uuid,
    status character varying(20) DEFAULT 'pending'::character varying,
    error_message text,
    initiated_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    receipt_id uuid,
    approval_code character varying(20),
    rrn character varying(30),
    card_mask character varying(30),
    sbp_qr_data text,
    sbp_paid boolean DEFAULT false,
    fiscal_number character varying(50),
    fiscal_sign character varying(50),
    fiscal_receipt_url text,
    initiated_by uuid,
    command_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT pos_transactions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'timeout'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT pos_transactions_transaction_type_check CHECK (((transaction_type)::text = ANY ((ARRAY['payment'::character varying, 'refund'::character varying, 'sbp_payment'::character varying, 'sbp_refund'::character varying, 'fiscal_sale'::character varying, 'fiscal_refund'::character varying, 'fiscal_correction'::character varying, 'shift_open'::character varying, 'shift_close'::character varying, 'cash_drawer'::character varying, 'bank_settlement'::character varying])::text[])))
);


--
-- Name: pos_fiscal_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_fiscal_settings (
    studio_id uuid NOT NULL,
    agent_id uuid,
    enabled boolean DEFAULT true NOT NULL,
    receipt_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    slip_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    shift_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: price_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_locks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id character varying(100),
    user_id uuid,
    category_slug character varying(100) NOT NULL,
    locked_price numeric(10,2) NOT NULL,
    lock_fee numeric(10,2) DEFAULT 50,
    lock_fee_paid boolean DEFAULT false,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false,
    used_order_id character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: price_modifiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_modifiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    modifier_type character varying(30) NOT NULL,
    scope character varying(30) DEFAULT 'global'::character varying NOT NULL,
    service_category_id uuid,
    service_option_id uuid,
    modifier_action character varying(20) DEFAULT 'multiply'::character varying NOT NULL,
    modifier_value numeric(10,4) NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb,
    priority integer DEFAULT 0,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT price_modifiers_modifier_action_check CHECK (((modifier_action)::text = ANY (ARRAY[('multiply'::character varying)::text, ('add'::character varying)::text, ('subtract'::character varying)::text, ('override'::character varying)::text]))),
    CONSTRAINT price_modifiers_modifier_type_check CHECK (((modifier_type)::text = ANY (ARRAY[('channel'::character varying)::text, ('seasonal'::character varying)::text, ('time_of_day'::character varying)::text, ('volume'::character varying)::text, ('customer_segment'::character varying)::text]))),
    CONSTRAINT price_modifiers_scope_check CHECK (((scope)::text = ANY (ARRAY[('global'::character varying)::text, ('category'::character varying)::text, ('option'::character varying)::text])))
);


--
-- Name: pricing_ai_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_ai_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    option_slug character varying(255) NOT NULL,
    option_name character varying(255) NOT NULL,
    current_price numeric(10,2) NOT NULL,
    suggested_price numeric(10,2) NOT NULL,
    discount_percent integer NOT NULL,
    reason text NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    requested_by uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pricing_ai_suggestions_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text])))
);


--
-- Name: pricing_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(30) NOT NULL,
    entity_id uuid NOT NULL,
    changed_by uuid,
    old_values jsonb NOT NULL,
    new_values jsonb NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: print_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    printer_id uuid,
    file_url text NOT NULL,
    file_name character varying(255),
    copies integer DEFAULT 1,
    paper_size character varying(30) DEFAULT 'A4'::character varying,
    color_mode character varying(10) DEFAULT 'color'::character varying,
    quality character varying(30) DEFAULT 'normal'::character varying,
    duplex boolean DEFAULT false,
    orientation character varying(20) DEFAULT 'auto'::character varying,
    borderless boolean DEFAULT false,
    media_type character varying(50),
    fit_mode character varying(20) DEFAULT 'fit'::character varying,
    status character varying(20) DEFAULT 'queued'::character varying,
    error_message text,
    order_id character varying(100),
    order_type character varying(30),
    receipt_id uuid,
    created_by uuid NOT NULL,
    studio_id uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    customer_id uuid,
    service_slug character varying(100),
    document_template_slug character varying(100),
    original_job_id uuid,
    cut_marks boolean DEFAULT false,
    cut_mark_length_mm double precision,
    cut_mark_offset_mm double precision,
    consumable_usage jsonb,
    icc_profile_id uuid,
    rotation smallint DEFAULT 0,
    layout_rows integer,
    layout_cols integer,
    cut_margin_mm double precision,
    custom_photo_width_mm double precision,
    custom_photo_height_mm double precision,
    reassigned_from uuid,
    reassign_reason text,
    reassigned_at timestamp with time zone,
    reassigned_by uuid,
    priority integer DEFAULT 0 NOT NULL,
    price_total numeric(10,2),
    duration_ms integer,
    pages_printed integer DEFAULT 1,
    batch_id uuid,
    batch_sequence integer,
    source_file_url text,
    source_file_type character varying(10),
    parent_job_id uuid,
    page_number integer,
    conversion_dpi integer DEFAULT 300,
    rendering_intent character varying(30) DEFAULT 'perceptual'::character varying,
    preset_id uuid,
    face_validation_id uuid,
    trace_id character varying(64),
    CONSTRAINT print_jobs_color_mode_check CHECK (((color_mode)::text = ANY (ARRAY[('color'::character varying)::text, ('bw'::character varying)::text]))),
    CONSTRAINT print_jobs_copies_check CHECK (((copies >= 1) AND (copies <= 999))),
    CONSTRAINT print_jobs_fit_mode_check CHECK (((fit_mode)::text = ANY (ARRAY[('fit'::character varying)::text, ('fill'::character varying)::text, ('stretch'::character varying)::text, ('actual'::character varying)::text]))),
    CONSTRAINT print_jobs_orientation_check CHECK (((orientation)::text = ANY (ARRAY[('portrait'::character varying)::text, ('landscape'::character varying)::text, ('auto'::character varying)::text]))),
    CONSTRAINT print_jobs_priority_check CHECK (((priority >= 0) AND (priority <= 10))),
    CONSTRAINT print_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'sending'::character varying, 'processing'::character varying, 'applying_icc'::character varying, 'rendering_layout'::character varying, 'printing'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying, 'converting'::character varying, 'paused'::character varying, 'held'::character varying, 'scheduled'::character varying, 'splitting'::character varying, 'finishing'::character varying])::text[])))
);


--
-- Name: COLUMN print_jobs.rotation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.print_jobs.rotation IS 'Image rotation in degrees (0, 90, 180, 270)';


--
-- Name: COLUMN print_jobs.priority; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.print_jobs.priority IS '0=normal, 4-6=elevated, 7-8=urgent, 9-10=critical (POS)';


--
-- Name: print_daily_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.print_daily_stats AS
 SELECT date_trunc('day'::text, created_at) AS day,
    studio_id,
    count(*) AS total_jobs,
    count(*) FILTER (WHERE ((status)::text = 'completed'::text)) AS completed_jobs,
    count(*) FILTER (WHERE ((status)::text = 'failed'::text)) AS failed_jobs,
    sum(copies) AS total_copies,
    COALESCE(sum(price_total), (0)::numeric) AS total_revenue,
    avg((EXTRACT(epoch FROM (completed_at - created_at)) * (1000)::numeric)) FILTER (WHERE ((status)::text = 'completed'::text)) AS avg_duration_ms
   FROM public.print_jobs
  GROUP BY (date_trunc('day'::text, created_at)), studio_id;


--
-- Name: print_daily_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.print_daily_summary AS
 SELECT ((created_at AT TIME ZONE 'Europe/Moscow'::text))::date AS day,
    studio_id,
    (count(*))::integer AS total_jobs,
    (count(*) FILTER (WHERE ((status)::text = 'completed'::text)))::integer AS completed_jobs,
    (count(*) FILTER (WHERE ((status)::text = 'failed'::text)))::integer AS failed_jobs,
    (count(*) FILTER (WHERE ((status)::text = 'cancelled'::text)))::integer AS cancelled_jobs,
    (COALESCE(sum(copies), (0)::bigint))::integer AS total_copies,
    (COALESCE(sum(copies) FILTER (WHERE ((status)::text = 'completed'::text)), (0)::bigint))::integer AS completed_copies,
    (COALESCE(sum(pages_printed) FILTER (WHERE ((status)::text = 'completed'::text)), (0)::bigint))::integer AS pages_printed,
    (COALESCE(sum(price_total) FILTER (WHERE ((status)::text = 'completed'::text)), (0)::numeric))::numeric(12,2) AS revenue,
    (round(avg(duration_ms) FILTER (WHERE ((status)::text = 'completed'::text))))::integer AS avg_duration_ms,
    (count(DISTINCT created_by) FILTER (WHERE ((status)::text = 'completed'::text)))::integer AS active_operators,
    (count(DISTINCT printer_id) FILTER (WHERE ((status)::text = 'completed'::text)))::integer AS active_printers,
    (count(DISTINCT batch_id))::integer AS batches
   FROM public.print_jobs pj
  GROUP BY (((created_at AT TIME ZONE 'Europe/Moscow'::text))::date), studio_id;


--
-- Name: print_operator_daily; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.print_operator_daily AS
 SELECT ((pj.created_at AT TIME ZONE 'Europe/Moscow'::text))::date AS day,
    pj.created_by AS operator_id,
    u.display_name AS operator_name,
    pj.studio_id,
    (count(*))::integer AS total_jobs,
    (count(*) FILTER (WHERE ((pj.status)::text = 'completed'::text)))::integer AS completed,
    (count(*) FILTER (WHERE ((pj.status)::text = 'failed'::text)))::integer AS failed,
    (COALESCE(sum(pj.copies), (0)::bigint))::integer AS total_copies,
    (COALESCE(sum(pj.price_total) FILTER (WHERE ((pj.status)::text = 'completed'::text)), (0)::numeric))::numeric(12,2) AS revenue,
    (round(avg(pj.duration_ms) FILTER (WHERE ((pj.status)::text = 'completed'::text))))::integer AS avg_speed_ms
   FROM (public.print_jobs pj
     LEFT JOIN public.users u ON ((u.id = pj.created_by)))
  GROUP BY (((pj.created_at AT TIME ZONE 'Europe/Moscow'::text))::date), pj.created_by, u.display_name, pj.studio_id;


--
-- Name: print_operator_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.print_operator_stats AS
 SELECT created_by AS operator_id,
    count(*) AS total_jobs,
    count(*) FILTER (WHERE ((status)::text = 'completed'::text)) AS completed,
    count(*) FILTER (WHERE ((status)::text = 'failed'::text)) AS failed,
    sum(copies) AS total_copies,
    COALESCE(sum(price_total), (0)::numeric) AS revenue
   FROM public.print_jobs
  GROUP BY created_by;


--
-- Name: print_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    icon character varying(50) DEFAULT 'print'::character varying NOT NULL,
    printer_type character varying(20) NOT NULL,
    sublimation boolean DEFAULT false NOT NULL,
    paper_size character varying(30) DEFAULT 'A4'::character varying NOT NULL,
    media_type character varying(50),
    quality character varying(30) DEFAULT 'normal'::character varying NOT NULL,
    fit_mode character varying(20) DEFAULT 'fit'::character varying NOT NULL,
    borderless boolean DEFAULT false NOT NULL,
    color_mode character varying(10) DEFAULT 'color'::character varying NOT NULL,
    duplex boolean DEFAULT false NOT NULL,
    mirror boolean DEFAULT false NOT NULL,
    price double precision DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    studio_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rendering_intent character varying(30) DEFAULT 'perceptual'::character varying,
    slug character varying(50),
    face_requirements jsonb,
    CONSTRAINT print_presets_color_mode_check CHECK (((color_mode)::text = ANY ((ARRAY['color'::character varying, 'bw'::character varying])::text[]))),
    CONSTRAINT print_presets_fit_mode_check CHECK (((fit_mode)::text = ANY ((ARRAY['fit'::character varying, 'fill'::character varying, 'stretch'::character varying, 'actual'::character varying])::text[]))),
    CONSTRAINT print_presets_printer_type_check CHECK (((printer_type)::text = ANY ((ARRAY['photo'::character varying, 'mfp'::character varying, 'document'::character varying])::text[])))
);


--
-- Name: printers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.printers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    printer_type character varying(20) NOT NULL,
    studio_id uuid,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    cups_printer_name character varying(200),
    default_icc_profile_id uuid,
    CONSTRAINT printers_printer_type_check CHECK (((printer_type)::text = ANY (ARRAY[('photo'::character varying)::text, ('document'::character varying)::text, ('mfp'::character varying)::text])))
);


--
-- Name: print_printer_daily; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.print_printer_daily AS
 SELECT ((pj.created_at AT TIME ZONE 'Europe/Moscow'::text))::date AS day,
    pj.printer_id,
    p.name AS printer_name,
    p.printer_type,
    pj.studio_id,
    (count(*))::integer AS total_jobs,
    (count(*) FILTER (WHERE ((pj.status)::text = 'completed'::text)))::integer AS completed,
    (count(*) FILTER (WHERE ((pj.status)::text = 'failed'::text)))::integer AS failed,
    (COALESCE(sum(pj.copies), (0)::bigint))::integer AS total_copies,
    (COALESCE(sum(pj.price_total) FILTER (WHERE ((pj.status)::text = 'completed'::text)), (0)::numeric))::numeric(12,2) AS revenue,
    (round(avg(pj.duration_ms) FILTER (WHERE ((pj.status)::text = 'completed'::text))))::integer AS avg_duration_ms
   FROM (public.print_jobs pj
     LEFT JOIN public.printers p ON ((p.id = pj.printer_id)))
  GROUP BY (((pj.created_at AT TIME ZONE 'Europe/Moscow'::text))::date), pj.printer_id, p.name, p.printer_type, pj.studio_id;


--
-- Name: print_speed_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_speed_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id text,
    photo_count integer NOT NULL,
    format text DEFAULT '10x15'::text NOT NULL,
    duration_minutes numeric(6,1) NOT NULL,
    photos_per_minute numeric(6,2) GENERATED ALWAYS AS (((photo_count)::numeric / NULLIF(duration_minutes, (0)::numeric))) STORED,
    operator_id uuid,
    printer_name text,
    notes text,
    printed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE print_speed_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.print_speed_log IS 'Historical print speed metrics per job';


--
-- Name: COLUMN print_speed_log.photos_per_minute; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.print_speed_log.photos_per_minute IS 'Auto-calculated: photo_count / duration_minutes';


--
-- Name: print_waste_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_waste_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    print_job_id uuid,
    printer_id uuid,
    studio_id uuid,
    waste_type character varying(20) NOT NULL,
    sheets_wasted integer NOT NULL,
    paper_size character varying(30),
    media_type character varying(50),
    cost_estimate numeric(10,2),
    notes text,
    reported_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT print_waste_log_sheets_wasted_check CHECK ((sheets_wasted > 0)),
    CONSTRAINT print_waste_log_waste_type_check CHECK (((waste_type)::text = ANY ((ARRAY['jam'::character varying, 'color_defect'::character varying, 'alignment'::character varying, 'media_defect'::character varying, 'operator_error'::character varying, 'other'::character varying])::text[])))
);


--
-- Name: printer_telemetry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.printer_telemetry (
    id bigint NOT NULL,
    printer_id uuid NOT NULL,
    studio_id uuid,
    bridge_device_id uuid,
    is_online boolean DEFAULT false,
    state character varying(50),
    state_reasons text[],
    supplies jsonb DEFAULT '[]'::jsonb,
    trays jsonb DEFAULT '[]'::jsonb,
    counters jsonb DEFAULT '{}'::jsonb,
    errors jsonb DEFAULT '[]'::jsonb,
    model character varying(200),
    manufacturer character varying(100),
    serial_number character varying(100),
    firmware_version character varying(100),
    collected_at timestamp with time zone DEFAULT now(),
    consumable_usage jsonb
);


--
-- Name: printer_current_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.printer_current_status AS
 SELECT DISTINCT ON (pt.printer_id) pt.id,
    pt.printer_id,
    pt.studio_id,
    pt.bridge_device_id,
    pt.is_online,
    pt.state,
    pt.state_reasons,
    pt.supplies,
    pt.trays,
    pt.counters,
    pt.errors,
    pt.model,
    pt.manufacturer,
    pt.serial_number,
    pt.firmware_version,
    pt.collected_at,
    pt.consumable_usage,
    p.name AS printer_name,
    p.printer_type,
    p.cups_printer_name,
    bd.name AS bridge_name,
    bd.is_online AS bridge_online,
    bd.agent_type
   FROM ((public.printer_telemetry pt
     JOIN public.printers p ON ((p.id = pt.printer_id)))
     LEFT JOIN public.bridge_devices bd ON ((bd.id = pt.bridge_device_id)))
  ORDER BY pt.printer_id, pt.collected_at DESC;


--
-- Name: printer_telemetry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.printer_telemetry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: printer_telemetry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.printer_telemetry_id_seq OWNED BY public.printer_telemetry.id;


--
-- Name: printer_utilization_hourly; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.printer_utilization_hourly AS
 SELECT date_trunc('hour'::text, (pt.collected_at AT TIME ZONE 'Europe/Moscow'::text)) AS hour,
    pt.printer_id,
    p.name AS printer_name,
    pt.studio_id,
    (count(*))::integer AS samples,
    (count(*) FILTER (WHERE ((pt.state)::text = 'idle'::text)))::integer AS idle_samples,
    (count(*) FILTER (WHERE ((pt.state)::text = ANY ((ARRAY['processing'::character varying, 'printing'::character varying])::text[]))))::integer AS busy_samples,
    (count(*) FILTER (WHERE ((pt.state)::text = ANY ((ARRAY['error'::character varying, 'warning'::character varying])::text[]))))::integer AS error_samples,
    (count(*) FILTER (WHERE (NOT pt.is_online)))::integer AS offline_samples,
        CASE
            WHEN (count(*) > 0) THEN round((((count(*) FILTER (WHERE ((pt.state)::text = ANY ((ARRAY['processing'::character varying, 'printing'::character varying])::text[]))))::numeric / (count(*))::numeric) * (100)::numeric), 1)
            ELSE (0)::numeric
        END AS utilization_pct
   FROM (public.printer_telemetry pt
     LEFT JOIN public.printers p ON ((p.id = pt.printer_id)))
  GROUP BY (date_trunc('hour'::text, (pt.collected_at AT TIME ZONE 'Europe/Moscow'::text))), pt.printer_id, p.name, pt.studio_id;


--
-- Name: printing_house_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.printing_house_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    printing_house_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    sku character varying(100),
    description text,
    base_price numeric(10,2) NOT NULL,
    price_unit character varying(30) DEFAULT 'piece'::character varying NOT NULL,
    min_quantity integer DEFAULT 1 NOT NULL,
    available_formats text[] DEFAULT '{}'::text[] NOT NULL,
    available_materials text[] DEFAULT '{}'::text[] NOT NULL,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    lead_time_days integer DEFAULT 3 NOT NULL,
    express_available boolean DEFAULT false NOT NULL,
    express_surcharge_pct numeric(5,2) DEFAULT 50 NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: printing_houses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.printing_houses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    contact_name character varying(255),
    contact_phone character varying(30),
    contact_email character varying(255),
    website character varying(500),
    address text,
    notes text,
    api_type character varying(50) DEFAULT 'manual'::character varying NOT NULL,
    api_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    capabilities text[] DEFAULT '{}'::text[] NOT NULL,
    delivery_zones text[] DEFAULT '{}'::text[] NOT NULL,
    min_order_amount numeric(10,2) DEFAULT 0 NOT NULL,
    quality_score numeric(3,2) DEFAULT 0 NOT NULL,
    on_time_rate numeric(5,2) DEFAULT 0 NOT NULL,
    defect_rate numeric(5,2) DEFAULT 0 NOT NULL,
    total_orders integer DEFAULT 0 NOT NULL,
    total_spent numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT printing_houses_api_type_check CHECK (((api_type)::text = ANY (ARRAY[('manual'::character varying)::text, ('api'::character varying)::text, ('email'::character varying)::text]))),
    CONSTRAINT printing_houses_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('inactive'::character varying)::text, ('testing'::character varying)::text])))
);


--
-- Name: priority_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.priority_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(100) NOT NULL,
    positions_skipped integer NOT NULL,
    surcharge_amount numeric(10,2) NOT NULL,
    payment_id character varying(100),
    payment_status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_categories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    parent_id uuid,
    name character varying(255) NOT NULL,
    sort_order integer DEFAULT 0,
    icon character varying(50),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_reference_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_reference_data (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ref_type character varying(50) NOT NULL,
    ref_key character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    category_scope text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: product_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_stock (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    quantity numeric(10,3) DEFAULT 0,
    min_quantity numeric(10,3) DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    estimated_ink_ml numeric(10,1),
    last_refill_at timestamp with time zone,
    avg_daily_usage numeric(10,3) DEFAULT 0,
    days_until_empty integer
);


--
-- Name: production_order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    production_order_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    old_value character varying(200),
    new_value character varying(200),
    comment text,
    created_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: production_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_number character varying(50) NOT NULL,
    printing_house_id uuid NOT NULL,
    photo_print_order_id uuid,
    customer_id uuid,
    created_by uuid NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_cost numeric(10,2) DEFAULT 0 NOT NULL,
    deadline_at timestamp with time zone,
    estimated_delivery_at timestamp with time zone,
    actual_delivery_at timestamp with time zone,
    delivery_method character varying(50) DEFAULT 'pickup'::character varying NOT NULL,
    tracking_number character varying(100),
    quality_rating integer,
    quality_notes text,
    has_defects boolean DEFAULT false NOT NULL,
    internal_notes text,
    printing_house_notes text,
    sent_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT production_orders_delivery_method_check CHECK (((delivery_method)::text = ANY (ARRAY[('pickup'::character varying)::text, ('courier'::character varying)::text, ('post'::character varying)::text]))),
    CONSTRAINT production_orders_quality_rating_check CHECK (((quality_rating >= 1) AND (quality_rating <= 5))),
    CONSTRAINT production_orders_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('pending'::character varying)::text, ('sent'::character varying)::text, ('confirmed'::character varying)::text, ('in_production'::character varying)::text, ('quality_check'::character varying)::text, ('shipped'::character varying)::text, ('delivered'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text, ('returned'::character varying)::text])))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    category_id uuid,
    name character varying(255) NOT NULL,
    product_type character varying(20) DEFAULT 'service'::character varying NOT NULL,
    code character varying(50),
    barcode character varying(50),
    unit character varying(20) DEFAULT 'piece'::character varying,
    sell_price numeric(10,2) NOT NULL,
    cost_price numeric(10,2),
    vat_rate character varying(20) DEFAULT 'NoVat'::character varying,
    tax_system character varying(20) DEFAULT 'StsIncome'::character varying,
    is_discount_allowed boolean DEFAULT true,
    is_bonus_allowed boolean DEFAULT true,
    is_subscription_eligible boolean DEFAULT false,
    subscription_credit_value numeric(10,2),
    image_url character varying(500),
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    is_favorite boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT products_product_type_check CHECK (((product_type)::text = ANY (ARRAY[('product'::character varying)::text, ('service'::character varying)::text]))),
    CONSTRAINT products_tax_system_check CHECK (((tax_system)::text = ANY (ARRAY[('Bts'::character varying)::text, ('StsIncome'::character varying)::text, ('StsExpenses'::character varying)::text, ('Patent'::character varying)::text]))),
    CONSTRAINT products_unit_check CHECK (((unit)::text = ANY (ARRAY[('piece'::character varying)::text, ('sheet'::character varying)::text, ('copy'::character varying)::text, ('set'::character varying)::text, ('meter'::character varying)::text, ('kg'::character varying)::text, ('liter'::character varying)::text, ('hour'::character varying)::text, ('minute'::character varying)::text]))),
    CONSTRAINT products_vat_rate_check CHECK (((vat_rate)::text = ANY (ARRAY[('NoVat'::character varying)::text, ('Zero'::character varying)::text, ('Main'::character varying)::text, ('Preferential'::character varying)::text])))
);


--
-- Name: promo_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promotion_id uuid NOT NULL,
    campaign_id uuid,
    order_id uuid,
    order_type character varying(30),
    customer_id uuid,
    customer_phone character varying(20),
    promo_code character varying(50) NOT NULL,
    discount_amount numeric(10,2) NOT NULL,
    original_amount numeric(10,2),
    status character varying(20) DEFAULT 'applied'::character varying,
    redeemed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT promo_redemptions_status_check CHECK (((status)::text = ANY ((ARRAY['applied'::character varying, 'reversed'::character varying])::text[])))
);


--
-- Name: TABLE promo_redemptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.promo_redemptions IS 'Журнал применений промокодов с привязкой к кампаниям и заказам';


--
-- Name: COLUMN promo_redemptions.order_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.promo_redemptions.order_id IS 'ID заказа (не FK — может ссылаться на разные таблицы)';


--
-- Name: COLUMN promo_redemptions.order_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.promo_redemptions.order_type IS 'Тип заказа: photo_print | booking | pos_receipt';


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    title character varying(255) NOT NULL,
    description text NOT NULL,
    image_url character varying(500),
    discount_percent integer,
    discount_amount numeric(10,2),
    original_price numeric(10,2),
    promo_price numeric(10,2),
    promo_code character varying(50),
    usage_limit integer,
    usage_count integer DEFAULT 0,
    service_slug character varying(100),
    cta_text character varying(100) DEFAULT 'Подробнее'::character varying,
    cta_url character varying(500),
    conditions text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    keys jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: rbac_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_audit_log (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    actor_id uuid,
    actor_name character varying(255),
    action character varying(50) NOT NULL,
    target_user_id uuid,
    target_role_id uuid,
    target_permission_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    ip character varying(45),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: rbac_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_permissions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slug character varying(100) NOT NULL,
    display_name character varying(100) NOT NULL,
    description text,
    module character varying(50) NOT NULL,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: rbac_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: rbac_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_roles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slug character varying(30) NOT NULL,
    display_name character varying(100) NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: rbac_user_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rbac_user_overrides (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    override_type character varying(5) NOT NULL,
    reason text,
    granted_by uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT rbac_user_overrides_override_type_check CHECK (((override_type)::text = ANY (ARRAY[('grant'::character varying)::text, ('deny'::character varying)::text])))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address inet,
    user_agent text
);


--
-- Name: refund_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id text NOT NULL,
    user_id uuid NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    admin_comment text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refund_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: replay_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.replay_chunks (
    id bigint NOT NULL,
    session_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    events jsonb NOT NULL,
    event_count integer DEFAULT 0 NOT NULL,
    size_bytes integer DEFAULT 0 NOT NULL,
    start_time bigint,
    end_time bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: replay_chunks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.replay_chunks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: replay_chunks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.replay_chunks_id_seq OWNED BY public.replay_chunks.id;


--
-- Name: replay_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.replay_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id character varying(64) NOT NULL,
    fingerprint_visitor_id character varying(128),
    user_id uuid,
    landing_page text,
    user_agent text,
    screen_width integer,
    screen_height integer,
    device_type character varying(20) DEFAULT 'desktop'::character varying,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    duration_seconds integer,
    total_pages integer DEFAULT 0 NOT NULL,
    total_clicks integer DEFAULT 0 NOT NULL,
    chunk_count integer DEFAULT 0 NOT NULL,
    total_size_bytes bigint DEFAULT 0 NOT NULL,
    chat_session_id character varying(128),
    order_ids uuid[] DEFAULT '{}'::uuid[],
    has_error boolean DEFAULT false NOT NULL,
    is_complete boolean DEFAULT false NOT NULL
);


--
-- Name: review_platform_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_platform_stats (
    id integer NOT NULL,
    platform character varying(50) NOT NULL,
    location_slug character varying(100) NOT NULL,
    location_name character varying(255),
    external_url text NOT NULL,
    rating numeric(2,1),
    review_count integer DEFAULT 0,
    last_synced_at timestamp with time zone,
    sync_error text,
    raw_response jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: review_platform_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.review_platform_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: review_platform_stats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.review_platform_stats_id_seq OWNED BY public.review_platform_stats.id;


--
-- Name: review_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id text,
    client_name text,
    client_phone text,
    client_email text,
    channel text DEFAULT 'email'::text NOT NULL,
    external_chat_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    send_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    clicked_at timestamp with time zone,
    click_platform text,
    source text NOT NULL,
    location_slug text,
    review_token text,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    nps_rating smallint,
    service_name text,
    employee_id uuid,
    chat_session_id uuid
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    photographer_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text,
    author_display_name character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: rollout_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rollout_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    release_id uuid NOT NULL,
    strategy character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    target_agent_type character varying(20) NOT NULL,
    target_platform character varying(20),
    total_agents integer DEFAULT 0,
    completed_agents integer DEFAULT 0,
    failed_agents integer DEFAULT 0,
    canary_count integer DEFAULT 1,
    canary_wait_minutes integer DEFAULT 15,
    batch_percent integer DEFAULT 10,
    batch_wait_minutes integer DEFAULT 30,
    current_phase character varying(20) DEFAULT 'canary'::character varying,
    phase_started_at timestamp with time zone,
    next_phase_at timestamp with time zone,
    initiated_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT rollout_plans_current_phase_check CHECK (((current_phase)::text = ANY ((ARRAY['canary'::character varying, 'batch'::character varying, 'fleet'::character varying, 'done'::character varying])::text[]))),
    CONSTRAINT rollout_plans_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'paused'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT rollout_plans_strategy_check CHECK (((strategy)::text = ANY ((ARRAY['canary'::character varying, 'batch'::character varying, 'fleet'::character varying])::text[])))
);


--
-- Name: saved_payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_payment_methods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token character varying(500) NOT NULL,
    card_first_six character varying(6),
    card_last_four character varying(4),
    card_type character varying(30),
    card_exp_date character varying(10),
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone
);


--
-- Name: schedule_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    photographer_id uuid NOT NULL,
    auto_accept_bookings boolean DEFAULT false NOT NULL,
    buffer_time_minutes integer DEFAULT 30 NOT NULL,
    max_daily_bookings integer DEFAULT 5 NOT NULL,
    advance_booking_days integer DEFAULT 30 NOT NULL,
    same_day_booking_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schedule_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    shift_pattern character varying(10) NOT NULL,
    pattern_start_date date NOT NULL,
    end_date date,
    requested_shifts jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    admin_id uuid,
    admin_comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schedule_requests_shift_pattern_check CHECK (((shift_pattern)::text = ANY (ARRAY[('2/2'::character varying)::text, ('1/1'::character varying)::text, ('3/3'::character varying)::text, ('custom'::character varying)::text]))),
    CONSTRAINT schedule_requests_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('revision_requested'::character varying)::text])))
);


--
-- Name: scheduled_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    content text NOT NULL,
    send_at timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_by uuid NOT NULL,
    sent_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scheduled_messages_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'cancelled'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    photographer_id uuid NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    day integer,
    start_time time without time zone,
    end_time time without time zone,
    is_available boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT schedules_day_check CHECK (((day >= 1) AND (day <= 31))),
    CONSTRAINT schedules_month_check CHECK (((month >= 1) AND (month <= 12)))
);


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    event_type text NOT NULL,
    file_name text,
    file_hash text,
    original_size bigint,
    clean_size bigint,
    threat_type text,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT security_events_event_type_check CHECK ((event_type = ANY (ARRAY['scan'::text, 'threat'::text, 'defender_status'::text])))
);


--
-- Name: service_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    name character varying(200) NOT NULL,
    category character varying(50) NOT NULL,
    required_device_type character varying(30),
    requires_template boolean DEFAULT false,
    requires_design_editor boolean DEFAULT false,
    base_price double precision DEFAULT 0,
    price_per_unit double precision DEFAULT 0,
    price_rules jsonb DEFAULT '{}'::jsonb,
    default_print_profile_id uuid,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    paper_type character varying(20)
);


--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    icon character varying(50),
    gradient character varying(255),
    image_url character varying(500),
    price_range character varying(50),
    display_channels text[] DEFAULT '{website,chatbot,pos}'::text[],
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    valid_delivery_methods text[] DEFAULT '{electronic,pickup,postal}'::text[],
    processing_time character varying(100),
    crm_orderable boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: service_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    option_group_id uuid NOT NULL,
    product_id uuid,
    slug character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    icon character varying(50),
    color character varying(20),
    base_price numeric(10,2) NOT NULL,
    price_online numeric(10,2),
    price_studio numeric(10,2),
    price_next_unit numeric(10,2),
    price_max numeric(10,2),
    promo_first_price numeric(10,2),
    promo_description character varying(255),
    features jsonb DEFAULT '[]'::jsonb,
    popular boolean DEFAULT false,
    original_price numeric(10,2),
    discount_percent integer,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    satisfies_requires boolean DEFAULT true,
    estimated_minutes integer DEFAULT 30,
    processing_time character varying(100)
);


--
-- Name: COLUMN service_options.satisfies_requires; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.service_options.satisfies_requires IS 'Опция удовлетворяет requires-правила при проверке группы. false = "базовый уровень", не считается для requires.';


--
-- Name: service_work_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_work_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id uuid,
    employee_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    duration_minutes integer,
    hourly_rate numeric(10,2) DEFAULT 2000.00 NOT NULL,
    calculated_amount numeric(10,2),
    is_custom_order boolean DEFAULT false NOT NULL,
    custom_surcharge numeric(10,2) DEFAULT 0,
    custom_surcharge_reason text,
    order_description text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_work_logs_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: shift_briefings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_briefings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shift_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    briefing_date date NOT NULL,
    summary text NOT NULL,
    structured_data jsonb DEFAULT '{}'::jsonb,
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    generated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shooting_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shooting_locations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    address text,
    coordinates jsonb DEFAULT '{}'::jsonb,
    images jsonb[] DEFAULT ARRAY[]::jsonb[],
    description text,
    category character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: staff_conversation_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_conversation_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    left_at timestamp with time zone,
    role character varying(20) DEFAULT 'member'::character varying,
    muted_until timestamp with time zone
);


--
-- Name: staff_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(200),
    type character varying(10) DEFAULT 'direct'::character varying NOT NULL,
    created_by uuid,
    last_message_at timestamp with time zone DEFAULT now(),
    last_message_preview text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    archived_at timestamp with time zone,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT staff_conversations_type_check CHECK (((type)::text = ANY ((ARRAY['direct'::character varying, 'group'::character varying, 'general'::character varying])::text[])))
);


--
-- Name: staff_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_mentions (
    message_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: staff_message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_message_reactions (
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji character varying(10) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: staff_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    sender_name character varying(200) NOT NULL,
    content text NOT NULL,
    message_type character varying(20) DEFAULT 'text'::character varying,
    attachment_url text,
    created_at timestamp with time zone DEFAULT now(),
    reply_to_message_id uuid,
    reply_to_content text,
    reply_to_sender_name character varying(200),
    original_filename character varying(500),
    deleted_at timestamp with time zone,
    edited_at timestamp with time zone,
    pinned_at timestamp with time zone,
    pinned_by uuid,
    is_forwarded boolean DEFAULT false,
    forwarded_from_name character varying(255),
    CONSTRAINT staff_messages_message_type_check CHECK (((message_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'file'::character varying, 'video'::character varying, 'audio'::character varying])::text[])))
);


--
-- Name: staff_read_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_read_receipts (
    user_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now(),
    last_read_message_id uuid,
    delivered_at timestamp with time zone
);


--
-- Name: studio_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studio_reviews (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    studio_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT studio_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: studio_schedule_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studio_schedule_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    studio_id uuid NOT NULL,
    exception_date date NOT NULL,
    is_closed boolean DEFAULT false,
    open_time time without time zone,
    close_time time without time zone,
    reason character varying(255),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: studio_working_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studio_working_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    studio_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_time time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    end_time time without time zone DEFAULT '19:30:00'::time without time zone NOT NULL,
    is_open boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT studio_working_hours_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: studios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studios (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    address text,
    coordinates jsonb DEFAULT '{}'::jsonb,
    images jsonb[] DEFAULT ARRAY[]::jsonb[],
    rating jsonb DEFAULT '{"average": 0, "totalReviews": 0}'::jsonb,
    is_popular boolean DEFAULT false,
    is_featured boolean DEFAULT false,
    description text,
    amenities text[] DEFAULT ARRAY[]::text[],
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    location_code character varying(20),
    timezone character varying(50) DEFAULT 'Europe/Moscow'::character varying,
    operating_hours jsonb DEFAULT '{}'::jsonb,
    contact_person_id uuid,
    network_config jsonb DEFAULT '{}'::jsonb,
    location_type character varying(20) DEFAULT 'owned'::character varying,
    region character varying(100),
    city character varying(100),
    is_infra_enabled boolean DEFAULT false
);


--
-- Name: subscription_card_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_card_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    user_id uuid,
    idempotency_key character varying(64) NOT NULL,
    status character varying(24) DEFAULT 'awaiting_token'::character varying NOT NULL,
    old_cp_subscription_id character varying(100),
    old_cp_token character varying(255),
    new_cp_subscription_id character varying(100),
    new_cp_token character varying(255),
    new_card_last_four character varying(4),
    new_card_type character varying(20),
    expected_amount numeric(10,2) NOT NULL,
    verify_transaction_id bigint,
    cancel_attempts integer DEFAULT 0 NOT NULL,
    refunded boolean DEFAULT false NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scc_status_check CHECK (((status)::text = ANY ((ARRAY['awaiting_token'::character varying, 'swapping'::character varying, 'pending_cancel_old'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: subscription_credit_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_credit_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    credit_id uuid,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    credit_multiplier numeric(4,2) DEFAULT 1 NOT NULL,
    credits_consumed integer NOT NULL,
    pos_receipt_id uuid,
    employee_id uuid,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_credits (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    subscription_id uuid NOT NULL,
    product_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    total_credits numeric(10,3) NOT NULL,
    used_credits numeric(10,3) DEFAULT 0,
    rolled_over_from uuid,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: subscription_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_offers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    plan_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    chat_session_id uuid NOT NULL,
    customer_phone character varying(20),
    customer_name character varying(255),
    token character varying(64) NOT NULL,
    status character varying(20) DEFAULT 'sent'::character varying,
    monthly_price numeric(10,2) NOT NULL,
    message_id uuid,
    subscription_id uuid,
    expires_at timestamp with time zone NOT NULL,
    opened_at timestamp with time zone,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT subscription_offers_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'opened'::character varying, 'accepted'::character varying, 'declined'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: subscription_plan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plan_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    plan_id uuid NOT NULL,
    product_id uuid NOT NULL,
    included_quantity numeric(10,3) NOT NULL,
    credit_price numeric(10,2),
    is_required boolean DEFAULT false,
    sort_order integer DEFAULT 0
);


--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plans (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(100) NOT NULL,
    description text,
    base_price numeric(10,2) NOT NULL,
    is_customizable boolean DEFAULT true,
    min_price numeric(10,2),
    billing_period character varying(20) DEFAULT 'monthly'::character varying,
    subscriber_discount_percent numeric(5,2) DEFAULT 0,
    credits_rollover_months integer DEFAULT 3,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    features jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    category character varying(50) DEFAULT 'photo'::character varying,
    icon character varying(50) DEFAULT 'photo_camera'::character varying,
    savings_label character varying(100),
    is_popular boolean DEFAULT false,
    is_recommended boolean DEFAULT false,
    CONSTRAINT subscription_plans_billing_period_check CHECK (((billing_period)::text = ANY (ARRAY[('monthly'::character varying)::text, ('quarterly'::character varying)::text, ('yearly'::character varying)::text])))
);


--
-- Name: system_telemetry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_telemetry (
    id bigint NOT NULL,
    agent_id uuid NOT NULL,
    studio_id uuid NOT NULL,
    cpu_percent double precision,
    memory_used_mb integer,
    memory_total_mb integer,
    disk_used_gb double precision,
    disk_total_gb double precision,
    network_rx_bytes_sec bigint,
    network_tx_bytes_sec bigint,
    peripherals jsonb DEFAULT '[]'::jsonb,
    agent_statuses jsonb DEFAULT '{}'::jsonb,
    collected_at timestamp with time zone DEFAULT now()
);


--
-- Name: system_telemetry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_telemetry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_telemetry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_telemetry_id_seq OWNED BY public.system_telemetry.id;


--
-- Name: task_handoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_handoffs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    from_employee_id uuid NOT NULL,
    to_employee_id uuid,
    from_shift_id uuid,
    handoff_note text NOT NULL,
    ai_context_summary text,
    acknowledged boolean DEFAULT false,
    acknowledged_at timestamp with time zone,
    acknowledged_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: task_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_a_id uuid NOT NULL,
    task_b_id uuid NOT NULL,
    link_type character varying(20) DEFAULT 'related'::character varying,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT task_links_check CHECK ((task_a_id <> task_b_id)),
    CONSTRAINT task_links_link_type_check CHECK (((link_type)::text = ANY (ARRAY[('related'::character varying)::text, ('duplicate'::character varying)::text, ('parent_child'::character varying)::text, ('merged'::character varying)::text])))
);


--
-- Name: task_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    author_id uuid NOT NULL,
    note_type character varying(20) DEFAULT 'comment'::character varying,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT task_notes_note_type_check CHECK (((note_type)::text = ANY (ARRAY[('comment'::character varying)::text, ('status_change'::character varying)::text, ('handoff'::character varying)::text, ('system'::character varying)::text, ('ai_summary'::character varying)::text])))
);


--
-- Name: telegram_auth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_auth_tokens (
    id integer NOT NULL,
    token character varying(64) NOT NULL,
    telegram_id character varying(255),
    telegram_username character varying(255),
    telegram_first_name character varying(255),
    telegram_last_name character varying(255),
    telegram_photo_url text,
    status character varying(20) DEFAULT 'pending'::character varying,
    access_token text,
    refresh_token text,
    user_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    confirmed_at timestamp without time zone,
    expires_at timestamp without time zone DEFAULT (now() + '00:05:00'::interval)
);


--
-- Name: telegram_auth_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telegram_auth_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telegram_auth_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telegram_auth_tokens_id_seq OWNED BY public.telegram_auth_tokens.id;


--
-- Name: telegram_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    telegram_id bigint NOT NULL,
    telegram_username character varying(100),
    first_name character varying(100),
    last_name character varying(100),
    visitor_id character varying(64),
    photo_url text,
    language_code character varying(10),
    is_premium boolean DEFAULT false,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_achievements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loyalty_profile_id uuid NOT NULL,
    achievement_id character varying(50) NOT NULL,
    unlocked_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    setting_type character varying(50) NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_subscriptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    phone character varying(20),
    customer_name character varying(255),
    plan_id uuid,
    custom_items jsonb DEFAULT '[]'::jsonb,
    monthly_price numeric(10,2) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    cloudpayments_subscription_id character varying(100),
    cloudpayments_token character varying(255),
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    next_payment_date timestamp with time zone,
    pause_until timestamp with time zone,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    card_last_four character varying(4),
    card_type character varying(20),
    card_change_in_progress boolean DEFAULT false NOT NULL,
    card_change_started_at timestamp with time zone,
    CONSTRAINT user_subscriptions_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('paused'::character varying)::text, ('cancelled'::character varying)::text, ('expired'::character varying)::text, ('pending'::character varying)::text])))
);


--
-- Name: verification_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    phone character varying(20) NOT NULL,
    code character varying(6) NOT NULL,
    method character varying(20) NOT NULL,
    purpose character varying(20) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    attempts integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT verification_codes_method_check CHECK (((method)::text = ANY (ARRAY[('sms'::character varying)::text, ('telegram'::character varying)::text, ('max'::character varying)::text]))),
    CONSTRAINT verification_codes_purpose_check CHECK (((purpose)::text = ANY (ARRAY[('phone_verify'::character varying)::text, ('two_factor'::character varying)::text, ('booking_confirm'::character varying)::text, ('phone_login'::character varying)::text])))
);


--
-- Name: visitor_chat_cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_chat_cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    service_id character varying(200) NOT NULL,
    service_name character varying(200) NOT NULL,
    service_description text,
    service_icon character varying(100),
    price numeric(10,2) NOT NULL,
    next_price numeric(10,2),
    price_max numeric(10,2),
    quantity integer DEFAULT 1 NOT NULL,
    note text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT visitor_chat_cart_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: visitor_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    sender_type character varying(20) NOT NULL,
    sender_id character varying(100),
    sender_name character varying(100),
    message_type character varying(20) DEFAULT 'text'::character varying,
    content text NOT NULL,
    attachment_url character varying(500),
    attachment_name character varying(255),
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    bitrix_message_id character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    external_message_id character varying(255),
    delivered_at timestamp with time zone,
    reply_to_message_id uuid,
    is_forwarded boolean DEFAULT false,
    forwarded_from_name character varying(200),
    client_message_id character varying(36),
    event_type character varying(80),
    CONSTRAINT visitor_chat_messages_message_type_check CHECK (((message_type)::text = ANY (ARRAY[('text'::character varying)::text, ('image'::character varying)::text, ('file'::character varying)::text, ('video'::character varying)::text, ('audio'::character varying)::text, ('system'::character varying)::text, ('interactive'::character varying)::text]))),
    CONSTRAINT visitor_chat_messages_sender_type_check CHECK (((sender_type)::text = ANY (ARRAY[('visitor'::character varying)::text, ('operator'::character varying)::text, ('bot'::character varying)::text, ('internal_note'::character varying)::text])))
);


--
-- Name: TABLE visitor_chat_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visitor_chat_messages IS 'Сообщения в чат-сессиях посетителей';


--
-- Name: visitor_chat_messages_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_chat_messages_archive (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    sender_type character varying(20) NOT NULL,
    sender_id character varying(100),
    sender_name character varying(100),
    message_type character varying(20) DEFAULT 'text'::character varying,
    content text NOT NULL,
    attachment_url character varying(500),
    attachment_name character varying(255),
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    bitrix_message_id character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    external_message_id character varying(255),
    delivered_at timestamp with time zone,
    CONSTRAINT visitor_chat_messages_message_type_check CHECK (((message_type)::text = ANY (ARRAY[('text'::character varying)::text, ('image'::character varying)::text, ('file'::character varying)::text, ('video'::character varying)::text, ('audio'::character varying)::text, ('system'::character varying)::text, ('interactive'::character varying)::text]))),
    CONSTRAINT visitor_chat_messages_sender_type_check CHECK (((sender_type)::text = ANY (ARRAY[('visitor'::character varying)::text, ('operator'::character varying)::text, ('bot'::character varying)::text, ('internal_note'::character varying)::text])))
);


--
-- Name: visitor_chat_session_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_chat_session_tags (
    session_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: visitor_chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_chat_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id character varying(64) NOT NULL,
    visitor_name character varying(100),
    visitor_phone character varying(20),
    visitor_email character varying(255),
    selected_service character varying(100),
    selected_price integer,
    page_url character varying(500),
    bitrix_dialog_id character varying(100),
    bitrix_user_id character varying(100),
    status character varying(20) DEFAULT 'open'::character varying,
    assigned_operator_id uuid,
    user_agent text,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_message_at timestamp with time zone,
    closed_at timestamp with time zone,
    channel character varying(20) DEFAULT 'online'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    user_id uuid,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    csat_score smallint,
    csat_comment text,
    csat_submitted_at timestamp with time zone,
    context jsonb DEFAULT '{}'::jsonb,
    source character varying(20) DEFAULT 'web'::character varying,
    entry_context jsonb DEFAULT '{}'::jsonb,
    session_number integer,
    message_count integer DEFAULT 0,
    unread_count integer DEFAULT 0,
    last_message_content text,
    booking_id uuid,
    contact_id uuid,
    CONSTRAINT visitor_chat_sessions_csat_score_check CHECK (((csat_score >= 1) AND (csat_score <= 5))),
    CONSTRAINT visitor_chat_sessions_status_check CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('waiting'::character varying)::text, ('active'::character varying)::text, ('resolved'::character varying)::text, ('closed'::character varying)::text])))
);


--
-- Name: TABLE visitor_chat_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visitor_chat_sessions IS 'Чат-сессии анонимных посетителей для онлайн-заказов';


--
-- Name: visitor_chat_sessions_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_chat_sessions_archive (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visitor_id character varying(64) NOT NULL,
    visitor_name character varying(100),
    visitor_phone character varying(20),
    visitor_email character varying(255),
    selected_service character varying(100),
    selected_price integer,
    page_url character varying(500),
    bitrix_dialog_id character varying(100),
    bitrix_user_id character varying(100),
    status character varying(20) DEFAULT 'open'::character varying,
    assigned_operator_id uuid,
    user_agent text,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_message_at timestamp with time zone,
    closed_at timestamp with time zone,
    channel character varying(20) DEFAULT 'online'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    user_id uuid,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    csat_score smallint,
    csat_comment text,
    csat_submitted_at timestamp with time zone,
    context jsonb DEFAULT '{}'::jsonb,
    source character varying(20) DEFAULT 'web'::character varying,
    entry_context jsonb DEFAULT '{}'::jsonb,
    session_number integer,
    message_count integer DEFAULT 0,
    unread_count integer DEFAULT 0,
    last_message_content text,
    CONSTRAINT visitor_chat_sessions_csat_score_check CHECK (((csat_score >= 1) AND (csat_score <= 5))),
    CONSTRAINT visitor_chat_sessions_status_check CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('waiting'::character varying)::text, ('active'::character varying)::text, ('resolved'::character varying)::text, ('closed'::character varying)::text])))
);


--
-- Name: visitor_push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitor_push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    visitor_id character varying(64) NOT NULL,
    endpoint text,
    keys jsonb DEFAULT '{}'::jsonb,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    platform character varying(10) DEFAULT 'web'::character varying,
    fcm_token text
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel public.channel_type NOT NULL,
    account_id uuid,
    raw_headers jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_body jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    processed_at timestamp with time zone,
    error_message text,
    retry_count integer DEFAULT 0,
    idempotency_key character varying(255),
    source_ip inet,
    received_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT webhook_events_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processed'::character varying, 'failed'::character varying, 'skipped'::character varying, 'replaying'::character varying])::text[])))
);


--
-- Name: webhook_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_idempotency (
    idempotency_key character varying(255) NOT NULL,
    webhook_type character varying(50) NOT NULL,
    order_id character varying(100),
    response_code integer,
    response_body jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: work_tasks_task_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.work_tasks_task_number_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: work_tasks_task_number_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.work_tasks_task_number_seq OWNED BY public.work_tasks.task_number;


--
-- Name: workflow_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_runs (
    id integer NOT NULL,
    workflow_id integer,
    trigger_data jsonb DEFAULT '{}'::jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    result jsonb DEFAULT '[]'::jsonb,
    error_message text,
    scheduled_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: workflow_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_runs_id_seq OWNED BY public.workflow_runs.id;


--
-- Name: workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflows (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    trigger_type character varying(50) NOT NULL,
    conditions jsonb DEFAULT '[]'::jsonb,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true,
    run_count integer DEFAULT 0,
    last_run_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE workflows; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workflows IS 'Workflow-автоматизации ФотоПульта: триггер → условия → действия';


--
-- Name: COLUMN workflows.trigger_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflows.trigger_type IS 'order_paid | chat_created | chat_closed | booking_completed | manual';


--
-- Name: COLUMN workflows.conditions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflows.conditions IS '[{field, op, value}] — AND-логика. Пример: [{field:"amount",op:"gt",value:1000}]';


--
-- Name: COLUMN workflows.actions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflows.actions IS '[{type, params, delay_seconds}]. Типы: create_task|notify_team|send_email|add_note|set_tag';


--
-- Name: workflows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflows_id_seq OWNED BY public.workflows.id;


--
-- Name: app_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_events ALTER COLUMN id SET DEFAULT nextval('public.app_events_id_seq'::regclass);


--
-- Name: app_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_logs ALTER COLUMN id SET DEFAULT nextval('public.app_logs_id_seq'::regclass);


--
-- Name: behavior_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavior_events ALTER COLUMN id SET DEFAULT nextval('public.behavior_events_id_seq'::regclass);


--
-- Name: consumable_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_transactions ALTER COLUMN id SET DEFAULT nextval('public.consumable_transactions_id_seq'::regclass);


--
-- Name: crm_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_files ALTER COLUMN id SET DEFAULT nextval('public.crm_files_id_seq'::regclass);


--
-- Name: email_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments ALTER COLUMN id SET DEFAULT nextval('public.email_attachments_id_seq'::regclass);


--
-- Name: email_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages ALTER COLUMN id SET DEFAULT nextval('public.email_messages_id_seq'::regclass);


--
-- Name: email_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates ALTER COLUMN id SET DEFAULT nextval('public.email_templates_id_seq'::regclass);


--
-- Name: infra_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infra_alerts ALTER COLUMN id SET DEFAULT nextval('public.infra_alerts_id_seq'::regclass);


--
-- Name: login_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts ALTER COLUMN id SET DEFAULT nextval('public.login_attempts_id_seq'::regclass);


--
-- Name: partner_commission_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_commission_rules ALTER COLUMN id SET DEFAULT nextval('public.partner_commission_rules_id_seq'::regclass);


--
-- Name: partner_payouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_payouts ALTER COLUMN id SET DEFAULT nextval('public.partner_payouts_id_seq'::regclass);


--
-- Name: partner_referrals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_referrals ALTER COLUMN id SET DEFAULT nextval('public.partner_referrals_id_seq'::regclass);


--
-- Name: partner_tiers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_tiers ALTER COLUMN id SET DEFAULT nextval('public.partner_tiers_id_seq'::regclass);


--
-- Name: partners id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners ALTER COLUMN id SET DEFAULT nextval('public.partners_id_seq'::regclass);


--
-- Name: pos_cash_counts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_cash_counts ALTER COLUMN id SET DEFAULT nextval('public.pos_cash_counts_id_seq'::regclass);


--
-- Name: pos_shifts shift_number; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_shifts ALTER COLUMN shift_number SET DEFAULT nextval('public.pos_shifts_shift_number_seq'::regclass);


--
-- Name: printer_telemetry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_telemetry ALTER COLUMN id SET DEFAULT nextval('public.printer_telemetry_id_seq'::regclass);


--
-- Name: replay_chunks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.replay_chunks ALTER COLUMN id SET DEFAULT nextval('public.replay_chunks_id_seq'::regclass);


--
-- Name: review_platform_stats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_platform_stats ALTER COLUMN id SET DEFAULT nextval('public.review_platform_stats_id_seq'::regclass);


--
-- Name: system_telemetry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_telemetry ALTER COLUMN id SET DEFAULT nextval('public.system_telemetry_id_seq'::regclass);


--
-- Name: telegram_auth_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_auth_tokens ALTER COLUMN id SET DEFAULT nextval('public.telegram_auth_tokens_id_seq'::regclass);


--
-- Name: work_tasks task_number; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks ALTER COLUMN task_number SET DEFAULT nextval('public.work_tasks_task_number_seq'::regclass);


--
-- Name: workflow_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs ALTER COLUMN id SET DEFAULT nextval('public.workflow_runs_id_seq'::regclass);


--
-- Name: workflows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows ALTER COLUMN id SET DEFAULT nextval('public.workflows_id_seq'::regclass);


--
-- Name: agent_releases agent_releases_agent_type_version_platform_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_releases
    ADD CONSTRAINT agent_releases_agent_type_version_platform_key UNIQUE (agent_type, version, platform);


--
-- Name: agent_releases agent_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_releases
    ADD CONSTRAINT agent_releases_pkey PRIMARY KEY (id);


--
-- Name: agent_update_commands agent_update_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_update_commands
    ADD CONSTRAINT agent_update_commands_pkey PRIMARY KEY (id);


--
-- Name: agents agents_mqtt_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_mqtt_username_key UNIQUE (mqtt_username);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: agents agents_studio_id_agent_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_studio_id_agent_type_key UNIQUE (studio_id, agent_type);


--
-- Name: ai_retouch_jobs ai_retouch_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_retouch_jobs
    ADD CONSTRAINT ai_retouch_jobs_pkey PRIMARY KEY (id);


--
-- Name: alert_rules alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);


--
-- Name: app_events app_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_pkey PRIMARY KEY (id);


--
-- Name: app_logs app_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_logs
    ADD CONSTRAINT app_logs_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: behavior_events behavior_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavior_events
    ADD CONSTRAINT behavior_events_pkey PRIMARY KEY (id);


--
-- Name: booking_status_history booking_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (studio_id WITH =, tstzrange(start_time, end_time) WITH &&) WHERE (((status)::text <> ALL ((ARRAY['cancelled'::character varying, 'no-show'::character varying])::text[])));


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: bot_message_templates bot_message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_message_templates
    ADD CONSTRAINT bot_message_templates_pkey PRIMARY KEY (event_type);


--
-- Name: bridge_devices bridge_devices_api_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bridge_devices
    ADD CONSTRAINT bridge_devices_api_key_key UNIQUE (api_key);


--
-- Name: bridge_devices bridge_devices_mqtt_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bridge_devices
    ADD CONSTRAINT bridge_devices_mqtt_username_key UNIQUE (mqtt_username);


--
-- Name: bridge_devices bridge_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bridge_devices
    ADD CONSTRAINT bridge_devices_pkey PRIMARY KEY (id);


--
-- Name: broadcast_log broadcast_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_log
    ADD CONSTRAINT broadcast_log_pkey PRIMARY KEY (id);


--
-- Name: call_entity_links call_entity_links_call_log_id_entity_type_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_entity_links
    ADD CONSTRAINT call_entity_links_call_log_id_entity_type_entity_id_key UNIQUE (call_log_id, entity_type, entity_id);


--
-- Name: call_entity_links call_entity_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_entity_links
    ADD CONSTRAINT call_entity_links_pkey PRIMARY KEY (id);


--
-- Name: call_logs call_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_pkey PRIMARY KEY (id);


--
-- Name: call_logs call_logs_voximplant_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_voximplant_session_id_key UNIQUE (voximplant_session_id);


--
-- Name: cameras cameras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_pkey PRIMARY KEY (id);


--
-- Name: campaign_promo_codes campaign_promo_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_promo_codes
    ADD CONSTRAINT campaign_promo_codes_pkey PRIMARY KEY (id);


--
-- Name: cdr_stats cdr_stats_agent_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_stats
    ADD CONSTRAINT cdr_stats_agent_id_date_key UNIQUE (agent_id, date);


--
-- Name: cdr_stats cdr_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_stats
    ADD CONSTRAINT cdr_stats_pkey PRIMARY KEY (id);


--
-- Name: channel_accounts channel_accounts_channel_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_accounts
    ADD CONSTRAINT channel_accounts_channel_name_key UNIQUE (channel, name);


--
-- Name: channel_accounts channel_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_accounts
    ADD CONSTRAINT channel_accounts_pkey PRIMARY KEY (id);


--
-- Name: channel_users channel_users_channel_external_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_users
    ADD CONSTRAINT channel_users_channel_external_user_id_key UNIQUE (channel, external_user_id);


--
-- Name: channel_users channel_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_users
    ADD CONSTRAINT channel_users_pkey PRIMARY KEY (id);


--
-- Name: chat_followups chat_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_followups
    ADD CONSTRAINT chat_followups_pkey PRIMARY KEY (id);


--
-- Name: chat_quick_replies chat_quick_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_quick_replies
    ADD CONSTRAINT chat_quick_replies_pkey PRIMARY KEY (id);


--
-- Name: chat_tags chat_tags_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_tags
    ADD CONSTRAINT chat_tags_name_key UNIQUE (name);


--
-- Name: chat_tags chat_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_tags
    ADD CONSTRAINT chat_tags_pkey PRIMARY KEY (id);


--
-- Name: chat_task_links chat_task_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_task_links
    ADD CONSTRAINT chat_task_links_pkey PRIMARY KEY (id);


--
-- Name: client_notes client_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_pkey PRIMARY KEY (id);


--
-- Name: combo_package_items combo_package_items_combo_package_id_service_option_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_package_items
    ADD CONSTRAINT combo_package_items_combo_package_id_service_option_id_key UNIQUE (combo_package_id, service_option_id);


--
-- Name: combo_package_items combo_package_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_package_items
    ADD CONSTRAINT combo_package_items_pkey PRIMARY KEY (id);


--
-- Name: combo_packages combo_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_packages
    ADD CONSTRAINT combo_packages_pkey PRIMARY KEY (id);


--
-- Name: combo_packages combo_packages_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_packages
    ADD CONSTRAINT combo_packages_slug_key UNIQUE (slug);


--
-- Name: consumable_rules consumable_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_rules
    ADD CONSTRAINT consumable_rules_pkey PRIMARY KEY (id);


--
-- Name: consumable_rules consumable_rules_service_option_id_product_stock_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_rules
    ADD CONSTRAINT consumable_rules_service_option_id_product_stock_id_key UNIQUE (service_option_id, product_stock_id);


--
-- Name: consumable_stock consumable_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_stock
    ADD CONSTRAINT consumable_stock_pkey PRIMARY KEY (id);


--
-- Name: consumable_stock consumable_stock_station_id_consumable_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_stock
    ADD CONSTRAINT consumable_stock_station_id_consumable_type_key UNIQUE (station_id, consumable_type);


--
-- Name: consumable_transactions consumable_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_transactions
    ADD CONSTRAINT consumable_transactions_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: conversation_tags conversation_tags_conversation_id_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_tags
    ADD CONSTRAINT conversation_tags_conversation_id_tag_key UNIQUE (conversation_id, tag);


--
-- Name: conversation_tags conversation_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_tags
    ADD CONSTRAINT conversation_tags_pkey PRIMARY KEY (id);


--
-- Name: conversations_archive conversations_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations_archive
    ADD CONSTRAINT conversations_archive_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_legacy_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_legacy_session_id_key UNIQUE (legacy_session_id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: conversion_tasks conversion_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversion_tasks
    ADD CONSTRAINT conversion_tasks_pkey PRIMARY KEY (id);


--
-- Name: crm_files crm_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_files
    ADD CONSTRAINT crm_files_pkey PRIMARY KEY (id);


--
-- Name: crm_files crm_files_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_files
    ADD CONSTRAINT crm_files_uuid_key UNIQUE (uuid);


--
-- Name: crm_inbox crm_inbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_inbox
    ADD CONSTRAINT crm_inbox_pkey PRIMARY KEY (type, id);


--
-- Name: crm_notes crm_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_pkey PRIMARY KEY (id);


--
-- Name: customer_feedback customer_feedback_entity_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_feedback
    ADD CONSTRAINT customer_feedback_entity_unique UNIQUE (entity_type, entity_id);


--
-- Name: customer_feedback customer_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_feedback
    ADD CONSTRAINT customer_feedback_pkey PRIMARY KEY (id);


--
-- Name: customer_tag_assignments customer_tag_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tag_assignments
    ADD CONSTRAINT customer_tag_assignments_pkey PRIMARY KEY (customer_id, tag_id);


--
-- Name: customer_tags customer_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tags
    ADD CONSTRAINT customer_tags_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: design_templates design_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.design_templates
    ADD CONSTRAINT design_templates_pkey PRIMARY KEY (id);


--
-- Name: document_templates document_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_templates
    ADD CONSTRAINT document_templates_pkey PRIMARY KEY (id);


--
-- Name: document_templates document_templates_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_templates
    ADD CONSTRAINT document_templates_slug_key UNIQUE (slug);


--
-- Name: document_templates document_templates_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_templates
    ADD CONSTRAINT document_templates_slug_unique UNIQUE (slug);


--
-- Name: dynamic_pricing_config dynamic_pricing_config_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_pricing_config
    ADD CONSTRAINT dynamic_pricing_config_config_key_key UNIQUE (config_key);


--
-- Name: dynamic_pricing_config dynamic_pricing_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_pricing_config
    ADD CONSTRAINT dynamic_pricing_config_pkey PRIMARY KEY (id);


--
-- Name: email_attachments email_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_pkey PRIMARY KEY (id);


--
-- Name: email_messages email_messages_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_message_id_key UNIQUE (message_id);


--
-- Name: email_messages email_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_slug_key UNIQUE (slug);


--
-- Name: employee_achievements employee_achievements_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_achievements
    ADD CONSTRAINT employee_achievements_code_key UNIQUE (code);


--
-- Name: employee_achievements employee_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_achievements
    ADD CONSTRAINT employee_achievements_pkey PRIMARY KEY (id);


--
-- Name: employee_commission_payouts employee_commission_payouts_employee_id_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_payouts
    ADD CONSTRAINT employee_commission_payouts_employee_id_period_key UNIQUE (employee_id, period);


--
-- Name: employee_commission_payouts employee_commission_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_payouts
    ADD CONSTRAINT employee_commission_payouts_pkey PRIMARY KEY (id);


--
-- Name: employee_commission_rules employee_commission_rules_employee_id_role_category_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_rules
    ADD CONSTRAINT employee_commission_rules_employee_id_role_category_slug_key UNIQUE (employee_id, role, category_slug);


--
-- Name: employee_commission_rules employee_commission_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_rules
    ADD CONSTRAINT employee_commission_rules_pkey PRIMARY KEY (id);


--
-- Name: employee_compensation employee_compensation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_compensation
    ADD CONSTRAINT employee_compensation_pkey PRIMARY KEY (id);


--
-- Name: employee_daily_quests employee_daily_quests_employee_id_quest_date_quest_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_daily_quests
    ADD CONSTRAINT employee_daily_quests_employee_id_quest_date_quest_type_key UNIQUE (employee_id, quest_date, quest_type);


--
-- Name: employee_daily_quests employee_daily_quests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_daily_quests
    ADD CONSTRAINT employee_daily_quests_pkey PRIMARY KEY (id);


--
-- Name: employee_favorites employee_favorites_employee_id_service_option_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_favorites
    ADD CONSTRAINT employee_favorites_employee_id_service_option_id_key UNIQUE (employee_id, service_option_id);


--
-- Name: employee_favorites employee_favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_favorites
    ADD CONSTRAINT employee_favorites_pkey PRIMARY KEY (id);


--
-- Name: employee_manual_revenue employee_manual_revenue_employee_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_manual_revenue
    ADD CONSTRAINT employee_manual_revenue_employee_id_month_key UNIQUE (employee_id, month);


--
-- Name: employee_manual_revenue employee_manual_revenue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_manual_revenue
    ADD CONSTRAINT employee_manual_revenue_pkey PRIMARY KEY (id);


--
-- Name: employee_push_subscriptions employee_push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_push_subscriptions
    ADD CONSTRAINT employee_push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: employee_push_subscriptions employee_push_subscriptions_user_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_push_subscriptions
    ADD CONSTRAINT employee_push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);


--
-- Name: employee_sales employee_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales
    ADD CONSTRAINT employee_sales_pkey PRIMARY KEY (id);


--
-- Name: employee_sales employee_sales_receipt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales
    ADD CONSTRAINT employee_sales_receipt_id_key UNIQUE (receipt_id);


--
-- Name: employee_shifts employee_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_pkey PRIMARY KEY (id);


--
-- Name: employee_tax_deductions employee_tax_deductions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_tax_deductions
    ADD CONSTRAINT employee_tax_deductions_pkey PRIMARY KEY (id);


--
-- Name: employee_unlocked_achievements employee_unlocked_achievements_employee_id_achievement_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_unlocked_achievements
    ADD CONSTRAINT employee_unlocked_achievements_employee_id_achievement_id_key UNIQUE (employee_id, achievement_id);


--
-- Name: employee_unlocked_achievements employee_unlocked_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_unlocked_achievements
    ADD CONSTRAINT employee_unlocked_achievements_pkey PRIMARY KEY (id);


--
-- Name: employee_upsell_bonuses employee_upsell_bonuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_upsell_bonuses
    ADD CONSTRAINT employee_upsell_bonuses_pkey PRIMARY KEY (id);


--
-- Name: employee_upsell_offers employee_upsell_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_upsell_offers
    ADD CONSTRAINT employee_upsell_offers_pkey PRIMARY KEY (id);


--
-- Name: employee_xp_log employee_xp_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_xp_log
    ADD CONSTRAINT employee_xp_log_pkey PRIMARY KEY (id);


--
-- Name: face_validations face_validations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_validations
    ADD CONSTRAINT face_validations_pkey PRIMARY KEY (id);


--
-- Name: feature_flags feature_flags_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_key_key UNIQUE (key);


--
-- Name: feature_flags feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: gallery_photos gallery_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_photos
    ADD CONSTRAINT gallery_photos_pkey PRIMARY KEY (id);


--
-- Name: gallery_photos gallery_photos_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_photos
    ADD CONSTRAINT gallery_photos_slug_key UNIQUE (slug);


--
-- Name: icc_profiles icc_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.icc_profiles
    ADD CONSTRAINT icc_profiles_pkey PRIMARY KEY (id);


--
-- Name: infra_alerts infra_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infra_alerts
    ADD CONSTRAINT infra_alerts_pkey PRIMARY KEY (id);


--
-- Name: inventory_audit_items inventory_audit_items_audit_id_product_stock_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_audit_items
    ADD CONSTRAINT inventory_audit_items_audit_id_product_stock_id_key UNIQUE (audit_id, product_stock_id);


--
-- Name: inventory_audit_items inventory_audit_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_audit_items
    ADD CONSTRAINT inventory_audit_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_audits inventory_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_audits
    ADD CONSTRAINT inventory_audits_pkey PRIMARY KEY (id);


--
-- Name: inventory_receipts inventory_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_receipts
    ADD CONSTRAINT inventory_receipts_pkey PRIMARY KEY (id);


--
-- Name: inventory_transactions inventory_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id);


--
-- Name: kb_access_rules kb_access_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_access_rules
    ADD CONSTRAINT kb_access_rules_pkey PRIMARY KEY (id);


--
-- Name: kb_access_rules kb_access_rules_role_category_slug_entity_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_access_rules
    ADD CONSTRAINT kb_access_rules_role_category_slug_entity_type_key UNIQUE (role, category_slug, entity_type);


--
-- Name: kb_categories kb_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_categories
    ADD CONSTRAINT kb_categories_pkey PRIMARY KEY (id);


--
-- Name: kb_categories kb_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_categories
    ADD CONSTRAINT kb_categories_slug_key UNIQUE (slug);


--
-- Name: kb_competitor_prices kb_competitor_prices_competitor_id_service_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_competitor_prices
    ADD CONSTRAINT kb_competitor_prices_competitor_id_service_name_key UNIQUE (competitor_id, service_name);


--
-- Name: kb_competitor_prices kb_competitor_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_competitor_prices
    ADD CONSTRAINT kb_competitor_prices_pkey PRIMARY KEY (id);


--
-- Name: kb_config kb_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_config
    ADD CONSTRAINT kb_config_pkey PRIMARY KEY (key);


--
-- Name: kb_crawled_pages kb_crawled_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_crawled_pages
    ADD CONSTRAINT kb_crawled_pages_pkey PRIMARY KEY (id);


--
-- Name: kb_crawled_pages kb_crawled_pages_source_slug_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_crawled_pages
    ADD CONSTRAINT kb_crawled_pages_source_slug_url_key UNIQUE (source_slug, url);


--
-- Name: kb_data_sources kb_data_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_data_sources
    ADD CONSTRAINT kb_data_sources_pkey PRIMARY KEY (id);


--
-- Name: kb_data_sources kb_data_sources_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_data_sources
    ADD CONSTRAINT kb_data_sources_slug_key UNIQUE (slug);


--
-- Name: kb_enrichment_tasks kb_enrichment_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_enrichment_tasks
    ADD CONSTRAINT kb_enrichment_tasks_pkey PRIMARY KEY (id);


--
-- Name: kb_entities kb_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entities
    ADD CONSTRAINT kb_entities_pkey PRIMARY KEY (id);


--
-- Name: kb_entities kb_entities_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entities
    ADD CONSTRAINT kb_entities_slug_key UNIQUE (slug);


--
-- Name: kb_entity_versions kb_entity_versions_entity_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entity_versions
    ADD CONSTRAINT kb_entity_versions_entity_id_version_key UNIQUE (entity_id, version);


--
-- Name: kb_entity_versions kb_entity_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entity_versions
    ADD CONSTRAINT kb_entity_versions_pkey PRIMARY KEY (id);


--
-- Name: kb_metric_definitions kb_metric_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_metric_definitions
    ADD CONSTRAINT kb_metric_definitions_pkey PRIMARY KEY (id);


--
-- Name: kb_metric_definitions kb_metric_definitions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_metric_definitions
    ADD CONSTRAINT kb_metric_definitions_slug_key UNIQUE (slug);


--
-- Name: kb_metrics kb_metrics_definition_id_dimensions_period_type_period_star_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_metrics
    ADD CONSTRAINT kb_metrics_definition_id_dimensions_period_type_period_star_key UNIQUE (definition_id, dimensions, period_type, period_start);


--
-- Name: kb_metrics kb_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_metrics
    ADD CONSTRAINT kb_metrics_pkey PRIMARY KEY (id);


--
-- Name: kb_price_alerts kb_price_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_price_alerts
    ADD CONSTRAINT kb_price_alerts_pkey PRIMARY KEY (id);


--
-- Name: kb_price_history kb_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_price_history
    ADD CONSTRAINT kb_price_history_pkey PRIMARY KEY (id);


--
-- Name: kb_relations kb_relations_from_entity_id_to_entity_id_relation_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_relations
    ADD CONSTRAINT kb_relations_from_entity_id_to_entity_id_relation_type_key UNIQUE (from_entity_id, to_entity_id, relation_type);


--
-- Name: kb_relations kb_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_relations
    ADD CONSTRAINT kb_relations_pkey PRIMARY KEY (id);


--
-- Name: kb_scrape_logs kb_scrape_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_scrape_logs
    ADD CONSTRAINT kb_scrape_logs_pkey PRIMARY KEY (id);


--
-- Name: kb_source_links kb_source_links_entity_id_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_source_links
    ADD CONSTRAINT kb_source_links_entity_id_source_id_key UNIQUE (entity_id, source_id);


--
-- Name: kb_source_links kb_source_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_source_links
    ADD CONSTRAINT kb_source_links_pkey PRIMARY KEY (id);


--
-- Name: kpi_alerts kpi_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_alerts
    ADD CONSTRAINT kpi_alerts_pkey PRIMARY KEY (id);


--
-- Name: kpi_composite_scores kpi_composite_scores_employee_id_period_type_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_composite_scores
    ADD CONSTRAINT kpi_composite_scores_employee_id_period_type_period_start_key UNIQUE (employee_id, period_type, period_start);


--
-- Name: kpi_composite_scores kpi_composite_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_composite_scores
    ADD CONSTRAINT kpi_composite_scores_pkey PRIMARY KEY (id);


--
-- Name: kpi_metric_definitions kpi_metric_definitions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_metric_definitions
    ADD CONSTRAINT kpi_metric_definitions_code_key UNIQUE (code);


--
-- Name: kpi_metric_definitions kpi_metric_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_metric_definitions
    ADD CONSTRAINT kpi_metric_definitions_pkey PRIMARY KEY (id);


--
-- Name: kpi_snapshots kpi_snapshots_employee_id_metric_code_period_type_period_st_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_snapshots
    ADD CONSTRAINT kpi_snapshots_employee_id_metric_code_period_type_period_st_key UNIQUE (employee_id, metric_code, period_type, period_start);


--
-- Name: kpi_snapshots kpi_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_snapshots
    ADD CONSTRAINT kpi_snapshots_pkey PRIMARY KEY (id);


--
-- Name: kpi_targets kpi_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_targets
    ADD CONSTRAINT kpi_targets_pkey PRIMARY KEY (id);


--
-- Name: kpi_weight_profiles kpi_weight_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_weight_profiles
    ADD CONSTRAINT kpi_weight_profiles_pkey PRIMARY KEY (id);


--
-- Name: kpi_weight_profiles kpi_weight_profiles_scope_scope_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_weight_profiles
    ADD CONSTRAINT kpi_weight_profiles_scope_scope_value_key UNIQUE (scope, scope_value);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (id);


--
-- Name: loyalty_profiles loyalty_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_profiles
    ADD CONSTRAINT loyalty_profiles_pkey PRIMARY KEY (id);


--
-- Name: loyalty_profiles loyalty_profiles_referral_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_profiles
    ADD CONSTRAINT loyalty_profiles_referral_code_key UNIQUE (referral_code);


--
-- Name: loyalty_profiles loyalty_profiles_telegram_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_profiles
    ADD CONSTRAINT loyalty_profiles_telegram_user_id_key UNIQUE (telegram_user_id);


--
-- Name: marketing_campaigns marketing_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_campaigns
    ADD CONSTRAINT marketing_campaigns_pkey PRIMARY KEY (id);


--
-- Name: material_usage material_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_usage
    ADD CONSTRAINT material_usage_pkey PRIMARY KEY (id);


--
-- Name: media_attachments media_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_attachments
    ADD CONSTRAINT media_attachments_pkey PRIMARY KEY (id);


--
-- Name: message_statuses message_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_statuses
    ADD CONSTRAINT message_statuses_pkey PRIMARY KEY (id);


--
-- Name: messages_archive messages_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages_archive
    ADD CONSTRAINT messages_archive_pkey PRIMARY KEY (id);


--
-- Name: messages messages_legacy_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_legacy_message_id_key UNIQUE (legacy_message_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: mobile_push_tokens mobile_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_tokens
    ADD CONSTRAINT mobile_push_tokens_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: option_groups option_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_groups
    ADD CONSTRAINT option_groups_pkey PRIMARY KEY (id);


--
-- Name: option_groups option_groups_service_category_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_groups
    ADD CONSTRAINT option_groups_service_category_id_slug_key UNIQUE (service_category_id, slug);


--
-- Name: option_rules option_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_rules
    ADD CONSTRAINT option_rules_pkey PRIMARY KEY (id);


--
-- Name: option_rules option_rules_source_option_id_target_option_id_rule_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_rules
    ADD CONSTRAINT option_rules_source_option_id_target_option_id_rule_type_key UNIQUE (source_option_id, target_option_id, rule_type);


--
-- Name: order_assignments order_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_assignments
    ADD CONSTRAINT order_assignments_pkey PRIMARY KEY (id);


--
-- Name: order_attachments order_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_attachments
    ADD CONSTRAINT order_attachments_pkey PRIMARY KEY (id);


--
-- Name: order_comments order_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_comments
    ADD CONSTRAINT order_comments_pkey PRIMARY KEY (id);


--
-- Name: order_delay_compensations order_delay_compensations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_delay_compensations
    ADD CONSTRAINT order_delay_compensations_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);


--
-- Name: order_templates order_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_templates
    ADD CONSTRAINT order_templates_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: outbound_delivery_log_archived outbound_delivery_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_delivery_log_archived
    ADD CONSTRAINT outbound_delivery_log_pkey PRIMARY KEY (id);


--
-- Name: outbound_delivery_log outbound_delivery_log_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_delivery_log
    ADD CONSTRAINT outbound_delivery_log_pkey1 PRIMARY KEY (id);


--
-- Name: outbound_queue outbound_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_queue
    ADD CONSTRAINT outbound_queue_pkey PRIMARY KEY (id);


--
-- Name: partner_commission_rules partner_commission_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_commission_rules
    ADD CONSTRAINT partner_commission_rules_pkey PRIMARY KEY (id);


--
-- Name: partner_payouts partner_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_payouts
    ADD CONSTRAINT partner_payouts_pkey PRIMARY KEY (id);


--
-- Name: partner_referrals partner_referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_referrals
    ADD CONSTRAINT partner_referrals_pkey PRIMARY KEY (id);


--
-- Name: partner_tiers partner_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_tiers
    ADD CONSTRAINT partner_tiers_pkey PRIMARY KEY (id);


--
-- Name: partner_tiers partner_tiers_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_tiers
    ADD CONSTRAINT partner_tiers_slug_key UNIQUE (slug);


--
-- Name: partners partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_pkey PRIMARY KEY (id);


--
-- Name: partners partners_promo_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_promo_code_key UNIQUE (promo_code);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);


--
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);


--
-- Name: payment_installments payment_installments_order_id_installment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_installments
    ADD CONSTRAINT payment_installments_order_id_installment_number_key UNIQUE (order_id, installment_number);


--
-- Name: payment_installments payment_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_installments
    ADD CONSTRAINT payment_installments_pkey PRIMARY KEY (id);


--
-- Name: pending_oauth_links pending_oauth_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_oauth_links
    ADD CONSTRAINT pending_oauth_links_pkey PRIMARY KEY (id);


--
-- Name: pending_oauth_links pending_oauth_links_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_oauth_links
    ADD CONSTRAINT pending_oauth_links_token_key UNIQUE (token);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: photo_approval_annotations photo_approval_annotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_annotations
    ADD CONSTRAINT photo_approval_annotations_pkey PRIMARY KEY (id);


--
-- Name: photo_approval_revisions photo_approval_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_revisions
    ADD CONSTRAINT photo_approval_revisions_pkey PRIMARY KEY (id);


--
-- Name: photo_approval_sessions photo_approval_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_sessions
    ADD CONSTRAINT photo_approval_sessions_pkey PRIMARY KEY (id);


--
-- Name: photo_approval_sessions photo_approval_sessions_public_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_sessions
    ADD CONSTRAINT photo_approval_sessions_public_token_key UNIQUE (public_token);


--
-- Name: photo_approval_variants photo_approval_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_variants
    ADD CONSTRAINT photo_approval_variants_pkey PRIMARY KEY (id);


--
-- Name: photo_approvals photo_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approvals
    ADD CONSTRAINT photo_approvals_pkey PRIMARY KEY (id);


--
-- Name: photo_print_orders photo_print_orders_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_print_orders
    ADD CONSTRAINT photo_print_orders_order_id_key UNIQUE (order_id);


--
-- Name: photo_print_orders photo_print_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_print_orders
    ADD CONSTRAINT photo_print_orders_pkey PRIMARY KEY (id);


--
-- Name: photo_selections photo_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_selections
    ADD CONSTRAINT photo_selections_pkey PRIMARY KEY (id);


--
-- Name: photo_sessions photo_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_sessions
    ADD CONSTRAINT photo_sessions_pkey PRIMARY KEY (id);


--
-- Name: photographer_services photographer_services_photographer_id_service_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photographer_services
    ADD CONSTRAINT photographer_services_photographer_id_service_id_key UNIQUE (photographer_id, service_id);


--
-- Name: photographer_services photographer_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photographer_services
    ADD CONSTRAINT photographer_services_pkey PRIMARY KEY (id);


--
-- Name: photographers photographers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photographers
    ADD CONSTRAINT photographers_pkey PRIMARY KEY (id);


--
-- Name: photographers photographers_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photographers
    ADD CONSTRAINT photographers_user_id_key UNIQUE (user_id);


--
-- Name: photos photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_pkey PRIMARY KEY (id);


--
-- Name: points_transactions points_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_pkey PRIMARY KEY (id);


--
-- Name: pos_cash_counts pos_cash_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_cash_counts
    ADD CONSTRAINT pos_cash_counts_pkey PRIMARY KEY (id);


--
-- Name: pos_receipt_items pos_receipt_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipt_items
    ADD CONSTRAINT pos_receipt_items_pkey PRIMARY KEY (id);


--
-- Name: pos_receipt_payments pos_receipt_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipt_payments
    ADD CONSTRAINT pos_receipt_payments_pkey PRIMARY KEY (id);


--
-- Name: pos_receipts pos_receipts_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT pos_receipts_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: pos_receipts pos_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT pos_receipts_pkey PRIMARY KEY (id);


--
-- Name: pos_shifts pos_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_pkey PRIMARY KEY (id);


--
-- Name: pos_transactions pos_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_transactions
    ADD CONSTRAINT pos_transactions_pkey PRIMARY KEY (id);


--
-- Name: pos_fiscal_settings pos_fiscal_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_fiscal_settings
    ADD CONSTRAINT pos_fiscal_settings_pkey PRIMARY KEY (studio_id);


--
-- Name: price_locks price_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_locks
    ADD CONSTRAINT price_locks_pkey PRIMARY KEY (id);


--
-- Name: price_modifiers price_modifiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_modifiers
    ADD CONSTRAINT price_modifiers_pkey PRIMARY KEY (id);


--
-- Name: pricing_ai_suggestions pricing_ai_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_ai_suggestions
    ADD CONSTRAINT pricing_ai_suggestions_pkey PRIMARY KEY (id);


--
-- Name: pricing_snapshots pricing_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_snapshots
    ADD CONSTRAINT pricing_snapshots_pkey PRIMARY KEY (id);


--
-- Name: print_jobs print_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_pkey PRIMARY KEY (id);


--
-- Name: print_presets print_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_presets
    ADD CONSTRAINT print_presets_pkey PRIMARY KEY (id);


--
-- Name: print_presets print_presets_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_presets
    ADD CONSTRAINT print_presets_slug_key UNIQUE (slug);


--
-- Name: print_speed_log print_speed_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_speed_log
    ADD CONSTRAINT print_speed_log_pkey PRIMARY KEY (id);


--
-- Name: print_waste_log print_waste_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_waste_log
    ADD CONSTRAINT print_waste_log_pkey PRIMARY KEY (id);


--
-- Name: printer_telemetry printer_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_telemetry
    ADD CONSTRAINT printer_telemetry_pkey PRIMARY KEY (id);


--
-- Name: printers printers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printers
    ADD CONSTRAINT printers_pkey PRIMARY KEY (id);


--
-- Name: printing_house_products printing_house_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printing_house_products
    ADD CONSTRAINT printing_house_products_pkey PRIMARY KEY (id);


--
-- Name: printing_houses printing_houses_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printing_houses
    ADD CONSTRAINT printing_houses_code_key UNIQUE (code);


--
-- Name: printing_houses printing_houses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printing_houses
    ADD CONSTRAINT printing_houses_pkey PRIMARY KEY (id);


--
-- Name: priority_purchases priority_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.priority_purchases
    ADD CONSTRAINT priority_purchases_pkey PRIMARY KEY (id);


--
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);


--
-- Name: product_reference_data product_reference_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reference_data
    ADD CONSTRAINT product_reference_data_pkey PRIMARY KEY (id);


--
-- Name: product_reference_data product_reference_data_ref_type_ref_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reference_data
    ADD CONSTRAINT product_reference_data_ref_type_ref_key_key UNIQUE (ref_type, ref_key);


--
-- Name: product_stock product_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock
    ADD CONSTRAINT product_stock_pkey PRIMARY KEY (id);


--
-- Name: production_order_events production_order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_order_events
    ADD CONSTRAINT production_order_events_pkey PRIMARY KEY (id);


--
-- Name: production_orders production_orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_order_number_key UNIQUE (order_number);


--
-- Name: production_orders production_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: promo_redemptions promo_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_redemptions
    ADD CONSTRAINT promo_redemptions_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_slug_key UNIQUE (slug);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: rbac_audit_log rbac_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_log
    ADD CONSTRAINT rbac_audit_log_pkey PRIMARY KEY (id);


--
-- Name: rbac_permissions rbac_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permissions
    ADD CONSTRAINT rbac_permissions_pkey PRIMARY KEY (id);


--
-- Name: rbac_permissions rbac_permissions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_permissions
    ADD CONSTRAINT rbac_permissions_slug_key UNIQUE (slug);


--
-- Name: rbac_role_permissions rbac_role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: rbac_roles rbac_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_roles
    ADD CONSTRAINT rbac_roles_pkey PRIMARY KEY (id);


--
-- Name: rbac_roles rbac_roles_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_roles
    ADD CONSTRAINT rbac_roles_slug_key UNIQUE (slug);


--
-- Name: rbac_user_overrides rbac_user_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_overrides
    ADD CONSTRAINT rbac_user_overrides_pkey PRIMARY KEY (id);


--
-- Name: rbac_user_overrides rbac_user_overrides_user_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_overrides
    ADD CONSTRAINT rbac_user_overrides_user_id_permission_id_key UNIQUE (user_id, permission_id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_key UNIQUE (token);


--
-- Name: refund_requests refund_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_pkey PRIMARY KEY (id);


--
-- Name: replay_chunks replay_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.replay_chunks
    ADD CONSTRAINT replay_chunks_pkey PRIMARY KEY (id);


--
-- Name: replay_chunks replay_chunks_session_id_chunk_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.replay_chunks
    ADD CONSTRAINT replay_chunks_session_id_chunk_index_key UNIQUE (session_id, chunk_index);


--
-- Name: replay_sessions replay_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.replay_sessions
    ADD CONSTRAINT replay_sessions_pkey PRIMARY KEY (id);


--
-- Name: review_platform_stats review_platform_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_platform_stats
    ADD CONSTRAINT review_platform_stats_pkey PRIMARY KEY (id);


--
-- Name: review_platform_stats review_platform_stats_platform_location_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_platform_stats
    ADD CONSTRAINT review_platform_stats_platform_location_slug_key UNIQUE (platform, location_slug);


--
-- Name: review_requests review_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_pkey PRIMARY KEY (id);


--
-- Name: review_requests review_requests_review_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_review_token_key UNIQUE (review_token);


--
-- Name: reviews reviews_photographer_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_photographer_id_user_id_key UNIQUE (photographer_id, user_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: rollout_plans rollout_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollout_plans
    ADD CONSTRAINT rollout_plans_pkey PRIMARY KEY (id);


--
-- Name: saved_payment_methods saved_payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_payment_methods
    ADD CONSTRAINT saved_payment_methods_pkey PRIMARY KEY (id);


--
-- Name: saved_payment_methods saved_payment_methods_user_id_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_payment_methods
    ADD CONSTRAINT saved_payment_methods_user_id_token_key UNIQUE (user_id, token);


--
-- Name: schedule_preferences schedule_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_preferences
    ADD CONSTRAINT schedule_preferences_pkey PRIMARY KEY (id);


--
-- Name: schedule_requests schedule_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_requests
    ADD CONSTRAINT schedule_requests_pkey PRIMARY KEY (id);


--
-- Name: scheduled_messages scheduled_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_messages
    ADD CONSTRAINT scheduled_messages_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: service_catalog service_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_catalog
    ADD CONSTRAINT service_catalog_pkey PRIMARY KEY (id);


--
-- Name: service_catalog service_catalog_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_catalog
    ADD CONSTRAINT service_catalog_slug_key UNIQUE (slug);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_slug_key UNIQUE (slug);


--
-- Name: service_options service_options_option_group_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_options
    ADD CONSTRAINT service_options_option_group_id_slug_key UNIQUE (option_group_id, slug);


--
-- Name: service_options service_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_options
    ADD CONSTRAINT service_options_pkey PRIMARY KEY (id);


--
-- Name: service_work_logs service_work_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_work_logs
    ADD CONSTRAINT service_work_logs_pkey PRIMARY KEY (id);


--
-- Name: shift_briefings shift_briefings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_briefings
    ADD CONSTRAINT shift_briefings_pkey PRIMARY KEY (id);


--
-- Name: shift_briefings shift_briefings_shift_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_briefings
    ADD CONSTRAINT shift_briefings_shift_id_key UNIQUE (shift_id);


--
-- Name: shooting_locations shooting_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shooting_locations
    ADD CONSTRAINT shooting_locations_pkey PRIMARY KEY (id);


--
-- Name: staff_conversation_participants staff_conversation_participants_conversation_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_conversation_participants
    ADD CONSTRAINT staff_conversation_participants_conversation_id_user_id_key UNIQUE (conversation_id, user_id);


--
-- Name: staff_conversation_participants staff_conversation_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_conversation_participants
    ADD CONSTRAINT staff_conversation_participants_pkey PRIMARY KEY (id);


--
-- Name: staff_conversations staff_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_conversations
    ADD CONSTRAINT staff_conversations_pkey PRIMARY KEY (id);


--
-- Name: staff_mentions staff_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_mentions
    ADD CONSTRAINT staff_mentions_pkey PRIMARY KEY (message_id, user_id);


--
-- Name: staff_message_reactions staff_message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_message_reactions
    ADD CONSTRAINT staff_message_reactions_pkey PRIMARY KEY (message_id, user_id, emoji);


--
-- Name: staff_messages staff_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_messages
    ADD CONSTRAINT staff_messages_pkey PRIMARY KEY (id);


--
-- Name: staff_read_receipts staff_read_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_read_receipts
    ADD CONSTRAINT staff_read_receipts_pkey PRIMARY KEY (user_id, conversation_id);


--
-- Name: idx_staff_read_receipts_conv_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_staff_read_receipts_conv_user ON public.staff_read_receipts USING btree (conversation_id, user_id);


--
-- Name: idx_staff_read_receipts_conv_delivered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_staff_read_receipts_conv_delivered ON public.staff_read_receipts USING btree (conversation_id) WHERE (delivered_at IS NULL);


--
-- Name: studio_reviews studio_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_reviews
    ADD CONSTRAINT studio_reviews_pkey PRIMARY KEY (id);


--
-- Name: studio_reviews studio_reviews_studio_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_reviews
    ADD CONSTRAINT studio_reviews_studio_id_user_id_key UNIQUE (studio_id, user_id);


--
-- Name: studio_schedule_exceptions studio_schedule_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_schedule_exceptions
    ADD CONSTRAINT studio_schedule_exceptions_pkey PRIMARY KEY (id);


--
-- Name: studio_schedule_exceptions studio_schedule_exceptions_studio_id_exception_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_schedule_exceptions
    ADD CONSTRAINT studio_schedule_exceptions_studio_id_exception_date_key UNIQUE (studio_id, exception_date);


--
-- Name: studio_working_hours studio_working_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_working_hours
    ADD CONSTRAINT studio_working_hours_pkey PRIMARY KEY (id);


--
-- Name: studio_working_hours studio_working_hours_studio_id_day_of_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_working_hours
    ADD CONSTRAINT studio_working_hours_studio_id_day_of_week_key UNIQUE (studio_id, day_of_week);


--
-- Name: studios studios_location_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studios
    ADD CONSTRAINT studios_location_code_key UNIQUE (location_code);


--
-- Name: studios studios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studios
    ADD CONSTRAINT studios_pkey PRIMARY KEY (id);


--
-- Name: subscription_card_changes subscription_card_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_card_changes
    ADD CONSTRAINT subscription_card_changes_pkey PRIMARY KEY (id);


--
-- Name: subscription_credit_usage_log subscription_credit_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credit_usage_log
    ADD CONSTRAINT subscription_credit_usage_log_pkey PRIMARY KEY (id);


--
-- Name: subscription_credits subscription_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credits
    ADD CONSTRAINT subscription_credits_pkey PRIMARY KEY (id);


--
-- Name: subscription_offers subscription_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_offers
    ADD CONSTRAINT subscription_offers_pkey PRIMARY KEY (id);


--
-- Name: subscription_offers subscription_offers_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_offers
    ADD CONSTRAINT subscription_offers_token_key UNIQUE (token);


--
-- Name: subscription_plan_items subscription_plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plan_items
    ADD CONSTRAINT subscription_plan_items_pkey PRIMARY KEY (id);


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);


--
-- Name: subscription_plans subscription_plans_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_slug_key UNIQUE (slug);


--
-- Name: system_telemetry system_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_telemetry
    ADD CONSTRAINT system_telemetry_pkey PRIMARY KEY (id);


--
-- Name: task_handoffs task_handoffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_pkey PRIMARY KEY (id);


--
-- Name: task_links task_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_pkey PRIMARY KEY (id);


--
-- Name: task_links task_links_task_a_id_task_b_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_task_a_id_task_b_id_key UNIQUE (task_a_id, task_b_id);


--
-- Name: task_notes task_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_notes
    ADD CONSTRAINT task_notes_pkey PRIMARY KEY (id);


--
-- Name: telegram_auth_tokens telegram_auth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_auth_tokens
    ADD CONSTRAINT telegram_auth_tokens_pkey PRIMARY KEY (id);


--
-- Name: telegram_auth_tokens telegram_auth_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_auth_tokens
    ADD CONSTRAINT telegram_auth_tokens_token_key UNIQUE (token);


--
-- Name: telegram_users telegram_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_users
    ADD CONSTRAINT telegram_users_pkey PRIMARY KEY (id);


--
-- Name: telegram_users telegram_users_telegram_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_users
    ADD CONSTRAINT telegram_users_telegram_id_key UNIQUE (telegram_id);


--
-- Name: partner_referrals uq_partner_referral_order; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_referrals
    ADD CONSTRAINT uq_partner_referral_order UNIQUE (partner_id, order_id, order_type);


--
-- Name: partner_commission_rules uq_partner_rule; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_commission_rules
    ADD CONSTRAINT uq_partner_rule UNIQUE (partner_id, service_category_slug, order_type);


--
-- Name: product_categories uq_product_categories_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT uq_product_categories_name UNIQUE (name);


--
-- Name: schedule_preferences uq_schedule_prefs_photographer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_preferences
    ADD CONSTRAINT uq_schedule_prefs_photographer UNIQUE (photographer_id);


--
-- Name: user_achievements user_achievements_loyalty_profile_id_achievement_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_loyalty_profile_id_achievement_id_key UNIQUE (loyalty_profile_id, achievement_id);


--
-- Name: user_achievements user_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_id_setting_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_setting_type_key UNIQUE (user_id, setting_type);


--
-- Name: user_subscriptions user_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: users users_apple_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_apple_id_key UNIQUE (apple_id);


--
-- Name: users users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_key UNIQUE (google_id);


--
-- Name: users users_mts_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_mts_id_key UNIQUE (mts_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_sber_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_sber_id_key UNIQUE (sber_id);


--
-- Name: users users_telegram_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_telegram_id_key UNIQUE (telegram_id);


--
-- Name: users users_vk_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_vk_id_key UNIQUE (vk_id);


--
-- Name: users users_yandex_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_yandex_id_key UNIQUE (yandex_id);


--
-- Name: verification_codes verification_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_pkey PRIMARY KEY (id);


--
-- Name: visitor_chat_cart_items visitor_chat_cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_cart_items
    ADD CONSTRAINT visitor_chat_cart_items_pkey PRIMARY KEY (id);


--
-- Name: visitor_chat_cart_items visitor_chat_cart_items_session_id_service_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_cart_items
    ADD CONSTRAINT visitor_chat_cart_items_session_id_service_id_key UNIQUE (session_id, service_id);


--
-- Name: visitor_chat_messages_archive visitor_chat_messages_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_messages_archive
    ADD CONSTRAINT visitor_chat_messages_archive_pkey PRIMARY KEY (id);


--
-- Name: visitor_chat_messages visitor_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_messages
    ADD CONSTRAINT visitor_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: visitor_chat_session_tags visitor_chat_session_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_session_tags
    ADD CONSTRAINT visitor_chat_session_tags_pkey PRIMARY KEY (session_id, tag_id);


--
-- Name: visitor_chat_sessions_archive visitor_chat_sessions_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_sessions_archive
    ADD CONSTRAINT visitor_chat_sessions_archive_pkey PRIMARY KEY (id);


--
-- Name: visitor_chat_sessions visitor_chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_sessions
    ADD CONSTRAINT visitor_chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: visitor_push_subscriptions visitor_push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_push_subscriptions
    ADD CONSTRAINT visitor_push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: visitor_push_subscriptions visitor_push_subscriptions_session_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_push_subscriptions
    ADD CONSTRAINT visitor_push_subscriptions_session_id_endpoint_key UNIQUE (session_id, endpoint);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: webhook_idempotency webhook_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_idempotency
    ADD CONSTRAINT webhook_idempotency_pkey PRIMARY KEY (idempotency_key);


--
-- Name: work_tasks work_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_pkey PRIMARY KEY (id);


--
-- Name: workflow_runs workflow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: workflows workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);


--
-- Name: idx_achievements_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_achievements_profile ON public.user_achievements USING btree (loyalty_profile_id);


--
-- Name: idx_agent_releases_stable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_releases_stable ON public.agent_releases USING btree (agent_type, is_stable) WHERE is_stable;


--
-- Name: idx_agent_releases_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_releases_type ON public.agent_releases USING btree (agent_type);


--
-- Name: idx_agent_update_commands_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_update_commands_agent ON public.agent_update_commands USING btree (agent_id);


--
-- Name: idx_agent_update_commands_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_update_commands_status ON public.agent_update_commands USING btree (status) WHERE ((status)::text <> ALL ((ARRAY['completed'::character varying, 'failed'::character varying, 'rolled_back'::character varying])::text[]));


--
-- Name: idx_agents_heartbeat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_heartbeat ON public.agents USING btree (last_heartbeat_at) WHERE (is_active AND is_online);


--
-- Name: idx_agents_online; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_online ON public.agents USING btree (is_online) WHERE is_active;


--
-- Name: idx_agents_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_studio ON public.agents USING btree (studio_id);


--
-- Name: idx_agents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agents_type ON public.agents USING btree (agent_type);


--
-- Name: idx_app_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_events_created ON public.app_events USING btree (created_at);


--
-- Name: idx_app_events_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_events_name ON public.app_events USING btree (event_name);


--
-- Name: idx_app_events_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_events_visitor ON public.app_events USING btree (visitor_id);


--
-- Name: idx_app_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_logs_created_at ON public.app_logs USING btree (created_at DESC);


--
-- Name: idx_app_logs_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_logs_fingerprint ON public.app_logs USING btree (fingerprint);


--
-- Name: idx_app_logs_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_logs_level ON public.app_logs USING btree (level);


--
-- Name: idx_app_logs_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_logs_service ON public.app_logs USING btree (service);


--
-- Name: idx_app_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_logs_user_id ON public.app_logs USING btree (user_id);


--
-- Name: idx_approval_sessions_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_sessions_client ON public.photo_approval_sessions USING btree (client_phone);


--
-- Name: idx_approval_sessions_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_sessions_deleted_at ON public.photo_approval_sessions USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_approval_sessions_photographer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_sessions_photographer ON public.photo_approval_sessions USING btree (photographer_id);


--
-- Name: idx_approval_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_sessions_status ON public.photo_approval_sessions USING btree (status);


--
-- Name: idx_approvals_session_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approvals_session_round ON public.photo_approvals USING btree (approval_session_id, revision_round);


--
-- Name: idx_approvals_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approvals_status_updated ON public.photo_approval_sessions USING btree (status, updated_at DESC NULLS LAST) WHERE ((status)::text <> 'completed'::text);


--
-- Name: idx_ar_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ar_approval ON public.photo_approval_revisions USING btree (approval_id);


--
-- Name: idx_auc_rollout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auc_rollout ON public.agent_update_commands USING btree (rollout_id) WHERE (rollout_id IS NOT NULL);


--
-- Name: idx_auc_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auc_scheduled ON public.agent_update_commands USING btree (scheduled_at) WHERE (((status)::text = 'pending'::text) AND (scheduled_at IS NOT NULL));


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_log USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: idx_audit_log_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_action ON public.audit_log USING btree (action);


--
-- Name: idx_audit_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created ON public.audit_log USING btree (created_at DESC);


--
-- Name: idx_audit_log_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_user_id ON public.audit_log USING btree (user_id);


--
-- Name: idx_av_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_av_approval ON public.photo_approval_variants USING btree (approval_id);


--
-- Name: idx_behavior_events_heatmap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_behavior_events_heatmap ON public.behavior_events USING btree (page_path, event_type, "timestamp" DESC) WHERE ((click_x IS NOT NULL) AND (click_y IS NOT NULL));


--
-- Name: idx_behavior_events_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_behavior_events_page ON public.behavior_events USING btree (page_path);


--
-- Name: idx_behavior_events_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_behavior_events_session ON public.behavior_events USING btree (session_id);


--
-- Name: idx_behavior_events_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_behavior_events_timestamp ON public.behavior_events USING btree ("timestamp" DESC);


--
-- Name: idx_behavior_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_behavior_events_type ON public.behavior_events USING btree (event_type);


--
-- Name: idx_behavior_events_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_behavior_events_visitor ON public.behavior_events USING btree (visitor_id);


--
-- Name: idx_bookings_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_client_id ON public.bookings USING btree (client_id);


--
-- Name: idx_bookings_client_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_client_phone ON public.bookings USING btree (client_phone) WHERE (client_phone IS NOT NULL);


--
-- Name: idx_bookings_created_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_created_status ON public.bookings USING btree (created_at DESC, status);


--
-- Name: idx_bookings_partner_promo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_partner_promo ON public.bookings USING btree (partner_promo_code) WHERE (partner_promo_code IS NOT NULL);


--
-- Name: idx_bookings_phone_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_phone_normalized ON public.bookings USING btree ("right"(regexp_replace((client_phone)::text, '\D'::text, ''::text, 'g'::text), 10)) WHERE (client_phone IS NOT NULL);


--
-- Name: idx_bookings_photographer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_photographer_id ON public.bookings USING btree (photographer_id);


--
-- Name: idx_bookings_service_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_service_category ON public.bookings USING btree (service_category_slug) WHERE (service_category_slug IS NOT NULL);


--
-- Name: idx_bookings_start_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_start_time ON public.bookings USING btree (start_time);


--
-- Name: idx_bookings_start_time_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_start_time_status ON public.bookings USING btree (start_time, status) WHERE ((status)::text <> ALL (ARRAY[('cancelled'::character varying)::text, ('completed'::character varying)::text, ('no-show'::character varying)::text]));


--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);


--
-- Name: idx_bookings_studio_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_studio_time ON public.bookings USING btree (studio_id, start_time, end_time) WHERE ((status)::text <> 'cancelled'::text);


--
-- Name: idx_bookings_time_range; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_time_range ON public.bookings USING gist (tstzrange(start_time, end_time));


--
-- Name: idx_bridge_devices_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bridge_devices_active ON public.bridge_devices USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_bridge_devices_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bridge_devices_studio ON public.bridge_devices USING btree (studio_id);


--
-- Name: idx_briefings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_briefings_date ON public.shift_briefings USING btree (briefing_date);


--
-- Name: idx_briefings_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_briefings_employee ON public.shift_briefings USING btree (employee_id);


--
-- Name: idx_briefings_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_briefings_unread ON public.shift_briefings USING btree (is_read) WHERE (is_read = false);


--
-- Name: idx_broadcast_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_log_created_at ON public.broadcast_log USING btree (created_at DESC);


--
-- Name: idx_broadcast_log_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_log_user_id ON public.broadcast_log USING btree (user_id);


--
-- Name: idx_bsh_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bsh_booking ON public.booking_status_history USING btree (booking_id, changed_at);


--
-- Name: idx_call_logs_caller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_caller ON public.call_logs USING btree (caller_number);


--
-- Name: idx_call_logs_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_client ON public.call_logs USING btree (client_user_id);


--
-- Name: idx_call_logs_operator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_operator ON public.call_logs USING btree (operator_user_id);


--
-- Name: idx_call_logs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_started ON public.call_logs USING btree (started_at DESC);


--
-- Name: idx_cameras_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cameras_studio ON public.cameras USING btree (studio_id);


--
-- Name: idx_cash_counts_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_counts_shift ON public.pos_cash_counts USING btree (shift_id);


--
-- Name: idx_channel_accounts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_accounts_active ON public.channel_accounts USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_channel_accounts_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_accounts_channel ON public.channel_accounts USING btree (channel);


--
-- Name: idx_channel_users_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_users_contact ON public.channel_users USING btree (contact_id) WHERE (contact_id IS NOT NULL);


--
-- Name: idx_channel_users_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_users_customer ON public.channel_users USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_channel_users_user_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_channel_users_user_channel ON public.channel_users USING btree (user_id, channel) WHERE (user_id IS NOT NULL);


--
-- Name: idx_channel_users_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_users_user_id ON public.channel_users USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_chat_links_bitrix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_links_bitrix ON public.chat_task_links USING btree (bitrix_chat_id) WHERE (bitrix_chat_id IS NOT NULL);


--
-- Name: idx_chat_links_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_links_session ON public.chat_task_links USING btree (chat_session_id) WHERE (chat_session_id IS NOT NULL);


--
-- Name: idx_chat_links_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_links_task ON public.chat_task_links USING btree (task_id);


--
-- Name: idx_chat_links_task_bitrix; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_chat_links_task_bitrix ON public.chat_task_links USING btree (task_id, bitrix_chat_id) WHERE (bitrix_chat_id IS NOT NULL);


--
-- Name: idx_chat_links_task_session; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_chat_links_task_session ON public.chat_task_links USING btree (task_id, chat_session_id) WHERE (chat_session_id IS NOT NULL);


--
-- Name: idx_client_notes_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_notes_created ON public.client_notes USING btree (created_at DESC);


--
-- Name: idx_client_notes_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_notes_phone ON public.client_notes USING btree (client_phone);


--
-- Name: idx_combo_package_items_option; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_combo_package_items_option ON public.combo_package_items USING btree (service_option_id);


--
-- Name: idx_combo_package_items_package; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_combo_package_items_package ON public.combo_package_items USING btree (combo_package_id);


--
-- Name: idx_combo_packages_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_combo_packages_active ON public.combo_packages USING btree (is_active, sort_order);


--
-- Name: idx_competitor_prices_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_prices_category ON public.kb_competitor_prices USING btree (service_category);


--
-- Name: idx_competitor_prices_competitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_prices_competitor ON public.kb_competitor_prices USING btree (competitor_id);


--
-- Name: idx_consumable_stock_low; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_stock_low ON public.consumable_stock USING btree (station_id) WHERE (current_amount <= low_threshold);


--
-- Name: idx_consumable_stock_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_stock_station ON public.consumable_stock USING btree (station_id);


--
-- Name: idx_consumable_transactions_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_transactions_job ON public.consumable_transactions USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: idx_consumable_transactions_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumable_transactions_stock ON public.consumable_transactions USING btree (stock_id);


--
-- Name: idx_contacts_display_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_display_name_lower ON public.contacts USING btree (lower(TRIM(BOTH FROM display_name))) WHERE ((display_name IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_contacts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_email ON public.contacts USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_contacts_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_last_seen ON public.contacts USING btree (last_seen_at DESC);


--
-- Name: idx_contacts_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_contacts_phone ON public.contacts USING btree (phone) WHERE ((phone IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_contacts_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_source ON public.contacts USING btree (source);


--
-- Name: idx_contacts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_user ON public.contacts USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_conv_archive_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_archive_created ON public.conversations_archive USING btree (created_at DESC);


--
-- Name: idx_conv_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_assigned ON public.conversations USING btree (assigned_operator_id) WHERE (assigned_operator_id IS NOT NULL);


--
-- Name: idx_conv_channel_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_channel_email ON public.conversations USING btree (channel, status, last_message_at DESC) WHERE (channel = 'email'::public.channel_type);


--
-- Name: idx_conv_channel_ext; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_channel_ext ON public.conversations USING btree (channel, external_chat_id) WHERE ((status)::text <> 'closed'::text);


--
-- Name: idx_conv_channel_ext_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_conv_channel_ext_unique ON public.conversations USING btree (channel, external_chat_id) WHERE (((status)::text <> 'closed'::text) AND (external_chat_id IS NOT NULL) AND ((external_chat_id)::text <> ''::text));


--
-- Name: idx_conv_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_contact ON public.conversations USING btree (contact_id) WHERE (contact_id IS NOT NULL);


--
-- Name: idx_conv_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_created ON public.conversations USING btree (created_at DESC);


--
-- Name: idx_conv_created_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_created_channel ON public.conversations USING btree (created_at DESC, channel) WHERE ((status)::text <> 'closed'::text);


--
-- Name: idx_conv_csat_submitted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_csat_submitted ON public.conversations USING btree (csat_submitted_at) WHERE (csat_submitted_at IS NOT NULL);


--
-- Name: idx_conv_email_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_email_metadata_gin ON public.conversations USING gin (metadata) WHERE (channel = 'email'::public.channel_type);


--
-- Name: idx_conv_last_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_last_msg ON public.conversations USING btree (last_message_at DESC NULLS LAST);


--
-- Name: idx_conv_metadata_thread_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_metadata_thread_id ON public.conversations USING btree (((metadata ->> 'threadId'::text))) WHERE ((channel = 'email'::public.channel_type) AND ((metadata ->> 'threadId'::text) IS NOT NULL));


--
-- Name: idx_conv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_status ON public.conversations USING btree (status);


--
-- Name: idx_conversation_tags_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversation_tags_conv ON public.conversation_tags USING btree (conversation_id);


--
-- Name: idx_conversations_phone_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_phone_normalized ON public.conversations USING btree ("right"(regexp_replace((visitor_phone)::text, '\D'::text, ''::text, 'g'::text), 10)) WHERE (visitor_phone IS NOT NULL);


--
-- Name: idx_conversion_tasks_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversion_tasks_job ON public.conversion_tasks USING btree (job_id);


--
-- Name: idx_conversion_tasks_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversion_tasks_pending ON public.conversion_tasks USING btree (status, created_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_cpc_campaign_promotion; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_cpc_campaign_promotion ON public.campaign_promo_codes USING btree (campaign_id, promotion_id);


--
-- Name: idx_cqr_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cqr_category ON public.chat_quick_replies USING btree (category) WHERE (is_active = true);


--
-- Name: idx_crawled_pages_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crawled_pages_source ON public.kb_crawled_pages USING btree (source_slug);


--
-- Name: idx_crawled_pages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crawled_pages_status ON public.kb_crawled_pages USING btree (source_slug, status);


--
-- Name: idx_credit_usage_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_usage_created ON public.subscription_credit_usage_log USING btree (created_at DESC);


--
-- Name: idx_credit_usage_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_usage_subscription ON public.subscription_credit_usage_log USING btree (subscription_id);


--
-- Name: idx_crm_files_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_files_entity ON public.crm_files USING btree (entity_type, entity_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_crm_files_uploader; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_files_uploader ON public.crm_files USING btree (uploaded_by) WHERE (deleted_at IS NULL);


--
-- Name: idx_crm_inbox_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_inbox_assigned ON public.crm_inbox USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: idx_crm_inbox_client_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_inbox_client_phone ON public.crm_inbox USING btree (client_phone) WHERE (client_phone IS NOT NULL);


--
-- Name: idx_crm_inbox_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_inbox_sort ON public.crm_inbox USING btree (priority, sort_time DESC NULLS LAST);


--
-- Name: idx_crm_inbox_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_inbox_type ON public.crm_inbox USING btree (type);


--
-- Name: idx_crm_inbox_view_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_crm_inbox_view_pk ON public.crm_inbox_view USING btree (type, id);


--
-- Name: idx_crm_notes_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_notes_entity ON public.crm_notes USING btree (entity_type, entity_id);


--
-- Name: idx_customer_feedback_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_feedback_created ON public.customer_feedback USING btree (created_at DESC);


--
-- Name: idx_customer_feedback_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_feedback_employee ON public.customer_feedback USING btree (employee_id, created_at DESC);


--
-- Name: idx_customer_feedback_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_feedback_source ON public.customer_feedback USING btree (source);


--
-- Name: idx_customer_tag_assignments_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_tag_assignments_tag ON public.customer_tag_assignments USING btree (tag_id);


--
-- Name: idx_customer_tags_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_customer_tags_name ON public.customer_tags USING btree (lower((name)::text));


--
-- Name: idx_customers_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_email ON public.customers USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_customers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_customers_phone ON public.customers USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: idx_customers_telegram; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_customers_telegram ON public.customers USING btree (telegram_user_id) WHERE (telegram_user_id IS NOT NULL);


--
-- Name: idx_customers_visitor_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_visitor_ids ON public.customers USING gin (visitor_ids);


--
-- Name: idx_design_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_design_templates_active ON public.design_templates USING btree (is_active, sort_order);


--
-- Name: idx_design_templates_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_design_templates_service ON public.design_templates USING btree (service_id);


--
-- Name: idx_document_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_templates_active ON public.document_templates USING btree (is_active, sort_order);


--
-- Name: idx_email_attachments_cid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_attachments_cid ON public.email_attachments USING btree (content_id) WHERE (content_id IS NOT NULL);


--
-- Name: idx_email_attachments_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_attachments_email ON public.email_attachments USING btree (email_id);


--
-- Name: idx_email_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_customer ON public.email_messages USING btree (customer_phone) WHERE (customer_phone IS NOT NULL);


--
-- Name: idx_email_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_direction ON public.email_messages USING btree (direction, created_at DESC);


--
-- Name: idx_email_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_entity ON public.email_messages USING btree (entity_type, entity_id) WHERE (entity_type IS NOT NULL);


--
-- Name: idx_email_imap_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_imap_uid ON public.email_messages USING btree (imap_uid, imap_folder) WHERE (imap_uid IS NOT NULL);


--
-- Name: idx_email_messages_not_bounce; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_messages_not_bounce ON public.email_messages USING btree (direction, created_at DESC) WHERE (is_bounce = false);


--
-- Name: idx_email_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_status ON public.email_messages USING btree (status) WHERE ((status)::text <> 'archived'::text);


--
-- Name: idx_email_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_thread ON public.email_messages USING btree (thread_id);


--
-- Name: idx_emp_push_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_push_user ON public.employee_push_subscriptions USING btree (user_id);


--
-- Name: idx_emp_quests_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_quests_date ON public.employee_daily_quests USING btree (employee_id, quest_date);


--
-- Name: idx_emp_unlocked_ach; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_unlocked_ach ON public.employee_unlocked_achievements USING btree (employee_id);


--
-- Name: idx_emp_xp_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_xp_action ON public.employee_xp_log USING btree (action_type);


--
-- Name: idx_emp_xp_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_xp_employee ON public.employee_xp_log USING btree (employee_id, created_at DESC);


--
-- Name: idx_employee_compensation_effective; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_compensation_effective ON public.employee_compensation USING btree (employee_id, effective_from);


--
-- Name: idx_employee_compensation_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_compensation_employee ON public.employee_compensation USING btree (employee_id);


--
-- Name: idx_employee_favorites_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_favorites_employee ON public.employee_favorites USING btree (employee_id);


--
-- Name: idx_employee_sales_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_sales_employee_date ON public.employee_sales USING btree (employee_id, created_at);


--
-- Name: idx_employee_tax_deductions_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_tax_deductions_employee ON public.employee_tax_deductions USING btree (employee_id, tax_year);


--
-- Name: idx_employee_tax_deductions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_tax_deductions_status ON public.employee_tax_deductions USING btree (status, tax_year);


--
-- Name: idx_emr_employee_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emr_employee_month ON public.employee_manual_revenue USING btree (employee_id, month);


--
-- Name: idx_face_validations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_face_validations_created ON public.face_validations USING btree (created_at DESC);


--
-- Name: idx_face_validations_document_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_face_validations_document_type ON public.face_validations USING btree (document_type) WHERE (document_type IS NOT NULL);


--
-- Name: idx_face_validations_dpi_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_face_validations_dpi_source ON public.face_validations USING btree (dpi_source, created_at DESC) WHERE (dpi_source IS NOT NULL);


--
-- Name: idx_face_validations_gost_pass; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_face_validations_gost_pass ON public.face_validations USING btree (gost_pass, created_at DESC) WHERE (gost_pass IS NOT NULL);


--
-- Name: idx_face_validations_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_face_validations_message ON public.face_validations USING btree (message_id) WHERE (message_id IS NOT NULL);


--
-- Name: idx_face_validations_passport_validity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_face_validations_passport_validity ON public.face_validations USING btree (is_valid_passport, created_at DESC) WHERE (is_valid_passport IS NOT NULL);


--
-- Name: idx_face_validations_photo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_face_validations_photo ON public.face_validations USING btree (photo_approval_id) WHERE (photo_approval_id IS NOT NULL);


--
-- Name: idx_face_validations_validated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_face_validations_validated_by ON public.face_validations USING btree (validated_by) WHERE (validated_by IS NOT NULL);


--
-- Name: idx_face_validations_verdict; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_face_validations_verdict ON public.face_validations USING btree (verdict, created_at DESC) WHERE ((verdict)::text = ANY ((ARRAY['invalid'::character varying, 'needs_manual_review'::character varying])::text[]));


--
-- Name: idx_feature_flags_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_flags_enabled ON public.feature_flags USING btree (enabled) WHERE (enabled = true);


--
-- Name: idx_files_storage_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_storage_type ON public.files USING btree (storage_type);


--
-- Name: idx_files_uploaded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_uploaded_at ON public.files USING btree (uploaded_at DESC);


--
-- Name: idx_files_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_user_id ON public.files USING btree (user_id);


--
-- Name: idx_followup_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_followup_pending ON public.chat_followups USING btree (follow_up_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_followup_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_followup_session ON public.chat_followups USING btree (session_id);


--
-- Name: idx_gallery_photos_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gallery_photos_category ON public.gallery_photos USING btree (category);


--
-- Name: idx_gallery_photos_is_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gallery_photos_is_featured ON public.gallery_photos USING btree (is_featured);


--
-- Name: idx_gallery_photos_is_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gallery_photos_is_public ON public.gallery_photos USING btree (is_public);


--
-- Name: idx_gallery_photos_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gallery_photos_sort_order ON public.gallery_photos USING btree (sort_order);


--
-- Name: idx_handoffs_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_handoffs_from ON public.task_handoffs USING btree (from_employee_id);


--
-- Name: idx_handoffs_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_handoffs_pending ON public.task_handoffs USING btree (acknowledged) WHERE (acknowledged = false);


--
-- Name: idx_handoffs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_handoffs_task ON public.task_handoffs USING btree (task_id);


--
-- Name: idx_handoffs_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_handoffs_to ON public.task_handoffs USING btree (to_employee_id);


--
-- Name: idx_icc_profiles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_icc_profiles_active ON public.icc_profiles USING btree (is_active) WHERE is_active;


--
-- Name: idx_icc_profiles_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_icc_profiles_device ON public.icc_profiles USING btree (device_id);


--
-- Name: idx_inbox_mv_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_mv_assigned ON public.crm_inbox_view USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: idx_inbox_mv_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_mv_sort ON public.crm_inbox_view USING btree (priority, sort_time DESC NULLS LAST);


--
-- Name: idx_inbox_mv_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_mv_type ON public.crm_inbox_view USING btree (type);


--
-- Name: idx_infra_alerts_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infra_alerts_severity ON public.infra_alerts USING btree (severity, created_at DESC) WHERE (resolved_at IS NULL);


--
-- Name: idx_infra_alerts_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infra_alerts_studio ON public.infra_alerts USING btree (studio_id);


--
-- Name: idx_infra_alerts_unnotified_critical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infra_alerts_unnotified_critical ON public.infra_alerts USING btree (created_at DESC) WHERE (((severity)::text = 'critical'::text) AND (is_acknowledged = false) AND (telegram_notified_at IS NULL) AND (resolved_at IS NULL));


--
-- Name: idx_infra_alerts_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infra_alerts_unresolved ON public.infra_alerts USING btree (created_at DESC) WHERE (resolved_at IS NULL);


--
-- Name: idx_inventory_receipts_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_receipts_date ON public.inventory_receipts USING btree (received_at);


--
-- Name: idx_inventory_receipts_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_receipts_employee ON public.inventory_receipts USING btree (employee_id);


--
-- Name: idx_inventory_receipts_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_receipts_studio ON public.inventory_receipts USING btree (studio_id);


--
-- Name: idx_inventory_transactions_product_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_transactions_product_date ON public.inventory_transactions USING btree (product_stock_id, created_at);


--
-- Name: idx_inventory_transactions_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_transactions_reference ON public.inventory_transactions USING btree (reference_id);


--
-- Name: idx_inventory_transactions_studio_type_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_transactions_studio_type_date ON public.inventory_transactions USING btree (studio_id, type, created_at);


--
-- Name: idx_kb_categories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_categories_active ON public.kb_categories USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_kb_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_categories_parent ON public.kb_categories USING btree (parent_id);


--
-- Name: idx_kb_categories_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_categories_path ON public.kb_categories USING btree (path);


--
-- Name: idx_kb_enrichment_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_enrichment_entity ON public.kb_enrichment_tasks USING btree (entity_id);


--
-- Name: idx_kb_enrichment_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_enrichment_pending ON public.kb_enrichment_tasks USING btree (priority, scheduled_at) WHERE (status = 'pending'::text);


--
-- Name: idx_kb_enrichment_recurring; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_enrichment_recurring ON public.kb_enrichment_tasks USING btree (next_run_at) WHERE ((cron_expression IS NOT NULL) AND (status <> 'cancelled'::text));


--
-- Name: idx_kb_enrichment_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_enrichment_type ON public.kb_enrichment_tasks USING btree (task_type, status);


--
-- Name: idx_kb_entities_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_category ON public.kb_entities USING btree (category_id, status);


--
-- Name: idx_kb_entities_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_created ON public.kb_entities USING btree (created_at DESC);


--
-- Name: idx_kb_entities_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_deleted ON public.kb_entities USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_kb_entities_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_embedding ON public.kb_entities USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64');


--
-- Name: idx_kb_entities_metadata; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_metadata ON public.kb_entities USING gin (metadata jsonb_path_ops);


--
-- Name: idx_kb_entities_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_name_trgm ON public.kb_entities USING gin (name public.gin_trgm_ops);


--
-- Name: idx_kb_entities_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_search ON public.kb_entities USING gin (search_vector);


--
-- Name: idx_kb_entities_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_status ON public.kb_entities USING btree (status) WHERE (deleted_at IS NULL);


--
-- Name: idx_kb_entities_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_tags ON public.kb_entities USING gin (tags);


--
-- Name: idx_kb_entities_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_type ON public.kb_entities USING btree (entity_type, status);


--
-- Name: idx_kb_entities_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_entities_verified ON public.kb_entities USING btree (is_verified, status) WHERE ((is_verified = false) AND (status = 'active'::text));


--
-- Name: idx_kb_metrics_definition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_metrics_definition ON public.kb_metrics USING btree (definition_id, period_start DESC);


--
-- Name: idx_kb_metrics_dimensions; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_metrics_dimensions ON public.kb_metrics USING gin (dimensions jsonb_path_ops);


--
-- Name: idx_kb_metrics_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_metrics_period ON public.kb_metrics USING btree (period_start DESC, period_type);


--
-- Name: idx_kb_relations_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_relations_from ON public.kb_relations USING btree (from_entity_id, relation_type);


--
-- Name: idx_kb_relations_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_relations_to ON public.kb_relations USING btree (to_entity_id, relation_type);


--
-- Name: idx_kb_relations_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_relations_type ON public.kb_relations USING btree (relation_type);


--
-- Name: idx_kb_source_links_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_source_links_entity ON public.kb_source_links USING btree (entity_id);


--
-- Name: idx_kb_source_links_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_source_links_source ON public.kb_source_links USING btree (source_id);


--
-- Name: idx_kb_versions_changed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_versions_changed_by ON public.kb_entity_versions USING btree (changed_by, created_at DESC);


--
-- Name: idx_kpi_alerts_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_alerts_emp ON public.kpi_alerts USING btree (employee_id, created_at DESC);


--
-- Name: idx_kpi_alerts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_alerts_type ON public.kpi_alerts USING btree (alert_type);


--
-- Name: idx_kpi_alerts_unack; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_alerts_unack ON public.kpi_alerts USING btree (acknowledged) WHERE (NOT acknowledged);


--
-- Name: idx_kpi_comp_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_comp_emp ON public.kpi_composite_scores USING btree (employee_id, period_start DESC);


--
-- Name: idx_kpi_comp_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_comp_rating ON public.kpi_composite_scores USING btree (rating, period_type);


--
-- Name: idx_kpi_md_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_md_active ON public.kpi_metric_definitions USING btree (is_active) WHERE is_active;


--
-- Name: idx_kpi_md_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_md_category ON public.kpi_metric_definitions USING btree (category);


--
-- Name: idx_kpi_snap_emp_metric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_snap_emp_metric ON public.kpi_snapshots USING btree (employee_id, metric_code, period_start DESC);


--
-- Name: idx_kpi_snap_metric_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_snap_metric_period ON public.kpi_snapshots USING btree (metric_code, period_type, period_start DESC);


--
-- Name: idx_kpi_snap_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_snap_period ON public.kpi_snapshots USING btree (period_type, period_start);


--
-- Name: idx_kpi_targets_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_targets_lookup ON public.kpi_targets USING btree (metric_code, scope, effective_from DESC);


--
-- Name: idx_kpi_targets_scope_val; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_targets_scope_val ON public.kpi_targets USING btree (scope_value) WHERE (scope_value IS NOT NULL);


--
-- Name: idx_login_attempts_cleanup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_cleanup ON public.login_attempts USING btree (created_at);


--
-- Name: idx_login_attempts_email_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_email_time ON public.login_attempts USING btree (email, created_at DESC) WHERE (success = false);


--
-- Name: idx_loyalty_profiles_customer_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_loyalty_profiles_customer_id_unique ON public.loyalty_profiles USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_loyalty_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_loyalty_user_id ON public.loyalty_profiles USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_material_usage_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_usage_created ON public.material_usage USING btree (created_at);


--
-- Name: idx_material_usage_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_usage_product ON public.material_usage USING btree (product_id);


--
-- Name: idx_material_usage_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_usage_studio ON public.material_usage USING btree (studio_id);


--
-- Name: idx_material_usage_work_log; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_usage_work_log ON public.material_usage USING btree (work_log_id) WHERE (work_log_id IS NOT NULL);


--
-- Name: idx_mc_campaign_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mc_campaign_type ON public.marketing_campaigns USING btree (campaign_type);


--
-- Name: idx_mc_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mc_created_at ON public.marketing_campaigns USING btree (created_at DESC);


--
-- Name: idx_mc_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mc_dates ON public.marketing_campaigns USING btree (start_date, end_date);


--
-- Name: idx_mc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mc_status ON public.marketing_campaigns USING btree (status);


--
-- Name: idx_media_attachments_av_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_attachments_av_status ON public.media_attachments USING btree (av_status) WHERE ((av_status)::text <> 'clean'::text);


--
-- Name: idx_media_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_message ON public.media_attachments USING btree (message_id);


--
-- Name: idx_media_processing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_processing ON public.media_attachments USING btree (processing_status) WHERE ((processing_status)::text <> 'uploaded'::text);


--
-- Name: idx_mobile_push_tokens_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mobile_push_tokens_active ON public.mobile_push_tokens USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_mobile_push_tokens_device_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mobile_push_tokens_device_provider ON public.mobile_push_tokens USING btree (device_id, push_provider);


--
-- Name: idx_mobile_push_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mobile_push_tokens_user ON public.mobile_push_tokens USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_mobile_push_tokens_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mobile_push_tokens_visitor ON public.mobile_push_tokens USING btree (visitor_id) WHERE (visitor_id IS NOT NULL);


--
-- Name: idx_msg_archive_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_archive_conv ON public.messages_archive USING btree (conversation_id);


--
-- Name: idx_msg_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_msg_client_id ON public.messages USING btree (client_message_id) WHERE (client_message_id IS NOT NULL);


--
-- Name: idx_msg_content_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_content_trgm ON public.messages USING gin (content public.gin_trgm_ops);


--
-- Name: idx_msg_conversation_cursor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_conversation_cursor ON public.messages USING btree (conversation_id, created_at DESC, id DESC);


--
-- Name: idx_msg_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_event_type ON public.messages USING btree (conversation_id, event_type) WHERE (event_type IS NOT NULL);


--
-- Name: idx_msg_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_msg_external_id ON public.messages USING btree (external_message_id) WHERE (external_message_id IS NOT NULL);


--
-- Name: idx_msg_metadata_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_metadata_message_id ON public.messages USING btree (((metadata ->> 'messageId'::text))) WHERE ((metadata ->> 'messageId'::text) IS NOT NULL);


--
-- Name: idx_msg_reply_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_reply_to ON public.messages USING btree (reply_to_message_id) WHERE (reply_to_message_id IS NOT NULL);


--
-- Name: idx_msg_status_failed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_status_failed ON public.message_statuses USING btree (status) WHERE ((status)::text = 'failed'::text);


--
-- Name: idx_msg_status_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_status_message ON public.message_statuses USING btree (message_id, created_at DESC);


--
-- Name: idx_notes_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_author ON public.task_notes USING btree (author_id);


--
-- Name: idx_notes_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_created ON public.task_notes USING btree (created_at);


--
-- Name: idx_notes_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_task ON public.task_notes USING btree (task_id);


--
-- Name: idx_notifications_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_read ON public.notifications USING btree (read);


--
-- Name: idx_notifications_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_timestamp ON public.notifications USING btree ("timestamp" DESC);


--
-- Name: idx_notifications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_type ON public.notifications USING btree (type);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, read) WHERE (read = false);


--
-- Name: idx_odl_channel_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odl_channel_created ON public.outbound_delivery_log_archived USING btree (channel, created_at DESC);


--
-- Name: idx_odl_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odl_session ON public.outbound_delivery_log_archived USING btree (session_id);


--
-- Name: idx_odl_source_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odl_source_msg ON public.outbound_delivery_log USING btree (source_message_id) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_odl_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odl_status ON public.outbound_delivery_log_archived USING btree (status) WHERE ((status)::text = ANY ((ARRAY['failed'::character varying, 'dead_letter'::character varying])::text[]));


--
-- Name: idx_option_groups_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_option_groups_category ON public.option_groups USING btree (service_category_id);


--
-- Name: idx_option_rules_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_option_rules_category ON public.option_rules USING btree (service_category_id);


--
-- Name: idx_option_rules_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_option_rules_source ON public.option_rules USING btree (source_option_id);


--
-- Name: idx_option_rules_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_option_rules_target ON public.option_rules USING btree (target_option_id);


--
-- Name: idx_order_assignments_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_assignments_assigned ON public.order_assignments USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: idx_order_assignments_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_assignments_deadline ON public.order_assignments USING btree (deadline_at) WHERE ((status)::text <> ALL (ARRAY[('completed'::character varying)::text, ('cancelled'::character varying)::text]));


--
-- Name: idx_order_assignments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_assignments_status ON public.order_assignments USING btree (status) WHERE ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('in_progress'::character varying)::text, ('help_needed'::character varying)::text]));


--
-- Name: idx_order_assignments_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_assignments_studio ON public.order_assignments USING btree (studio_id);


--
-- Name: idx_order_attachments_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_attachments_order_id ON public.order_attachments USING btree (order_id);


--
-- Name: idx_order_attachments_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_attachments_type ON public.order_attachments USING btree (order_id, attachment_type);


--
-- Name: idx_order_comments_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_comments_order_id ON public.order_comments USING btree (order_id);


--
-- Name: idx_order_comments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_comments_user_id ON public.order_comments USING btree (user_id);


--
-- Name: idx_order_delay_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_delay_created ON public.order_delay_compensations USING btree (created_at DESC);


--
-- Name: idx_order_delay_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_delay_order ON public.order_delay_compensations USING btree (order_id);


--
-- Name: idx_order_items_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_created_at ON public.order_items USING btree (created_at);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product_id ON public.order_items USING btree (product_id);


--
-- Name: idx_order_items_service_option_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_service_option_id ON public.order_items USING btree (service_option_id);


--
-- Name: idx_order_templates_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_templates_created_by ON public.order_templates USING btree (created_by) WHERE is_active;


--
-- Name: idx_order_templates_personal_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_order_templates_personal_name ON public.order_templates USING btree (created_by, lower((name)::text)) WHERE is_active;


--
-- Name: idx_order_templates_scope_shared; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_templates_scope_shared ON public.order_templates USING btree (scope, sort_order) WHERE (((scope)::text = 'shared'::text) AND is_active);


--
-- Name: idx_orders_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_assigned ON public.photo_print_orders USING btree (assigned_employee_id) WHERE (assigned_employee_id IS NOT NULL);


--
-- Name: idx_orders_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_client_id ON public.orders USING btree (client_id);


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);


--
-- Name: idx_orders_photographer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_photographer_id ON public.orders USING btree (photographer_id);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_orders_status_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_priority ON public.photo_print_orders USING btree (status, priority, created_at DESC) WHERE ((status)::text <> ALL (ARRAY[('completed'::character varying)::text, ('cancelled'::character varying)::text]));


--
-- Name: idx_osh_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_osh_created ON public.order_status_history USING btree (created_at DESC);


--
-- Name: idx_osh_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_osh_order ON public.order_status_history USING btree (order_id);


--
-- Name: idx_outbound_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbound_conversation ON public.outbound_queue USING btree (conversation_id);


--
-- Name: idx_outbound_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbound_pending ON public.outbound_queue USING btree (channel, next_retry_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_outbound_queue_status_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbound_queue_status_channel ON public.outbound_queue USING btree (status, channel) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'failed'::character varying, 'dead_letter'::character varying])::text[]));


--
-- Name: idx_outbound_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbound_status ON public.outbound_queue USING btree (status) WHERE ((status)::text = ANY ((ARRAY['failed'::character varying, 'dead_letter'::character varying])::text[]));


--
-- Name: idx_partner_payouts_partner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partner_payouts_partner ON public.partner_payouts USING btree (partner_id, created_at DESC);


--
-- Name: idx_partner_payouts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partner_payouts_status ON public.partner_payouts USING btree (status) WHERE ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text]));


--
-- Name: idx_partner_referrals_partner_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partner_referrals_partner_created ON public.partner_referrals USING btree (partner_id, created_at DESC);


--
-- Name: idx_partner_referrals_partner_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partner_referrals_partner_phone ON public.partner_referrals USING btree (partner_id, client_phone);


--
-- Name: idx_partner_referrals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partner_referrals_status ON public.partner_referrals USING btree (status) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_partners_inn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partners_inn ON public.partners USING btree (inn) WHERE (inn IS NOT NULL);


--
-- Name: idx_partners_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partners_status ON public.partners USING btree (status);


--
-- Name: idx_pcr_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcr_active ON public.partner_commission_rules USING btree (partner_id, is_active) WHERE (is_active = true);


--
-- Name: idx_pcr_partner_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcr_partner_category ON public.partner_commission_rules USING btree (partner_id, service_category_slug);


--
-- Name: idx_pcr_partner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pcr_partner_id ON public.partner_commission_rules USING btree (partner_id);


--
-- Name: idx_pe_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pe_event_type ON public.payment_events USING btree (event_type);


--
-- Name: idx_pe_order_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pe_order_created ON public.payment_events USING btree (order_id, created_at);


--
-- Name: idx_pending_oauth_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_oauth_expires ON public.pending_oauth_links USING btree (expires_at) WHERE (used = false);


--
-- Name: idx_permissions_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permissions_session_id ON public.permissions USING btree (session_id);


--
-- Name: idx_permissions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permissions_status ON public.permissions USING btree (status);


--
-- Name: idx_permissions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permissions_type ON public.permissions USING btree (type);


--
-- Name: idx_permissions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permissions_user_id ON public.permissions USING btree (user_id);


--
-- Name: idx_photo_approval_annotations_approval_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_approval_annotations_approval_id ON public.photo_approval_annotations USING btree (approval_id);


--
-- Name: idx_photo_approval_annotations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_approval_annotations_user_id ON public.photo_approval_annotations USING btree (user_id);


--
-- Name: idx_photo_approvals_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_approvals_client_id ON public.photo_approvals USING btree (client_id);


--
-- Name: idx_photo_approvals_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_approvals_order_id ON public.photo_approvals USING btree (order_id);


--
-- Name: idx_photo_approvals_photographer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_approvals_photographer_id ON public.photo_approvals USING btree (photographer_id);


--
-- Name: idx_photo_approvals_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_approvals_session ON public.photo_approvals USING btree (approval_session_id);


--
-- Name: idx_photo_approvals_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_approvals_session_id ON public.photo_approvals USING btree (session_id);


--
-- Name: idx_photo_approvals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_approvals_status ON public.photo_approvals USING btree (status);


--
-- Name: idx_photo_print_orders_chat_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_print_orders_chat_session ON public.photo_print_orders USING btree (chat_session_id) WHERE (chat_session_id IS NOT NULL);


--
-- Name: idx_photo_print_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_print_orders_created_at ON public.photo_print_orders USING btree (created_at DESC);


--
-- Name: idx_photo_print_orders_delivery_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_print_orders_delivery_method ON public.photo_print_orders USING btree (delivery_method);


--
-- Name: idx_photo_print_orders_partner_promo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_print_orders_partner_promo ON public.photo_print_orders USING btree (partner_promo_code) WHERE (partner_promo_code IS NOT NULL);


--
-- Name: idx_photo_print_orders_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_print_orders_phone ON public.photo_print_orders USING btree (contact_phone);


--
-- Name: idx_photo_print_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_print_orders_status ON public.photo_print_orders USING btree (status);


--
-- Name: idx_photo_selections_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_selections_session_id ON public.photo_selections USING btree (session_id);


--
-- Name: idx_photo_selections_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_selections_status ON public.photo_selections USING btree (status);


--
-- Name: idx_photo_selections_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_selections_user_id ON public.photo_selections USING btree (user_id);


--
-- Name: idx_photo_sessions_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_sessions_client_id ON public.photo_sessions USING btree (client_id);


--
-- Name: idx_photo_sessions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_sessions_date ON public.photo_sessions USING btree (date DESC);


--
-- Name: idx_photo_sessions_photographer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photo_sessions_photographer_id ON public.photo_sessions USING btree (photographer_id);


--
-- Name: idx_photographer_services_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photographer_services_enabled ON public.photographer_services USING btree (is_enabled);


--
-- Name: idx_photographer_services_photographer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photographer_services_photographer_id ON public.photographer_services USING btree (photographer_id);


--
-- Name: idx_photographers_location_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photographers_location_city ON public.photographers USING btree (((location ->> 'city'::text)));


--
-- Name: idx_photographers_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photographers_rating ON public.photographers USING btree ((((rating ->> 'average'::text))::numeric));


--
-- Name: idx_photographers_specializations; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photographers_specializations ON public.photographers USING gin (specializations);


--
-- Name: idx_photographers_verified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photographers_verified ON public.photographers USING btree (verified);


--
-- Name: idx_photos_selected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photos_selected ON public.photos USING btree (selected);


--
-- Name: idx_photos_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photos_session_id ON public.photos USING btree (session_id);


--
-- Name: idx_photos_uploaded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_photos_uploaded_at ON public.photos USING btree (uploaded_at DESC);


--
-- Name: idx_php_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_php_active ON public.printing_house_products USING btree (printing_house_id, is_active);


--
-- Name: idx_php_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_php_category ON public.printing_house_products USING btree (category);


--
-- Name: idx_php_house; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_php_house ON public.printing_house_products USING btree (printing_house_id);


--
-- Name: idx_pi_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_order ON public.payment_installments USING btree (order_id);


--
-- Name: idx_pi_order_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_order_status ON public.payment_installments USING btree (order_id, payment_status);


--
-- Name: idx_pl_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_user ON public.price_locks USING btree (user_id, category_slug);


--
-- Name: idx_pl_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_visitor ON public.price_locks USING btree (visitor_id, category_slug);


--
-- Name: idx_po_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_created ON public.production_orders USING btree (created_at DESC);


--
-- Name: idx_po_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_deadline ON public.production_orders USING btree (deadline_at) WHERE ((status)::text <> ALL (ARRAY[('completed'::character varying)::text, ('cancelled'::character varying)::text, ('returned'::character varying)::text]));


--
-- Name: idx_po_house; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_house ON public.production_orders USING btree (printing_house_id);


--
-- Name: idx_po_items; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_items ON public.production_orders USING gin (items);


--
-- Name: idx_po_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_source ON public.production_orders USING btree (photo_print_order_id) WHERE (photo_print_order_id IS NOT NULL);


--
-- Name: idx_po_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_status ON public.production_orders USING btree (status);


--
-- Name: idx_poe_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poe_created ON public.production_order_events USING btree (created_at);


--
-- Name: idx_poe_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poe_order ON public.production_order_events USING btree (production_order_id);


--
-- Name: idx_points_tx_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_tx_created ON public.points_transactions USING btree (created_at DESC);


--
-- Name: idx_points_tx_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_tx_profile ON public.points_transactions USING btree (loyalty_profile_id);


--
-- Name: idx_points_tx_profile_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_tx_profile_created ON public.points_transactions USING btree (loyalty_profile_id, created_at DESC);


--
-- Name: idx_pos_receipt_items_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipt_items_product ON public.pos_receipt_items USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: idx_pos_receipt_items_receipt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipt_items_receipt ON public.pos_receipt_items USING btree (receipt_id);


--
-- Name: idx_pos_receipt_payments_receipt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipt_payments_receipt ON public.pos_receipt_payments USING btree (receipt_id);


--
-- Name: idx_pos_receipt_payments_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipt_payments_type ON public.pos_receipt_payments USING btree (payment_type);


--
-- Name: idx_pos_receipts_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_customer ON public.pos_receipts USING btree (customer_phone) WHERE (customer_phone IS NOT NULL);


--
-- Name: idx_pos_receipts_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_customer_id ON public.pos_receipts USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_pos_receipts_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_date ON public.pos_receipts USING btree (created_at);


--
-- Name: idx_pos_receipts_fiscal_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_fiscal_pending ON public.pos_receipts USING btree (fiscal_status) WHERE (fiscal_status = ANY (ARRAY['pending'::text, 'queued'::text, 'failed'::text]));


--
-- Name: idx_pos_receipts_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pos_receipts_number ON public.pos_receipts USING btree (receipt_number);


--
-- Name: idx_pos_receipts_partner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_partner_id ON public.pos_receipts USING btree (partner_id) WHERE (partner_id IS NOT NULL);


--
-- Name: idx_pos_receipts_phone_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_phone_normalized ON public.pos_receipts USING btree ("right"(regexp_replace((customer_phone)::text, '\D'::text, ''::text, 'g'::text), 10)) WHERE (customer_phone IS NOT NULL);


--
-- Name: idx_pos_receipts_print_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_print_order ON public.pos_receipts USING btree (print_order_id) WHERE (print_order_id IS NOT NULL);


--
-- Name: idx_pos_receipts_promo_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_promo_code ON public.pos_receipts USING btree (promo_code) WHERE (promo_code IS NOT NULL);


--
-- Name: idx_pos_receipts_refund; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_refund ON public.pos_receipts USING btree (refund_receipt_id) WHERE (refund_receipt_id IS NOT NULL);


--
-- Name: idx_pos_receipts_refund_receipt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_refund_receipt ON public.pos_receipts USING btree (refund_receipt_id) WHERE (refund_receipt_id IS NOT NULL);


--
-- Name: idx_pos_receipts_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_shift ON public.pos_receipts USING btree (shift_id);


--
-- Name: idx_pos_receipts_voided; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_receipts_voided ON public.pos_receipts USING btree (shift_id) WHERE (voided_at IS NOT NULL);


--
-- Name: idx_pos_shifts_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_shifts_date ON public.pos_shifts USING btree (opened_at);


--
-- Name: idx_pos_shifts_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_shifts_employee ON public.pos_shifts USING btree (employee_id);


--
-- Name: idx_pos_shifts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_shifts_status ON public.pos_shifts USING btree (status) WHERE ((status)::text = 'open'::text);


--
-- Name: idx_pos_shifts_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_shifts_studio ON public.pos_shifts USING btree (studio_id);


--
-- Name: idx_pos_transactions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_transactions_date ON public.pos_transactions USING btree (initiated_at);


--
-- Name: idx_pos_transactions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_transactions_order ON public.pos_transactions USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_pos_transactions_receipt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_transactions_receipt ON public.pos_transactions USING btree (receipt_id) WHERE (receipt_id IS NOT NULL);


--
-- Name: idx_pos_transactions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_transactions_status ON public.pos_transactions USING btree (status) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_pos_transactions_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_transactions_studio ON public.pos_transactions USING btree (studio_id, initiated_at DESC);


--
-- Name: idx_pos_fiscal_settings_agent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_fiscal_settings_agent_id ON public.pos_fiscal_settings USING btree (agent_id);


--
-- Name: idx_pp_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_order ON public.priority_purchases USING btree (order_id);


--
-- Name: idx_ppo_abandoned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_abandoned ON public.photo_print_orders USING btree (created_at) WHERE ((status)::text = 'pending_payment'::text);


--
-- Name: idx_ppo_campaign_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_campaign_id ON public.photo_print_orders USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);


--
-- Name: idx_ppo_created_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_created_payment ON public.photo_print_orders USING btree (created_at DESC, payment_status) WHERE ((status)::text <> 'cancelled'::text);


--
-- Name: idx_ppo_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_customer ON public.photo_print_orders USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_ppo_document_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_document_template ON public.photo_print_orders USING btree (document_template_id) WHERE (document_template_id IS NOT NULL);


--
-- Name: idx_ppo_medals_required; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_medals_required ON public.photo_print_orders USING btree (medals_required) WHERE (medals_required = true);


--
-- Name: idx_ppo_payment_reminders; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_payment_reminders ON public.photo_print_orders USING btree (created_at, reminder_sent_at, payment_reminder_count) WHERE (((payment_status)::text = ANY ((ARRAY['pending_payment'::character varying, 'none'::character varying])::text[])) AND ((status)::text <> ALL ((ARRAY['completed'::character varying, 'cancelled'::character varying, 'expired'::character varying])::text[])));


--
-- Name: idx_ppo_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_payment_status ON public.photo_print_orders USING btree (payment_status);


--
-- Name: idx_ppo_phone_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_phone_normalized ON public.photo_print_orders USING btree ("right"(regexp_replace((contact_phone)::text, '\D'::text, ''::text, 'g'::text), 10)) WHERE (contact_phone IS NOT NULL);


--
-- Name: idx_ppo_photo_format; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_photo_format ON public.photo_print_orders USING btree (photo_format) WHERE (photo_format IS NOT NULL);


--
-- Name: idx_ppo_priority_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_priority_queue ON public.photo_print_orders USING btree (priority DESC, created_at) WHERE (((payment_status)::text = 'paid'::text) AND ((status)::text = ANY (ARRAY[('paid'::character varying)::text, ('processing'::character varying)::text])));


--
-- Name: idx_ppo_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_queue ON public.photo_print_orders USING btree (queue_position) WHERE (((status)::text = ANY (ARRAY[('paid'::character varying)::text, ('processing'::character varying)::text])) AND ((payment_status)::text = 'paid'::text));


--
-- Name: idx_ppo_reminders; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_reminders ON public.photo_print_orders USING btree (created_at, reminder_sent_at) WHERE ((status)::text = ANY ((ARRAY['pending_payment'::character varying, 'payment_failed'::character varying])::text[]));


--
-- Name: idx_ppo_service_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_service_type ON public.photo_print_orders USING btree (service_type) WHERE (service_type IS NOT NULL);


--
-- Name: idx_ppo_service_uniform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_service_uniform ON public.photo_print_orders USING btree (service_type, uniform_type) WHERE (service_type IS NOT NULL);


--
-- Name: idx_ppo_session_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_session_created ON public.photo_print_orders USING btree (chat_session_id, created_at DESC) WHERE (chat_session_id IS NOT NULL);


--
-- Name: idx_ppo_shipment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_shipment_status ON public.photo_print_orders USING btree (shipment_status) WHERE ((shipment_status)::text <> 'none'::text);


--
-- Name: idx_ppo_telegram_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_telegram_user ON public.photo_print_orders USING btree (telegram_user_id);


--
-- Name: idx_ppo_tracking_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ppo_tracking_number ON public.photo_print_orders USING btree (tracking_number) WHERE (tracking_number IS NOT NULL);


--
-- Name: idx_pr_campaign_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_campaign_id ON public.promo_redemptions USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);


--
-- Name: idx_pr_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_customer_id ON public.promo_redemptions USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_pr_phone_promo_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pr_phone_promo_unique ON public.promo_redemptions USING btree (customer_phone, promo_code) WHERE ((status)::text = 'applied'::text);


--
-- Name: idx_pr_promo_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_promo_code ON public.promo_redemptions USING btree (promo_code);


--
-- Name: idx_pr_promotion_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_promotion_id ON public.promo_redemptions USING btree (promotion_id);


--
-- Name: idx_pr_redeemed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_redeemed_at ON public.promo_redemptions USING btree (redeemed_at DESC);


--
-- Name: idx_prd_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prd_scope ON public.product_reference_data USING gin (category_scope);


--
-- Name: idx_prd_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prd_type ON public.product_reference_data USING btree (ref_type);


--
-- Name: idx_prd_type_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prd_type_active ON public.product_reference_data USING btree (ref_type, is_active);


--
-- Name: idx_price_alerts_competitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_alerts_competitor ON public.kb_price_alerts USING btree (competitor_id);


--
-- Name: idx_price_alerts_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_alerts_unread ON public.kb_price_alerts USING btree (created_at DESC) WHERE (NOT is_read);


--
-- Name: idx_price_history_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_category ON public.kb_price_history USING btree (service_category, recorded_at DESC);


--
-- Name: idx_price_history_competitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_competitor ON public.kb_price_history USING btree (competitor_id, recorded_at DESC);


--
-- Name: idx_price_modifiers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_modifiers_active ON public.price_modifiers USING btree (is_active, modifier_type);


--
-- Name: idx_price_modifiers_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_modifiers_category ON public.price_modifiers USING btree (service_category_id);


--
-- Name: idx_price_modifiers_option; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_modifiers_option ON public.price_modifiers USING btree (service_option_id);


--
-- Name: idx_pricing_ai_suggestions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_ai_suggestions_created_at ON public.pricing_ai_suggestions USING btree (created_at DESC);


--
-- Name: idx_pricing_ai_suggestions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_ai_suggestions_status ON public.pricing_ai_suggestions USING btree (status);


--
-- Name: idx_pricing_snapshots_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_snapshots_date ON public.pricing_snapshots USING btree (created_at DESC);


--
-- Name: idx_pricing_snapshots_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pricing_snapshots_entity ON public.pricing_snapshots USING btree (entity_type, entity_id);


--
-- Name: idx_print_jobs_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_batch_id ON public.print_jobs USING btree (batch_id) WHERE (batch_id IS NOT NULL);


--
-- Name: idx_print_jobs_batch_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_batch_sequence ON public.print_jobs USING btree (batch_id, batch_sequence) WHERE (batch_id IS NOT NULL);


--
-- Name: idx_print_jobs_completed_archive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_completed_archive ON public.print_jobs USING btree (completed_at DESC) WHERE ((status)::text = ANY ((ARRAY['completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[]));


--
-- Name: idx_print_jobs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_created ON public.print_jobs USING btree (created_at DESC);


--
-- Name: idx_print_jobs_created_at_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_created_at_status ON public.print_jobs USING btree (created_at, status);


--
-- Name: idx_print_jobs_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_created_by ON public.print_jobs USING btree (created_by);


--
-- Name: idx_print_jobs_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_customer ON public.print_jobs USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_print_jobs_customer_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_customer_template ON public.print_jobs USING btree (customer_id, document_template_slug, created_at DESC) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_print_jobs_daily_stats; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_daily_stats ON public.print_jobs USING btree (created_at, studio_id, status);


--
-- Name: idx_print_jobs_document_tree; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_document_tree ON public.print_jobs USING btree (parent_job_id, page_number, document_template_slug) WHERE (parent_job_id IS NOT NULL);


--
-- Name: idx_print_jobs_face_validation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_face_validation_id ON public.print_jobs USING btree (face_validation_id) WHERE (face_validation_id IS NOT NULL);


--
-- Name: idx_print_jobs_failed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_failed ON public.print_jobs USING btree (status, created_at DESC) WHERE ((status)::text = 'failed'::text);


--
-- Name: idx_print_jobs_operator_stats; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_operator_stats ON public.print_jobs USING btree (created_by, status, price_total);


--
-- Name: idx_print_jobs_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_order_id ON public.print_jobs USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_print_jobs_order_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_order_type_created ON public.print_jobs USING btree (order_id, order_type, created_at DESC) WHERE (order_id IS NOT NULL);


--
-- Name: idx_print_jobs_original_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_original_job ON public.print_jobs USING btree (original_job_id) WHERE (original_job_id IS NOT NULL);


--
-- Name: idx_print_jobs_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_parent ON public.print_jobs USING btree (parent_job_id) WHERE (parent_job_id IS NOT NULL);


--
-- Name: idx_print_jobs_preset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_preset_id ON public.print_jobs USING btree (preset_id) WHERE (preset_id IS NOT NULL);


--
-- Name: idx_print_jobs_printer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_printer_status ON public.print_jobs USING btree (printer_id, status);


--
-- Name: idx_print_jobs_printer_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_printer_status_created ON public.print_jobs USING btree (printer_id, status, created_at DESC);


--
-- Name: idx_print_jobs_priority_queued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_priority_queued ON public.print_jobs USING btree (status, priority DESC, created_at) WHERE ((status)::text = ANY ((ARRAY['queued'::character varying, 'sending'::character varying])::text[]));


--
-- Name: idx_print_jobs_receipt_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_receipt_id ON public.print_jobs USING btree (receipt_id) WHERE (receipt_id IS NOT NULL);


--
-- Name: idx_print_jobs_revenue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_revenue ON public.print_jobs USING btree (created_at DESC, price_total) WHERE ((price_total IS NOT NULL) AND (price_total > (0)::numeric));


--
-- Name: idx_print_jobs_service_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_service_slug ON public.print_jobs USING btree (service_slug) WHERE (service_slug IS NOT NULL);


--
-- Name: idx_print_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_status ON public.print_jobs USING btree (status);


--
-- Name: idx_print_jobs_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_status_created ON public.print_jobs USING btree (status, created_at DESC);


--
-- Name: idx_print_jobs_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_studio ON public.print_jobs USING btree (studio_id);


--
-- Name: idx_print_jobs_studio_priority_queued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_studio_priority_queued ON public.print_jobs USING btree (studio_id, priority DESC, created_at) WHERE ((status)::text = ANY ((ARRAY['queued'::character varying, 'sending'::character varying])::text[]));


--
-- Name: idx_print_jobs_trace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_jobs_trace_id ON public.print_jobs USING btree (trace_id) WHERE (trace_id IS NOT NULL);


--
-- Name: idx_print_presets_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_presets_active ON public.print_presets USING btree (is_active) WHERE is_active;


--
-- Name: idx_print_presets_printer_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_presets_printer_type ON public.print_presets USING btree (printer_type);


--
-- Name: idx_print_presets_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_presets_slug ON public.print_presets USING btree (slug) WHERE (slug IS NOT NULL);


--
-- Name: idx_print_presets_studio_printer_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_presets_studio_printer_type ON public.print_presets USING btree (studio_id, printer_type);


--
-- Name: idx_print_speed_log_format; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_speed_log_format ON public.print_speed_log USING btree (format);


--
-- Name: idx_print_speed_log_printed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_speed_log_printed_at ON public.print_speed_log USING btree (printed_at DESC);


--
-- Name: idx_print_waste_log_printer_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_waste_log_printer_created ON public.print_waste_log USING btree (printer_id, created_at DESC);


--
-- Name: idx_print_waste_log_studio_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_waste_log_studio_created ON public.print_waste_log USING btree (studio_id, created_at DESC);


--
-- Name: idx_printing_houses_capabilities; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_printing_houses_capabilities ON public.printing_houses USING gin (capabilities);


--
-- Name: idx_printing_houses_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_printing_houses_status ON public.printing_houses USING btree (status);


--
-- Name: idx_product_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_categories_parent ON public.product_categories USING btree (parent_id);


--
-- Name: idx_product_stock_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_product_stock_unique ON public.product_stock USING btree (product_id, studio_id);


--
-- Name: idx_products_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active ON public.products USING btree (is_active);


--
-- Name: idx_products_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_barcode ON public.products USING btree (barcode) WHERE (barcode IS NOT NULL);


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.products USING btree (category_id);


--
-- Name: idx_products_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_products_code ON public.products USING btree (code) WHERE (code IS NOT NULL);


--
-- Name: idx_products_favorite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_favorite ON public.products USING btree (is_favorite) WHERE (is_favorite = true);


--
-- Name: idx_products_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_subscription ON public.products USING btree (is_subscription_eligible) WHERE (is_subscription_eligible = true);


--
-- Name: idx_products_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_type ON public.products USING btree (product_type);


--
-- Name: idx_promotions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotions_active ON public.promotions USING btree (is_active, sort_order, starts_at DESC);


--
-- Name: idx_promotions_promo_code_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_promotions_promo_code_unique ON public.promotions USING btree (upper((promo_code)::text)) WHERE ((promo_code IS NOT NULL) AND (is_active = true));


--
-- Name: idx_prt_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prt_user_id ON public.password_reset_tokens USING btree (user_id);


--
-- Name: idx_push_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions USING btree (user_id);


--
-- Name: idx_quick_replies_keywords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quick_replies_keywords ON public.chat_quick_replies USING gin (trigger_keywords);


--
-- Name: idx_rbac_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_audit_actor ON public.rbac_audit_log USING btree (actor_id);


--
-- Name: idx_rbac_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_audit_created ON public.rbac_audit_log USING btree (created_at DESC);


--
-- Name: idx_rbac_audit_target_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_audit_target_user ON public.rbac_audit_log USING btree (target_user_id);


--
-- Name: idx_rbac_permissions_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_permissions_module ON public.rbac_permissions USING btree (module);


--
-- Name: idx_rbac_rp_perm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_rp_perm ON public.rbac_role_permissions USING btree (permission_id);


--
-- Name: idx_rbac_rp_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_rp_role ON public.rbac_role_permissions USING btree (role_id);


--
-- Name: idx_rbac_upo_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_upo_expires ON public.rbac_user_overrides USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_rbac_upo_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rbac_upo_user ON public.rbac_user_overrides USING btree (user_id);


--
-- Name: idx_receipts_created_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipts_created_date ON public.pos_receipts USING btree (created_at DESC, total) WHERE (is_refund = false);


--
-- Name: idx_receipts_shift_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipts_shift_created ON public.pos_receipts USING btree (shift_id, created_at DESC);


--
-- Name: idx_refresh_tokens_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_expires_at ON public.refresh_tokens USING btree (expires_at);


--
-- Name: idx_refresh_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user_id ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_refund_requests_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refund_requests_order_id ON public.refund_requests USING btree (order_id);


--
-- Name: idx_refund_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refund_requests_status ON public.refund_requests USING btree (status);


--
-- Name: idx_refund_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refund_requests_user_id ON public.refund_requests USING btree (user_id);


--
-- Name: idx_replay_sessions_complete; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_replay_sessions_complete ON public.replay_sessions USING btree (is_complete, started_at DESC);


--
-- Name: idx_replay_sessions_fp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_replay_sessions_fp ON public.replay_sessions USING btree (fingerprint_visitor_id) WHERE (fingerprint_visitor_id IS NOT NULL);


--
-- Name: idx_replay_sessions_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_replay_sessions_started ON public.replay_sessions USING btree (started_at DESC);


--
-- Name: idx_replay_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_replay_sessions_user ON public.replay_sessions USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_replay_sessions_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_replay_sessions_visitor ON public.replay_sessions USING btree (visitor_id);


--
-- Name: idx_retouch_jobs_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retouch_jobs_session ON public.ai_retouch_jobs USING btree (approval_session_id);


--
-- Name: idx_retouch_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retouch_jobs_status ON public.ai_retouch_jobs USING btree (status);


--
-- Name: idx_review_platform_stats_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_platform_stats_platform ON public.review_platform_stats USING btree (platform);


--
-- Name: idx_review_req_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_req_order ON public.review_requests USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_review_req_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_req_pending ON public.review_requests USING btree (status, send_at) WHERE (status = 'pending'::text);


--
-- Name: idx_review_req_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_req_phone ON public.review_requests USING btree (client_phone) WHERE (client_phone IS NOT NULL);


--
-- Name: idx_review_req_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_req_session ON public.review_requests USING btree (chat_session_id) WHERE (chat_session_id IS NOT NULL);


--
-- Name: idx_review_requests_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_requests_employee ON public.review_requests USING btree (employee_id) WHERE (employee_id IS NOT NULL);


--
-- Name: idx_review_requests_nps; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_requests_nps ON public.review_requests USING btree (nps_rating) WHERE (nps_rating IS NOT NULL);


--
-- Name: idx_reviews_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_created_at ON public.reviews USING btree (created_at DESC);


--
-- Name: idx_reviews_photographer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_photographer_id ON public.reviews USING btree (photographer_id);


--
-- Name: idx_reviews_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_user_id ON public.reviews USING btree (user_id);


--
-- Name: idx_rollout_plans_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rollout_plans_release ON public.rollout_plans USING btree (release_id);


--
-- Name: idx_rollout_plans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rollout_plans_status ON public.rollout_plans USING btree (status) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying])::text[]));


--
-- Name: idx_schedule_requests_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_requests_created ON public.schedule_requests USING btree (created_at DESC);


--
-- Name: idx_schedule_requests_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_requests_employee ON public.schedule_requests USING btree (employee_id);


--
-- Name: idx_schedule_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_requests_status ON public.schedule_requests USING btree (status) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_scheduled_messages_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_messages_pending ON public.scheduled_messages USING btree (send_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_schedules_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_available ON public.schedules USING btree (is_available);


--
-- Name: idx_schedules_photographer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_photographer_id ON public.schedules USING btree (photographer_id);


--
-- Name: idx_schedules_year_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_year_month ON public.schedules USING btree (year, month);


--
-- Name: idx_scrape_logs_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scrape_logs_source ON public.kb_scrape_logs USING btree (source_slug, created_at DESC);


--
-- Name: idx_security_events_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_studio ON public.security_events USING btree (studio_id, created_at DESC);


--
-- Name: idx_security_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_type ON public.security_events USING btree (event_type, created_at DESC);


--
-- Name: idx_service_catalog_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_catalog_active ON public.service_catalog USING btree (is_active, sort_order);


--
-- Name: idx_service_categories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_categories_active ON public.service_categories USING btree (is_active, sort_order);


--
-- Name: idx_service_options_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_options_active ON public.service_options USING btree (is_active);


--
-- Name: idx_service_options_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_options_group ON public.service_options USING btree (option_group_id);


--
-- Name: idx_service_options_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_options_product ON public.service_options USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: idx_service_work_logs_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_work_logs_employee ON public.service_work_logs USING btree (employee_id);


--
-- Name: idx_service_work_logs_receipt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_work_logs_receipt ON public.service_work_logs USING btree (receipt_id) WHERE (receipt_id IS NOT NULL);


--
-- Name: idx_service_work_logs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_work_logs_started ON public.service_work_logs USING btree (started_at);


--
-- Name: idx_service_work_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_work_logs_status ON public.service_work_logs USING btree (status) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_session_tags_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_tags_session ON public.visitor_chat_session_tags USING btree (session_id);


--
-- Name: idx_session_tags_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_tags_tag ON public.visitor_chat_session_tags USING btree (tag_id);


--
-- Name: idx_shifts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_active ON public.employee_shifts USING btree (shift_date, status) WHERE ((status)::text = ANY (ARRAY[('scheduled'::character varying)::text, ('active'::character varying)::text]));


--
-- Name: employee_shifts_employee_id_shift_date_open_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_shifts_employee_id_shift_date_open_key ON public.employee_shifts USING btree (employee_id, shift_date) WHERE ((status)::text = ANY (ARRAY[('scheduled'::character varying)::text, ('active'::character varying)::text]));


--
-- Name: idx_shifts_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_date ON public.employee_shifts USING btree (shift_date);


--
-- Name: idx_shifts_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_employee ON public.employee_shifts USING btree (employee_id);


--
-- Name: idx_shifts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_status ON public.employee_shifts USING btree (status);


--
-- Name: idx_shifts_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_studio ON public.employee_shifts USING btree (studio_id);


--
-- Name: idx_shooting_locations_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shooting_locations_category ON public.shooting_locations USING btree (category);


--
-- Name: idx_spm_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_spm_default ON public.saved_payment_methods USING btree (user_id) WHERE (is_default = true);


--
-- Name: idx_spm_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spm_user ON public.saved_payment_methods USING btree (user_id);


--
-- Name: idx_staff_conversations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_conversations_active ON public.staff_conversations USING btree (deleted_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_staff_messages_conv_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_messages_conv_created ON public.staff_messages USING btree (conversation_id, created_at DESC);


--
-- Name: idx_staff_messages_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_messages_fts ON public.staff_messages USING gin (to_tsvector('russian'::regconfig, content));


--
-- Name: idx_staff_messages_not_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_messages_not_deleted ON public.staff_messages USING btree (conversation_id, created_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_staff_messages_reply; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_messages_reply ON public.staff_messages USING btree (reply_to_message_id) WHERE (reply_to_message_id IS NOT NULL);


--
-- Name: idx_staff_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_messages_sender ON public.staff_messages USING btree (sender_id);


--
-- Name: idx_staff_participants_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_participants_active ON public.staff_conversation_participants USING btree (conversation_id, user_id) WHERE (left_at IS NULL);


--
-- Name: idx_staff_participants_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_participants_conv ON public.staff_conversation_participants USING btree (conversation_id);


--
-- Name: idx_staff_participants_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_participants_user ON public.staff_conversation_participants USING btree (user_id);


--
-- Name: idx_studio_reviews_studio_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studio_reviews_studio_id ON public.studio_reviews USING btree (studio_id);


--
-- Name: idx_studio_reviews_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studio_reviews_user_id ON public.studio_reviews USING btree (user_id);


--
-- Name: idx_studio_working_hours_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studio_working_hours_studio ON public.studio_working_hours USING btree (studio_id);


--
-- Name: idx_studios_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studios_featured ON public.studios USING btree (is_featured);


--
-- Name: idx_studios_popular; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studios_popular ON public.studios USING btree (is_popular);


--
-- Name: idx_scc_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scc_active ON public.subscription_card_changes USING btree (status, updated_at) WHERE ((status)::text = ANY ((ARRAY['awaiting_token'::character varying, 'swapping'::character varying, 'pending_cancel_old'::character varying])::text[]));


--
-- Name: idx_sub_credits_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_credits_active ON public.subscription_credits USING btree (expires_at) WHERE (used_credits < total_credits);


--
-- Name: idx_sub_credits_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_credits_period ON public.subscription_credits USING btree (period_start, period_end);


--
-- Name: idx_sub_credits_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_credits_product ON public.subscription_credits USING btree (product_id);


--
-- Name: idx_sub_credits_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_credits_sub ON public.subscription_credits USING btree (subscription_id);


--
-- Name: idx_sub_offers_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_offers_employee ON public.subscription_offers USING btree (employee_id);


--
-- Name: idx_sub_offers_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_offers_session ON public.subscription_offers USING btree (chat_session_id);


--
-- Name: idx_sub_offers_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_offers_token ON public.subscription_offers USING btree (token) WHERE ((status)::text = ANY ((ARRAY['sent'::character varying, 'opened'::character varying])::text[]));


--
-- Name: idx_sub_plan_items_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_plan_items_plan ON public.subscription_plan_items USING btree (plan_id);


--
-- Name: idx_sub_plan_items_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_plan_items_product ON public.subscription_plan_items USING btree (product_id);


--
-- Name: idx_subscriptions_phone_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_phone_active ON public.user_subscriptions USING btree (phone) WHERE (((status)::text = 'active'::text) AND (phone IS NOT NULL));


--
-- Name: idx_system_telemetry_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_telemetry_agent ON public.system_telemetry USING btree (agent_id, collected_at DESC);


--
-- Name: idx_system_telemetry_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_telemetry_studio ON public.system_telemetry USING btree (studio_id, collected_at DESC);


--
-- Name: idx_task_links_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_links_a ON public.task_links USING btree (task_a_id);


--
-- Name: idx_task_links_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_links_b ON public.task_links USING btree (task_b_id);


--
-- Name: idx_task_links_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_links_type ON public.task_links USING btree (link_type);


--
-- Name: idx_tasks_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assigned ON public.work_tasks USING btree (assigned_to);


--
-- Name: idx_tasks_assigned_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assigned_to ON public.work_tasks USING btree (assigned_to, status) WHERE ((status)::text <> ALL (ARRAY[('completed'::character varying)::text, ('cancelled'::character varying)::text]));


--
-- Name: idx_tasks_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_booking ON public.work_tasks USING btree (booking_id) WHERE (booking_id IS NOT NULL);


--
-- Name: idx_tasks_chat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_chat ON public.work_tasks USING btree (chat_session_id) WHERE (chat_session_id IS NOT NULL);


--
-- Name: idx_tasks_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_created ON public.work_tasks USING btree (created_at DESC);


--
-- Name: idx_tasks_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_due ON public.work_tasks USING btree (due_date) WHERE (due_date IS NOT NULL);


--
-- Name: idx_tasks_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_number ON public.work_tasks USING btree (task_number);


--
-- Name: idx_tasks_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_open ON public.work_tasks USING btree (status, assigned_studio_id) WHERE ((status)::text = ANY (ARRAY[('open'::character varying)::text, ('assigned'::character varying)::text, ('in_progress'::character varying)::text, ('waiting'::character varying)::text]));


--
-- Name: idx_tasks_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_order ON public.work_tasks USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_tasks_print_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_print_order ON public.work_tasks USING btree (print_order_id) WHERE (print_order_id IS NOT NULL);


--
-- Name: idx_tasks_sla_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_sla_deadline ON public.work_tasks USING btree (sla_deadline) WHERE (sla_deadline IS NOT NULL);


--
-- Name: idx_tasks_status_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_status_priority ON public.work_tasks USING btree (status, priority, due_date, created_at DESC) WHERE ((status)::text <> ALL (ARRAY[('completed'::character varying)::text, ('cancelled'::character varying)::text]));


--
-- Name: idx_tasks_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_studio ON public.work_tasks USING btree (assigned_studio_id);


--
-- Name: idx_tasks_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_type ON public.work_tasks USING btree (task_type);


--
-- Name: idx_tasks_unified_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_unified_customer ON public.work_tasks USING btree (unified_customer_id) WHERE (unified_customer_id IS NOT NULL);


--
-- Name: idx_telegram_auth_tokens_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telegram_auth_tokens_status ON public.telegram_auth_tokens USING btree (status);


--
-- Name: idx_telemetry_collected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_collected ON public.printer_telemetry USING btree (collected_at DESC);


--
-- Name: idx_telemetry_printer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_printer ON public.printer_telemetry USING btree (printer_id, collected_at DESC);


--
-- Name: idx_telemetry_studio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_studio ON public.printer_telemetry USING btree (studio_id);


--
-- Name: idx_tg_users_visitor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tg_users_visitor_id ON public.telegram_users USING btree (visitor_id);


--
-- Name: idx_upsell_bonuses_employee_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_upsell_bonuses_employee_period ON public.employee_upsell_bonuses USING btree (employee_id, period);


--
-- Name: idx_upsell_bonuses_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_upsell_bonuses_status ON public.employee_upsell_bonuses USING btree (status) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_upsell_offers_employee_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_upsell_offers_employee_shift ON public.employee_upsell_offers USING btree (employee_id, shift_date);


--
-- Name: idx_user_settings_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_settings_type ON public.user_settings USING btree (setting_type);


--
-- Name: idx_user_settings_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_settings_user_id ON public.user_settings USING btree (user_id);


--
-- Name: idx_user_subs_next_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subs_next_payment ON public.user_subscriptions USING btree (next_payment_date) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_user_subs_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subs_phone ON public.user_subscriptions USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: idx_user_subs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subs_status ON public.user_subscriptions USING btree (status);


--
-- Name: idx_user_subs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_subs_user ON public.user_subscriptions USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active ON public.users USING btree (is_active);


--
-- Name: idx_users_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_last_seen ON public.users USING btree (last_seen_at DESC NULLS LAST) WHERE ((role)::text = ANY ((ARRAY['admin'::character varying, 'manager'::character varying, 'employee'::character varying, 'photographer'::character varying])::text[]));


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone ON public.users USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: idx_users_phone_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone_normalized ON public.users USING btree ("right"(regexp_replace((phone)::text, '\D'::text, ''::text, 'g'::text), 10)) WHERE (phone IS NOT NULL);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_vcm_client_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vcm_client_message_id ON public.visitor_chat_messages USING btree (client_message_id) WHERE (client_message_id IS NOT NULL);


--
-- Name: idx_vcm_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcm_delivery ON public.visitor_chat_messages USING btree (session_id, sender_type, delivered_at, read_at) WHERE ((sender_type)::text = 'operator'::text);


--
-- Name: idx_vcm_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcm_event_type ON public.visitor_chat_messages USING btree (session_id, event_type, created_at DESC) WHERE (event_type IS NOT NULL);


--
-- Name: idx_vcm_external_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vcm_external_message_id ON public.visitor_chat_messages USING btree (external_message_id) WHERE (external_message_id IS NOT NULL);


--
-- Name: idx_vcm_reply_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcm_reply_to ON public.visitor_chat_messages USING btree (reply_to_message_id) WHERE (reply_to_message_id IS NOT NULL);


--
-- Name: idx_vcm_session_cursor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcm_session_cursor ON public.visitor_chat_messages USING btree (session_id, created_at DESC, id DESC);


--
-- Name: idx_vcm_undelivered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcm_undelivered ON public.visitor_chat_messages USING btree (id) WHERE ((delivered_at IS NULL) AND ((sender_type)::text = 'operator'::text));


--
-- Name: idx_vcs_archive_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcs_archive_candidates ON public.visitor_chat_sessions USING btree (COALESCE(resolved_at, updated_at, created_at)) WHERE ((status)::text = 'closed'::text);


--
-- Name: idx_vcs_booking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcs_booking_id ON public.visitor_chat_sessions USING btree (booking_id) WHERE (booking_id IS NOT NULL);


--
-- Name: idx_vcs_channel_ext_chat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcs_channel_ext_chat_id ON public.visitor_chat_sessions USING btree (channel, ((metadata ->> 'externalChatId'::text))) WHERE ((status)::text <> 'closed'::text);


--
-- Name: idx_vcs_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcs_contact ON public.visitor_chat_sessions USING btree (contact_id) WHERE (contact_id IS NOT NULL);


--
-- Name: idx_vcs_csat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcs_csat ON public.visitor_chat_sessions USING btree (csat_score) WHERE (csat_score IS NOT NULL);


--
-- Name: idx_vcs_status_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcs_status_last_message ON public.visitor_chat_sessions USING btree (status, last_message_at DESC NULLS LAST) WHERE ((status)::text = ANY (ARRAY[('open'::character varying)::text, ('waiting'::character varying)::text, ('active'::character varying)::text]));


--
-- Name: idx_vcs_user_id_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcs_user_id_status ON public.visitor_chat_sessions USING btree (user_id, status) WHERE (user_id IS NOT NULL);


--
-- Name: idx_vcs_visitor_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vcs_visitor_phone ON public.visitor_chat_sessions USING btree (visitor_phone) WHERE (visitor_phone IS NOT NULL);


--
-- Name: idx_verification_codes_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_expires ON public.verification_codes USING btree (expires_at) WHERE (used_at IS NULL);


--
-- Name: idx_verification_codes_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_phone ON public.verification_codes USING btree (phone, purpose) WHERE (used_at IS NULL);


--
-- Name: idx_verification_codes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_codes_user ON public.verification_codes USING btree (user_id) WHERE (used_at IS NULL);


--
-- Name: idx_visitor_chat_cart_items_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_chat_cart_items_session ON public.visitor_chat_cart_items USING btree (session_id);


--
-- Name: idx_visitor_chat_cart_items_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_chat_cart_items_updated_at ON public.visitor_chat_cart_items USING btree (updated_at DESC);


--
-- Name: idx_visitor_chat_messages_session_timeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_chat_messages_session_timeline ON public.visitor_chat_messages USING btree (session_id, created_at DESC);


--
-- Name: idx_visitor_chat_sessions_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_chat_sessions_channel ON public.visitor_chat_sessions USING btree (channel);


--
-- Name: idx_visitor_chat_sessions_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_chat_sessions_source ON public.visitor_chat_sessions USING btree (source);


--
-- Name: idx_visitor_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_messages_created ON public.visitor_chat_messages USING btree (created_at);


--
-- Name: idx_visitor_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_messages_session ON public.visitor_chat_messages USING btree (session_id);


--
-- Name: idx_visitor_push_endpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_push_endpoint ON public.visitor_push_subscriptions USING btree (endpoint);


--
-- Name: idx_visitor_push_fcm_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_push_fcm_token ON public.visitor_push_subscriptions USING btree (fcm_token) WHERE (fcm_token IS NOT NULL);


--
-- Name: idx_visitor_push_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_push_platform ON public.visitor_push_subscriptions USING btree (platform);


--
-- Name: idx_visitor_push_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_push_session ON public.visitor_push_subscriptions USING btree (session_id);


--
-- Name: idx_visitor_push_session_fcm; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_visitor_push_session_fcm ON public.visitor_push_subscriptions USING btree (session_id, fcm_token) WHERE (fcm_token IS NOT NULL);


--
-- Name: idx_visitor_push_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_push_visitor ON public.visitor_push_subscriptions USING btree (visitor_id);


--
-- Name: idx_visitor_sessions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_sessions_created ON public.visitor_chat_sessions USING btree (created_at DESC);


--
-- Name: idx_visitor_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_sessions_status ON public.visitor_chat_sessions USING btree (status);


--
-- Name: idx_visitor_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_sessions_user_id ON public.visitor_chat_sessions USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_visitor_sessions_visitor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visitor_sessions_visitor_id ON public.visitor_chat_sessions USING btree (visitor_id);


--
-- Name: idx_webhook_events_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_channel ON public.webhook_events USING btree (channel, created_at DESC);


--
-- Name: idx_webhook_events_channel_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_channel_received ON public.webhook_events USING btree (channel, received_at DESC);


--
-- Name: idx_webhook_events_channel_status_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_channel_status_received ON public.webhook_events USING btree (channel, status, received_at DESC);


--
-- Name: idx_webhook_events_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_webhook_events_idempotency ON public.webhook_events USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_webhook_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_status ON public.webhook_events USING btree (status) WHERE ((status)::text <> 'processed'::text);


--
-- Name: idx_webhook_idem_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_idem_created ON public.webhook_idempotency USING btree (created_at);


--
-- Name: idx_webhook_idem_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_idem_order ON public.webhook_idempotency USING btree (order_id);


--
-- Name: idx_webhook_idem_ttl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_idem_ttl ON public.webhook_idempotency USING btree (created_at);


--
-- Name: idx_work_tasks_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_tasks_priority ON public.work_tasks USING btree (priority);


--
-- Name: idx_work_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_tasks_status ON public.work_tasks USING btree (status);


--
-- Name: idx_workflow_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_status ON public.workflow_runs USING btree (status, scheduled_at) WHERE ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('running'::character varying)::text]));


--
-- Name: idx_workflow_runs_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_runs_workflow ON public.workflow_runs USING btree (workflow_id, created_at DESC);


--
-- Name: idx_workflows_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_trigger ON public.workflows USING btree (trigger_type, is_active);


--
-- Name: uq_order_assignment_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_order_assignment_active ON public.order_assignments USING btree (order_id, order_type) WHERE ((status)::text <> ALL (ARRAY[('completed'::character varying)::text, ('cancelled'::character varying)::text]));


--
-- Name: uq_price_modifiers_name_category; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_price_modifiers_name_category ON public.price_modifiers USING btree (name, service_category_id) WHERE (service_category_id IS NOT NULL);


--
-- Name: uq_price_modifiers_name_option; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_price_modifiers_name_option ON public.price_modifiers USING btree (name, service_option_id) WHERE (service_option_id IS NOT NULL);


--
-- Name: uq_products_name_category; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_products_name_category ON public.products USING btree (name, category_id);


--
-- Name: uq_scc_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_scc_idem ON public.subscription_card_changes USING btree (idempotency_key);


--
-- Name: uq_scc_open_per_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_scc_open_per_sub ON public.subscription_card_changes USING btree (subscription_id) WHERE ((status)::text = ANY ((ARRAY['awaiting_token'::character varying, 'swapping'::character varying, 'pending_cancel_old'::character varying])::text[]));


--
-- Name: uq_user_subs_active_cp; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_subs_active_cp ON public.user_subscriptions USING btree (cloudpayments_subscription_id) WHERE ((cloudpayments_subscription_id IS NOT NULL) AND ((status)::text = ANY ((ARRAY['active'::character varying, 'paused'::character varying])::text[])));


--
-- Name: users_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_unique ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: visitor_chat_messages_archive_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_messages_archive_created_at_idx ON public.visitor_chat_messages_archive USING btree (created_at);


--
-- Name: visitor_chat_messages_archive_external_message_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX visitor_chat_messages_archive_external_message_id_idx ON public.visitor_chat_messages_archive USING btree (external_message_id) WHERE (external_message_id IS NOT NULL);


--
-- Name: visitor_chat_messages_archive_session_id_created_at_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_messages_archive_session_id_created_at_id_idx ON public.visitor_chat_messages_archive USING btree (session_id, created_at DESC, id DESC);


--
-- Name: visitor_chat_messages_archive_session_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_messages_archive_session_id_created_at_idx ON public.visitor_chat_messages_archive USING btree (session_id, created_at DESC);


--
-- Name: visitor_chat_messages_archive_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_messages_archive_session_id_idx ON public.visitor_chat_messages_archive USING btree (session_id);


--
-- Name: visitor_chat_messages_archive_session_id_sender_type_delive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_messages_archive_session_id_sender_type_delive_idx ON public.visitor_chat_messages_archive USING btree (session_id, sender_type, delivered_at, read_at) WHERE ((sender_type)::text = 'operator'::text);


--
-- Name: visitor_chat_sessions_archive_channel_expr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_channel_expr_idx ON public.visitor_chat_sessions_archive USING btree (channel, ((metadata ->> 'externalChatId'::text))) WHERE ((status)::text <> 'closed'::text);


--
-- Name: visitor_chat_sessions_archive_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_channel_idx ON public.visitor_chat_sessions_archive USING btree (channel);


--
-- Name: visitor_chat_sessions_archive_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_created_at_idx ON public.visitor_chat_sessions_archive USING btree (created_at DESC);


--
-- Name: visitor_chat_sessions_archive_csat_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_csat_score_idx ON public.visitor_chat_sessions_archive USING btree (csat_score) WHERE (csat_score IS NOT NULL);


--
-- Name: visitor_chat_sessions_archive_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_source_idx ON public.visitor_chat_sessions_archive USING btree (source);


--
-- Name: visitor_chat_sessions_archive_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_status_idx ON public.visitor_chat_sessions_archive USING btree (status);


--
-- Name: visitor_chat_sessions_archive_status_last_message_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_status_last_message_at_idx ON public.visitor_chat_sessions_archive USING btree (status, last_message_at DESC NULLS LAST) WHERE ((status)::text = ANY (ARRAY[('open'::character varying)::text, ('waiting'::character varying)::text, ('active'::character varying)::text]));


--
-- Name: visitor_chat_sessions_archive_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_user_id_idx ON public.visitor_chat_sessions_archive USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: visitor_chat_sessions_archive_visitor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_visitor_id_idx ON public.visitor_chat_sessions_archive USING btree (visitor_id);


--
-- Name: visitor_chat_sessions_archive_visitor_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visitor_chat_sessions_archive_visitor_phone_idx ON public.visitor_chat_sessions_archive USING btree (visitor_phone) WHERE (visitor_phone IS NOT NULL);


--
-- Name: gallery_photos gallery_photos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gallery_photos_updated_at BEFORE UPDATE ON public.gallery_photos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: marketing_campaigns marketing_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER marketing_campaigns_updated_at BEFORE UPDATE ON public.marketing_campaigns FOR EACH ROW EXECUTE FUNCTION public.trg_marketing_campaigns_updated_at();


--
-- Name: agents trg_agents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.update_agents_updated_at();


--
-- Name: visitor_chat_messages trg_chat_msg_after_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_msg_after_delete AFTER DELETE ON public.visitor_chat_messages FOR EACH ROW EXECUTE FUNCTION public.trg_chat_msg_delete();


--
-- Name: visitor_chat_messages trg_chat_msg_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chat_msg_after_insert AFTER INSERT ON public.visitor_chat_messages FOR EACH ROW EXECUTE FUNCTION public.trg_chat_msg_insert();


--
-- Name: conversations trg_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_conversations_updated_at();


--
-- Name: conversion_tasks trg_conversion_tasks_new; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_conversion_tasks_new AFTER INSERT ON public.conversion_tasks FOR EACH ROW WHEN (((new.status)::text = 'pending'::text)) EXECUTE FUNCTION public.notify_conversion_task_new();


--
-- Name: customers trg_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_customers_updated_at();


--
-- Name: kb_categories trg_kb_categories_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kb_categories_timestamp BEFORE UPDATE ON public.kb_categories FOR EACH ROW EXECUTE FUNCTION public.kb_update_timestamp();


--
-- Name: kb_data_sources trg_kb_data_sources_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kb_data_sources_timestamp BEFORE UPDATE ON public.kb_data_sources FOR EACH ROW EXECUTE FUNCTION public.kb_update_timestamp();


--
-- Name: kb_entities trg_kb_entities_category_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kb_entities_category_count AFTER INSERT OR DELETE OR UPDATE OF category_id ON public.kb_entities FOR EACH ROW EXECUTE FUNCTION public.kb_update_category_count();


--
-- Name: kb_entities trg_kb_entities_search; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kb_entities_search BEFORE INSERT OR UPDATE OF name, summary, content, tags ON public.kb_entities FOR EACH ROW EXECUTE FUNCTION public.kb_update_search_vector();


--
-- Name: kb_entities trg_kb_entities_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kb_entities_timestamp BEFORE UPDATE ON public.kb_entities FOR EACH ROW EXECUTE FUNCTION public.kb_update_timestamp();


--
-- Name: kb_entities trg_kb_entities_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kb_entities_version BEFORE UPDATE ON public.kb_entities FOR EACH ROW EXECUTE FUNCTION public.kb_create_version();


--
-- Name: messages trg_message_counters; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_message_counters AFTER INSERT OR DELETE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.update_conversation_counters();


--
-- Name: order_assignments trg_order_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_assignments_updated_at BEFORE UPDATE ON public.order_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: outbound_queue trg_outbound_queue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_outbound_queue_updated_at BEFORE UPDATE ON public.outbound_queue FOR EACH ROW EXECUTE FUNCTION public.update_outbound_queue_updated_at();


--
-- Name: partner_commission_rules trg_partner_commission_rules_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_partner_commission_rules_updated BEFORE UPDATE ON public.partner_commission_rules FOR EACH ROW EXECUTE FUNCTION public.update_partner_commission_rules_updated_at();


--
-- Name: pos_transactions trg_pos_transaction_new; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pos_transaction_new AFTER INSERT ON public.pos_transactions FOR EACH ROW EXECUTE FUNCTION public.notify_pos_transaction_new();


--
-- Name: print_jobs trg_print_jobs_all_done; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_print_jobs_all_done AFTER UPDATE OF status ON public.print_jobs FOR EACH ROW WHEN ((((new.status)::text = ANY ((ARRAY['completed'::character varying, 'cancelled'::character varying])::text[])) AND ((old.status)::text IS DISTINCT FROM (new.status)::text))) EXECUTE FUNCTION public.on_print_jobs_all_done();


--
-- Name: print_jobs trg_print_jobs_new; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_print_jobs_new AFTER INSERT ON public.print_jobs FOR EACH ROW WHEN (((new.status)::text = 'queued'::text)) EXECUTE FUNCTION public.notify_print_job_new();


--
-- Name: print_jobs trg_print_jobs_retry; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_print_jobs_retry AFTER UPDATE ON public.print_jobs FOR EACH ROW EXECUTE FUNCTION public.notify_print_job_retry();


--
-- Name: schedule_requests trg_schedule_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_requests_updated_at BEFORE UPDATE ON public.schedule_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: service_work_logs trg_service_work_logs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_service_work_logs_updated_at BEFORE UPDATE ON public.service_work_logs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pos_fiscal_settings trg_pos_fiscal_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pos_fiscal_settings_updated_at BEFORE UPDATE ON public.pos_fiscal_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: kb_source_links trg_source_links_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_source_links_count AFTER INSERT OR DELETE ON public.kb_source_links FOR EACH ROW EXECUTE FUNCTION public.kb_update_source_entity_count();


--
-- Name: users trg_staff_chat_auto_leave; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_staff_chat_auto_leave AFTER UPDATE OF is_active ON public.users FOR EACH ROW WHEN ((old.is_active IS DISTINCT FROM new.is_active)) EXECUTE FUNCTION public.staff_chat_auto_leave_on_deactivation();


--
-- Name: staff_messages trg_staff_message_update_conv; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_staff_message_update_conv AFTER INSERT ON public.staff_messages FOR EACH ROW EXECUTE FUNCTION public.update_staff_conv_last_message();


--
-- Name: visitor_chat_cart_items trg_visitor_chat_cart_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_visitor_chat_cart_items_updated_at BEFORE UPDATE ON public.visitor_chat_cart_items FOR EACH ROW EXECUTE FUNCTION public.set_visitor_chat_cart_items_updated_at();


--
-- Name: feature_flags trigger_feature_flags_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_feature_flags_updated_at BEFORE UPDATE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: mobile_push_tokens trigger_mobile_push_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_mobile_push_tokens_updated_at BEFORE UPDATE ON public.mobile_push_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: visitor_chat_messages trigger_new_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_new_message AFTER INSERT ON public.visitor_chat_messages FOR EACH ROW EXECUTE FUNCTION public.update_session_last_message();


--
-- Name: visitor_push_subscriptions trigger_visitor_push_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_visitor_push_updated BEFORE UPDATE ON public.visitor_push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_visitor_push_timestamp();


--
-- Name: visitor_chat_sessions trigger_visitor_session_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_visitor_session_updated BEFORE UPDATE ON public.visitor_chat_sessions FOR EACH ROW EXECUTE FUNCTION public.update_visitor_session_timestamp();


--
-- Name: bookings update_bookings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: employee_shifts update_employee_shifts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_employee_shifts_updated_at BEFORE UPDATE ON public.employee_shifts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: notifications update_notifications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: orders update_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: permissions update_permissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_permissions_updated_at BEFORE UPDATE ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: photo_approvals update_photo_approvals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_photo_approvals_updated_at BEFORE UPDATE ON public.photo_approvals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: photo_print_orders update_photo_print_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_photo_print_orders_updated_at BEFORE UPDATE ON public.photo_print_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: photo_selections update_photo_selections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_photo_selections_updated_at BEFORE UPDATE ON public.photo_selections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: photo_sessions update_photo_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_photo_sessions_updated_at BEFORE UPDATE ON public.photo_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reviews update_photographer_rating_on_review_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_photographer_rating_on_review_delete AFTER DELETE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_photographer_rating();


--
-- Name: reviews update_photographer_rating_on_review_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_photographer_rating_on_review_insert AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_photographer_rating();


--
-- Name: reviews update_photographer_rating_on_review_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_photographer_rating_on_review_update AFTER UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_photographer_rating();


--
-- Name: photographer_services update_photographer_services_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_photographer_services_updated_at BEFORE UPDATE ON public.photographer_services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: photographers update_photographers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_photographers_updated_at BEFORE UPDATE ON public.photographers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: printing_house_products update_php_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_php_updated_at BEFORE UPDATE ON public.printing_house_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: printing_houses update_printing_houses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_printing_houses_updated_at BEFORE UPDATE ON public.printing_houses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: production_orders update_production_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_production_orders_updated_at BEFORE UPDATE ON public.production_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reviews update_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: schedules update_schedules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON public.schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: shooting_locations update_shooting_locations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_shooting_locations_updated_at BEFORE UPDATE ON public.shooting_locations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: studio_reviews update_studio_rating_on_review_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_studio_rating_on_review_delete AFTER DELETE ON public.studio_reviews FOR EACH ROW EXECUTE FUNCTION public.update_studio_rating();


--
-- Name: studio_reviews update_studio_rating_on_review_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_studio_rating_on_review_insert AFTER INSERT ON public.studio_reviews FOR EACH ROW EXECUTE FUNCTION public.update_studio_rating();


--
-- Name: studio_reviews update_studio_rating_on_review_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_studio_rating_on_review_update AFTER UPDATE ON public.studio_reviews FOR EACH ROW EXECUTE FUNCTION public.update_studio_rating();


--
-- Name: studio_reviews update_studio_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_studio_reviews_updated_at BEFORE UPDATE ON public.studio_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: studios update_studios_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_studios_updated_at BEFORE UPDATE ON public.studios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_settings update_user_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: work_tasks update_work_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_work_tasks_updated_at BEFORE UPDATE ON public.work_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: agent_releases agent_releases_released_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_releases
    ADD CONSTRAINT agent_releases_released_by_fkey FOREIGN KEY (released_by) REFERENCES public.users(id);


--
-- Name: agent_update_commands agent_update_commands_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_update_commands
    ADD CONSTRAINT agent_update_commands_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: agent_update_commands agent_update_commands_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_update_commands
    ADD CONSTRAINT agent_update_commands_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: agent_update_commands agent_update_commands_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_update_commands
    ADD CONSTRAINT agent_update_commands_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.agent_releases(id);


--
-- Name: agent_update_commands agent_update_commands_rollout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_update_commands
    ADD CONSTRAINT agent_update_commands_rollout_id_fkey FOREIGN KEY (rollout_id) REFERENCES public.rollout_plans(id);


--
-- Name: agents agents_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: ai_retouch_jobs ai_retouch_jobs_approval_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_retouch_jobs
    ADD CONSTRAINT ai_retouch_jobs_approval_session_id_fkey FOREIGN KEY (approval_session_id) REFERENCES public.photo_approval_sessions(id) ON DELETE CASCADE;


--
-- Name: ai_retouch_jobs ai_retouch_jobs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_retouch_jobs
    ADD CONSTRAINT ai_retouch_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: ai_retouch_jobs ai_retouch_jobs_result_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_retouch_jobs
    ADD CONSTRAINT ai_retouch_jobs_result_photo_id_fkey FOREIGN KEY (result_photo_id) REFERENCES public.photo_approvals(id) ON DELETE SET NULL;


--
-- Name: ai_retouch_jobs ai_retouch_jobs_source_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_retouch_jobs
    ADD CONSTRAINT ai_retouch_jobs_source_photo_id_fkey FOREIGN KEY (source_photo_id) REFERENCES public.photo_approvals(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: behavior_events behavior_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.behavior_events
    ADD CONSTRAINT behavior_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.replay_sessions(id) ON DELETE CASCADE;


--
-- Name: booking_status_history booking_status_history_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_status_history booking_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id);


--
-- Name: bridge_devices bridge_devices_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bridge_devices
    ADD CONSTRAINT bridge_devices_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE SET NULL;


--
-- Name: broadcast_log broadcast_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_log
    ADD CONSTRAINT broadcast_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: call_entity_links call_entity_links_call_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_entity_links
    ADD CONSTRAINT call_entity_links_call_log_id_fkey FOREIGN KEY (call_log_id) REFERENCES public.call_logs(id) ON DELETE CASCADE;


--
-- Name: call_logs call_logs_client_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_client_user_id_fkey FOREIGN KEY (client_user_id) REFERENCES public.users(id);


--
-- Name: call_logs call_logs_operator_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_operator_user_id_fkey FOREIGN KEY (operator_user_id) REFERENCES public.users(id);


--
-- Name: cameras cameras_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: cameras cameras_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: campaign_promo_codes campaign_promo_codes_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_promo_codes
    ADD CONSTRAINT campaign_promo_codes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_promo_codes campaign_promo_codes_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_promo_codes
    ADD CONSTRAINT campaign_promo_codes_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE;


--
-- Name: cdr_stats cdr_stats_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cdr_stats
    ADD CONSTRAINT cdr_stats_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: channel_users channel_users_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_users
    ADD CONSTRAINT channel_users_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: channel_users channel_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_users
    ADD CONSTRAINT channel_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: chat_followups chat_followups_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_followups
    ADD CONSTRAINT chat_followups_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.users(id);


--
-- Name: chat_followups chat_followups_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_followups
    ADD CONSTRAINT chat_followups_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.visitor_chat_sessions(id) ON DELETE CASCADE;


--
-- Name: chat_task_links chat_task_links_chat_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_task_links
    ADD CONSTRAINT chat_task_links_chat_session_id_fkey FOREIGN KEY (chat_session_id) REFERENCES public.visitor_chat_sessions(id) ON DELETE SET NULL;


--
-- Name: chat_task_links chat_task_links_linked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_task_links
    ADD CONSTRAINT chat_task_links_linked_by_fkey FOREIGN KEY (linked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: chat_task_links chat_task_links_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_task_links
    ADD CONSTRAINT chat_task_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.work_tasks(id) ON DELETE CASCADE;


--
-- Name: client_notes client_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: combo_package_items combo_package_items_combo_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_package_items
    ADD CONSTRAINT combo_package_items_combo_package_id_fkey FOREIGN KEY (combo_package_id) REFERENCES public.combo_packages(id) ON DELETE CASCADE;


--
-- Name: combo_package_items combo_package_items_service_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_package_items
    ADD CONSTRAINT combo_package_items_service_option_id_fkey FOREIGN KEY (service_option_id) REFERENCES public.service_options(id) ON DELETE RESTRICT;


--
-- Name: consumable_rules consumable_rules_product_stock_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_rules
    ADD CONSTRAINT consumable_rules_product_stock_id_fkey FOREIGN KEY (product_stock_id) REFERENCES public.product_stock(id) ON DELETE CASCADE;


--
-- Name: consumable_rules consumable_rules_service_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_rules
    ADD CONSTRAINT consumable_rules_service_option_id_fkey FOREIGN KEY (service_option_id) REFERENCES public.service_options(id) ON DELETE CASCADE;


--
-- Name: consumable_stock consumable_stock_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_stock
    ADD CONSTRAINT consumable_stock_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.bridge_devices(id) ON DELETE CASCADE;


--
-- Name: consumable_transactions consumable_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_transactions
    ADD CONSTRAINT consumable_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: consumable_transactions consumable_transactions_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_transactions
    ADD CONSTRAINT consumable_transactions_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.print_jobs(id) ON DELETE SET NULL;


--
-- Name: consumable_transactions consumable_transactions_stock_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_transactions
    ADD CONSTRAINT consumable_transactions_stock_id_fkey FOREIGN KEY (stock_id) REFERENCES public.consumable_stock(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: conversation_tags conversation_tags_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_tags
    ADD CONSTRAINT conversation_tags_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.channel_accounts(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_assigned_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_assigned_operator_id_fkey FOREIGN KEY (assigned_operator_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: conversion_tasks conversion_tasks_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversion_tasks
    ADD CONSTRAINT conversion_tasks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.print_jobs(id) ON DELETE CASCADE;


--
-- Name: crm_files crm_files_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_files
    ADD CONSTRAINT crm_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: crm_notes crm_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_notes
    ADD CONSTRAINT crm_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: customer_tag_assignments customer_tag_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tag_assignments
    ADD CONSTRAINT customer_tag_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: customer_tag_assignments customer_tag_assignments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tag_assignments
    ADD CONSTRAINT customer_tag_assignments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: customer_tag_assignments customer_tag_assignments_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tag_assignments
    ADD CONSTRAINT customer_tag_assignments_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.customer_tags(id) ON DELETE CASCADE;


--
-- Name: design_templates design_templates_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.design_templates
    ADD CONSTRAINT design_templates_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.service_catalog(id) ON DELETE SET NULL;


--
-- Name: dynamic_pricing_config dynamic_pricing_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_pricing_config
    ADD CONSTRAINT dynamic_pricing_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: email_attachments email_attachments_crm_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_crm_file_id_fkey FOREIGN KEY (crm_file_id) REFERENCES public.crm_files(id) ON DELETE SET NULL;


--
-- Name: email_attachments email_attachments_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;


--
-- Name: email_messages email_messages_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id);


--
-- Name: email_templates email_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_commission_payouts employee_commission_payouts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_payouts
    ADD CONSTRAINT employee_commission_payouts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: employee_commission_payouts employee_commission_payouts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_payouts
    ADD CONSTRAINT employee_commission_payouts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: employee_commission_rules employee_commission_rules_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_commission_rules
    ADD CONSTRAINT employee_commission_rules_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: employee_compensation employee_compensation_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_compensation
    ADD CONSTRAINT employee_compensation_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_compensation employee_compensation_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_compensation
    ADD CONSTRAINT employee_compensation_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_daily_quests employee_daily_quests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_daily_quests
    ADD CONSTRAINT employee_daily_quests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_favorites employee_favorites_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_favorites
    ADD CONSTRAINT employee_favorites_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_favorites employee_favorites_service_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_favorites
    ADD CONSTRAINT employee_favorites_service_option_id_fkey FOREIGN KEY (service_option_id) REFERENCES public.service_options(id) ON DELETE CASCADE;


--
-- Name: employee_manual_revenue employee_manual_revenue_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_manual_revenue
    ADD CONSTRAINT employee_manual_revenue_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: employee_manual_revenue employee_manual_revenue_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_manual_revenue
    ADD CONSTRAINT employee_manual_revenue_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: employee_push_subscriptions employee_push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_push_subscriptions
    ADD CONSTRAINT employee_push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_sales employee_sales_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales
    ADD CONSTRAINT employee_sales_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: employee_sales employee_sales_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_sales
    ADD CONSTRAINT employee_sales_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.pos_receipts(id) ON DELETE CASCADE;


--
-- Name: employee_shifts employee_shifts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_shifts employee_shifts_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_shifts
    ADD CONSTRAINT employee_shifts_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: employee_tax_deductions employee_tax_deductions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_tax_deductions
    ADD CONSTRAINT employee_tax_deductions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: employee_tax_deductions employee_tax_deductions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_tax_deductions
    ADD CONSTRAINT employee_tax_deductions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_unlocked_achievements employee_unlocked_achievements_achievement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_unlocked_achievements
    ADD CONSTRAINT employee_unlocked_achievements_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.employee_achievements(id) ON DELETE CASCADE;


--
-- Name: employee_unlocked_achievements employee_unlocked_achievements_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_unlocked_achievements
    ADD CONSTRAINT employee_unlocked_achievements_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: employee_upsell_bonuses employee_upsell_bonuses_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_upsell_bonuses
    ADD CONSTRAINT employee_upsell_bonuses_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: employee_upsell_offers employee_upsell_offers_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_upsell_offers
    ADD CONSTRAINT employee_upsell_offers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: employee_upsell_offers employee_upsell_offers_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_upsell_offers
    ADD CONSTRAINT employee_upsell_offers_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: employee_xp_log employee_xp_log_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_xp_log
    ADD CONSTRAINT employee_xp_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: face_validations face_validations_photo_approval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_validations
    ADD CONSTRAINT face_validations_photo_approval_id_fkey FOREIGN KEY (photo_approval_id) REFERENCES public.photo_approvals(id) ON DELETE CASCADE;


--
-- Name: face_validations face_validations_validated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_validations
    ADD CONSTRAINT face_validations_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: files files_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bookings fk_bookings_service_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT fk_bookings_service_category FOREIGN KEY (service_category_slug) REFERENCES public.service_categories(slug) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: loyalty_profiles fk_loyalty_customer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_profiles
    ADD CONSTRAINT fk_loyalty_customer FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: pos_receipts fk_pos_receipts_print_order; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT fk_pos_receipts_print_order FOREIGN KEY (print_order_id) REFERENCES public.photo_print_orders(id) ON DELETE SET NULL;


--
-- Name: pos_receipts fk_pos_receipts_subscription; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT fk_pos_receipts_subscription FOREIGN KEY (subscription_id) REFERENCES public.user_subscriptions(id);


--
-- Name: work_tasks fk_work_tasks_print_order; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT fk_work_tasks_print_order FOREIGN KEY (print_order_id) REFERENCES public.photo_print_orders(id) ON DELETE SET NULL;


--
-- Name: gallery_photos gallery_photos_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_photos
    ADD CONSTRAINT gallery_photos_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id) ON DELETE SET NULL;


--
-- Name: icc_profiles icc_profiles_calibrated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.icc_profiles
    ADD CONSTRAINT icc_profiles_calibrated_by_fkey FOREIGN KEY (calibrated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: icc_profiles icc_profiles_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.icc_profiles
    ADD CONSTRAINT icc_profiles_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.bridge_devices(id) ON DELETE CASCADE;


--
-- Name: infra_alerts infra_alerts_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infra_alerts
    ADD CONSTRAINT infra_alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id);


--
-- Name: infra_alerts infra_alerts_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infra_alerts
    ADD CONSTRAINT infra_alerts_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: infra_alerts infra_alerts_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infra_alerts
    ADD CONSTRAINT infra_alerts_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: inventory_audit_items inventory_audit_items_audit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_audit_items
    ADD CONSTRAINT inventory_audit_items_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.inventory_audits(id) ON DELETE CASCADE;


--
-- Name: inventory_audit_items inventory_audit_items_product_stock_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_audit_items
    ADD CONSTRAINT inventory_audit_items_product_stock_id_fkey FOREIGN KEY (product_stock_id) REFERENCES public.product_stock(id);


--
-- Name: inventory_audits inventory_audits_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_audits
    ADD CONSTRAINT inventory_audits_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: inventory_receipts inventory_receipts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_receipts
    ADD CONSTRAINT inventory_receipts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: inventory_receipts inventory_receipts_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_receipts
    ADD CONSTRAINT inventory_receipts_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id);


--
-- Name: inventory_transactions inventory_transactions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: inventory_transactions inventory_transactions_product_stock_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_product_stock_id_fkey FOREIGN KEY (product_stock_id) REFERENCES public.product_stock(id);


--
-- Name: kb_categories kb_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_categories
    ADD CONSTRAINT kb_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.kb_categories(id) ON DELETE CASCADE;


--
-- Name: kb_competitor_prices kb_competitor_prices_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_competitor_prices
    ADD CONSTRAINT kb_competitor_prices_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.kb_entities(id) ON DELETE CASCADE;


--
-- Name: kb_config kb_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_config
    ADD CONSTRAINT kb_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kb_enrichment_tasks kb_enrichment_tasks_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_enrichment_tasks
    ADD CONSTRAINT kb_enrichment_tasks_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.kb_entities(id) ON DELETE CASCADE;


--
-- Name: kb_entities kb_entities_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entities
    ADD CONSTRAINT kb_entities_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.kb_categories(id) ON DELETE RESTRICT;


--
-- Name: kb_entities kb_entities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entities
    ADD CONSTRAINT kb_entities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kb_entities kb_entities_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entities
    ADD CONSTRAINT kb_entities_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kb_entities kb_entities_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entities
    ADD CONSTRAINT kb_entities_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kb_entity_versions kb_entity_versions_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entity_versions
    ADD CONSTRAINT kb_entity_versions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kb_entity_versions kb_entity_versions_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entity_versions
    ADD CONSTRAINT kb_entity_versions_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.kb_entities(id) ON DELETE CASCADE;


--
-- Name: kb_metrics kb_metrics_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_metrics
    ADD CONSTRAINT kb_metrics_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.kb_metric_definitions(id) ON DELETE RESTRICT;


--
-- Name: kb_price_alerts kb_price_alerts_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_price_alerts
    ADD CONSTRAINT kb_price_alerts_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.kb_entities(id) ON DELETE CASCADE;


--
-- Name: kb_price_history kb_price_history_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_price_history
    ADD CONSTRAINT kb_price_history_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.kb_entities(id) ON DELETE CASCADE;


--
-- Name: kb_relations kb_relations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_relations
    ADD CONSTRAINT kb_relations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kb_relations kb_relations_from_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_relations
    ADD CONSTRAINT kb_relations_from_entity_id_fkey FOREIGN KEY (from_entity_id) REFERENCES public.kb_entities(id) ON DELETE CASCADE;


--
-- Name: kb_relations kb_relations_to_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_relations
    ADD CONSTRAINT kb_relations_to_entity_id_fkey FOREIGN KEY (to_entity_id) REFERENCES public.kb_entities(id) ON DELETE CASCADE;


--
-- Name: kb_source_links kb_source_links_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_source_links
    ADD CONSTRAINT kb_source_links_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.kb_entities(id) ON DELETE CASCADE;


--
-- Name: kb_source_links kb_source_links_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_source_links
    ADD CONSTRAINT kb_source_links_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.kb_data_sources(id) ON DELETE CASCADE;


--
-- Name: kpi_alerts kpi_alerts_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_alerts
    ADD CONSTRAINT kpi_alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kpi_alerts kpi_alerts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_alerts
    ADD CONSTRAINT kpi_alerts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: kpi_alerts kpi_alerts_metric_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_alerts
    ADD CONSTRAINT kpi_alerts_metric_code_fkey FOREIGN KEY (metric_code) REFERENCES public.kpi_metric_definitions(code) ON DELETE CASCADE;


--
-- Name: kpi_composite_scores kpi_composite_scores_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_composite_scores
    ADD CONSTRAINT kpi_composite_scores_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: kpi_snapshots kpi_snapshots_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_snapshots
    ADD CONSTRAINT kpi_snapshots_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: kpi_snapshots kpi_snapshots_metric_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_snapshots
    ADD CONSTRAINT kpi_snapshots_metric_code_fkey FOREIGN KEY (metric_code) REFERENCES public.kpi_metric_definitions(code) ON DELETE CASCADE;


--
-- Name: kpi_targets kpi_targets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_targets
    ADD CONSTRAINT kpi_targets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kpi_targets kpi_targets_metric_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_targets
    ADD CONSTRAINT kpi_targets_metric_code_fkey FOREIGN KEY (metric_code) REFERENCES public.kpi_metric_definitions(code) ON DELETE CASCADE;


--
-- Name: kpi_weight_profiles kpi_weight_profiles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_weight_profiles
    ADD CONSTRAINT kpi_weight_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: loyalty_profiles loyalty_profiles_referred_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_profiles
    ADD CONSTRAINT loyalty_profiles_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES public.telegram_users(id);


--
-- Name: loyalty_profiles loyalty_profiles_referred_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_profiles
    ADD CONSTRAINT loyalty_profiles_referred_by_user_id_fkey FOREIGN KEY (referred_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: loyalty_profiles loyalty_profiles_telegram_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_profiles
    ADD CONSTRAINT loyalty_profiles_telegram_user_id_fkey FOREIGN KEY (telegram_user_id) REFERENCES public.telegram_users(id) ON DELETE CASCADE;


--
-- Name: loyalty_profiles loyalty_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_profiles
    ADD CONSTRAINT loyalty_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketing_campaigns marketing_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_campaigns
    ADD CONSTRAINT marketing_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: material_usage material_usage_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_usage
    ADD CONSTRAINT material_usage_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: material_usage material_usage_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_usage
    ADD CONSTRAINT material_usage_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: material_usage material_usage_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_usage
    ADD CONSTRAINT material_usage_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.pos_receipts(id) ON DELETE SET NULL;


--
-- Name: material_usage material_usage_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_usage
    ADD CONSTRAINT material_usage_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id);


--
-- Name: material_usage material_usage_work_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_usage
    ADD CONSTRAINT material_usage_work_log_id_fkey FOREIGN KEY (work_log_id) REFERENCES public.service_work_logs(id) ON DELETE SET NULL;


--
-- Name: media_attachments media_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_attachments
    ADD CONSTRAINT media_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_statuses message_statuses_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_statuses
    ADD CONSTRAINT message_statuses_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_reply_to_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: mobile_push_tokens mobile_push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_tokens
    ADD CONSTRAINT mobile_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: option_groups option_groups_service_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_groups
    ADD CONSTRAINT option_groups_service_category_id_fkey FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE CASCADE;


--
-- Name: option_rules option_rules_service_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_rules
    ADD CONSTRAINT option_rules_service_category_id_fkey FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE CASCADE;


--
-- Name: option_rules option_rules_source_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_rules
    ADD CONSTRAINT option_rules_source_category_id_fkey FOREIGN KEY (source_category_id) REFERENCES public.service_categories(id) ON DELETE CASCADE;


--
-- Name: option_rules option_rules_source_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_rules
    ADD CONSTRAINT option_rules_source_option_id_fkey FOREIGN KEY (source_option_id) REFERENCES public.service_options(id) ON DELETE CASCADE;


--
-- Name: option_rules option_rules_target_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.option_rules
    ADD CONSTRAINT option_rules_target_option_id_fkey FOREIGN KEY (target_option_id) REFERENCES public.service_options(id) ON DELETE CASCADE;


--
-- Name: order_assignments order_assignments_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_assignments
    ADD CONSTRAINT order_assignments_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: order_assignments order_assignments_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_assignments
    ADD CONSTRAINT order_assignments_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id);


--
-- Name: order_attachments order_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_attachments
    ADD CONSTRAINT order_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: order_comments order_comments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_comments
    ADD CONSTRAINT order_comments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_comments order_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_comments
    ADD CONSTRAINT order_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: order_delay_compensations order_delay_compensations_credited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_delay_compensations
    ADD CONSTRAINT order_delay_compensations_credited_by_fkey FOREIGN KEY (credited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_service_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_service_option_id_fkey FOREIGN KEY (service_option_id) REFERENCES public.service_options(id) ON DELETE SET NULL;


--
-- Name: order_status_history order_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: order_templates order_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_templates
    ADD CONSTRAINT order_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: orders orders_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: orders orders_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: orders orders_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id) ON DELETE SET NULL;


--
-- Name: outbound_queue outbound_queue_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_queue
    ADD CONSTRAINT outbound_queue_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.channel_accounts(id) ON DELETE SET NULL;


--
-- Name: outbound_queue outbound_queue_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_queue
    ADD CONSTRAINT outbound_queue_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: outbound_queue outbound_queue_media_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_queue
    ADD CONSTRAINT outbound_queue_media_attachment_id_fkey FOREIGN KEY (media_attachment_id) REFERENCES public.media_attachments(id) ON DELETE SET NULL;


--
-- Name: outbound_queue outbound_queue_source_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_queue
    ADD CONSTRAINT outbound_queue_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: partner_commission_rules partner_commission_rules_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_commission_rules
    ADD CONSTRAINT partner_commission_rules_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: partner_payouts partner_payouts_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_payouts
    ADD CONSTRAINT partner_payouts_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: partner_payouts partner_payouts_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_payouts
    ADD CONSTRAINT partner_payouts_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: partner_referrals partner_referrals_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_referrals
    ADD CONSTRAINT partner_referrals_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: partners partners_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: partners partners_tier_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_tier_slug_fkey FOREIGN KEY (tier_slug) REFERENCES public.partner_tiers(slug);


--
-- Name: partners partners_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pending_oauth_links pending_oauth_links_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_oauth_links
    ADD CONSTRAINT pending_oauth_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: permissions permissions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.photo_sessions(id) ON DELETE SET NULL;


--
-- Name: permissions permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: photo_approval_annotations photo_approval_annotations_approval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_annotations
    ADD CONSTRAINT photo_approval_annotations_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES public.photo_approvals(id) ON DELETE CASCADE;


--
-- Name: photo_approval_annotations photo_approval_annotations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_annotations
    ADD CONSTRAINT photo_approval_annotations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: photo_approval_revisions photo_approval_revisions_approval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_revisions
    ADD CONSTRAINT photo_approval_revisions_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES public.photo_approvals(id) ON DELETE CASCADE;


--
-- Name: photo_approval_revisions photo_approval_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_revisions
    ADD CONSTRAINT photo_approval_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: photo_approval_sessions photo_approval_sessions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_sessions
    ADD CONSTRAINT photo_approval_sessions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: photo_approval_sessions photo_approval_sessions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_sessions
    ADD CONSTRAINT photo_approval_sessions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: photo_approval_sessions photo_approval_sessions_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_sessions
    ADD CONSTRAINT photo_approval_sessions_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.users(id);


--
-- Name: photo_approval_variants photo_approval_variants_approval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approval_variants
    ADD CONSTRAINT photo_approval_variants_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES public.photo_approvals(id) ON DELETE CASCADE;


--
-- Name: photo_approvals photo_approvals_approval_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approvals
    ADD CONSTRAINT photo_approvals_approval_session_id_fkey FOREIGN KEY (approval_session_id) REFERENCES public.photo_approval_sessions(id) ON DELETE CASCADE;


--
-- Name: photo_approvals photo_approvals_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approvals
    ADD CONSTRAINT photo_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: photo_approvals photo_approvals_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approvals
    ADD CONSTRAINT photo_approvals_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: photo_approvals photo_approvals_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approvals
    ADD CONSTRAINT photo_approvals_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: photo_approvals photo_approvals_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approvals
    ADD CONSTRAINT photo_approvals_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES public.photos(id) ON DELETE SET NULL;


--
-- Name: photo_approvals photo_approvals_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approvals
    ADD CONSTRAINT photo_approvals_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: photo_approvals photo_approvals_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_approvals
    ADD CONSTRAINT photo_approvals_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.photo_sessions(id) ON DELETE SET NULL;


--
-- Name: photo_print_orders photo_print_orders_assigned_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_print_orders
    ADD CONSTRAINT photo_print_orders_assigned_employee_id_fkey FOREIGN KEY (assigned_employee_id) REFERENCES public.users(id);


--
-- Name: photo_print_orders photo_print_orders_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_print_orders
    ADD CONSTRAINT photo_print_orders_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.marketing_campaigns(id);


--
-- Name: photo_print_orders photo_print_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_print_orders
    ADD CONSTRAINT photo_print_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: photo_print_orders photo_print_orders_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_print_orders
    ADD CONSTRAINT photo_print_orders_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: photo_selections photo_selections_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_selections
    ADD CONSTRAINT photo_selections_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.photo_sessions(id) ON DELETE CASCADE;


--
-- Name: photo_selections photo_selections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_selections
    ADD CONSTRAINT photo_selections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: photo_sessions photo_sessions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_sessions
    ADD CONSTRAINT photo_sessions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: photo_sessions photo_sessions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_sessions
    ADD CONSTRAINT photo_sessions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: photo_sessions photo_sessions_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_sessions
    ADD CONSTRAINT photo_sessions_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id) ON DELETE CASCADE;


--
-- Name: photographer_services photographer_services_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photographer_services
    ADD CONSTRAINT photographer_services_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id) ON DELETE CASCADE;


--
-- Name: photographers photographers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photographers
    ADD CONSTRAINT photographers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: photos photos_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.files(id) ON DELETE SET NULL;


--
-- Name: photos photos_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.photo_sessions(id) ON DELETE CASCADE;


--
-- Name: points_transactions points_transactions_loyalty_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_loyalty_profile_id_fkey FOREIGN KEY (loyalty_profile_id) REFERENCES public.loyalty_profiles(id) ON DELETE CASCADE;


--
-- Name: pos_cash_counts pos_cash_counts_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_cash_counts
    ADD CONSTRAINT pos_cash_counts_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.pos_shifts(id) ON DELETE CASCADE;


--
-- Name: pos_receipt_items pos_receipt_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipt_items
    ADD CONSTRAINT pos_receipt_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: pos_receipt_items pos_receipt_items_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipt_items
    ADD CONSTRAINT pos_receipt_items_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.pos_receipts(id) ON DELETE CASCADE;


--
-- Name: pos_receipt_payments pos_receipt_payments_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipt_payments
    ADD CONSTRAINT pos_receipt_payments_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.pos_receipts(id) ON DELETE CASCADE;


--
-- Name: pos_receipts pos_receipts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT pos_receipts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: pos_receipts pos_receipts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT pos_receipts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: pos_receipts pos_receipts_loyalty_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT pos_receipts_loyalty_profile_id_fkey FOREIGN KEY (loyalty_profile_id) REFERENCES public.loyalty_profiles(id);


--
-- Name: pos_receipts pos_receipts_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT pos_receipts_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id);


--
-- Name: pos_receipts pos_receipts_refund_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT pos_receipts_refund_receipt_id_fkey FOREIGN KEY (refund_receipt_id) REFERENCES public.pos_receipts(id);


--
-- Name: pos_receipts pos_receipts_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT pos_receipts_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.pos_shifts(id);


--
-- Name: pos_receipts pos_receipts_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipts
    ADD CONSTRAINT pos_receipts_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id);


--
-- Name: pos_shifts pos_shifts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: pos_shifts pos_shifts_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id);


--
-- Name: pos_transactions pos_transactions_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_transactions
    ADD CONSTRAINT pos_transactions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: pos_transactions pos_transactions_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_transactions
    ADD CONSTRAINT pos_transactions_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: pos_transactions pos_transactions_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_transactions
    ADD CONSTRAINT pos_transactions_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.pos_receipts(id);


--
-- Name: pos_transactions pos_transactions_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_transactions
    ADD CONSTRAINT pos_transactions_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: pos_fiscal_settings pos_fiscal_settings_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_fiscal_settings
    ADD CONSTRAINT pos_fiscal_settings_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: pos_fiscal_settings pos_fiscal_settings_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_fiscal_settings
    ADD CONSTRAINT pos_fiscal_settings_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: pos_fiscal_settings pos_fiscal_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_fiscal_settings
    ADD CONSTRAINT pos_fiscal_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: photo_print_orders ppo_document_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photo_print_orders
    ADD CONSTRAINT ppo_document_template_id_fkey FOREIGN KEY (document_template_id) REFERENCES public.document_templates(id) ON DELETE SET NULL;


--
-- Name: price_locks price_locks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_locks
    ADD CONSTRAINT price_locks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: price_modifiers price_modifiers_service_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_modifiers
    ADD CONSTRAINT price_modifiers_service_category_id_fkey FOREIGN KEY (service_category_id) REFERENCES public.service_categories(id) ON DELETE CASCADE;


--
-- Name: price_modifiers price_modifiers_service_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_modifiers
    ADD CONSTRAINT price_modifiers_service_option_id_fkey FOREIGN KEY (service_option_id) REFERENCES public.service_options(id) ON DELETE CASCADE;


--
-- Name: pricing_ai_suggestions pricing_ai_suggestions_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_ai_suggestions
    ADD CONSTRAINT pricing_ai_suggestions_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pricing_ai_suggestions pricing_ai_suggestions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_ai_suggestions
    ADD CONSTRAINT pricing_ai_suggestions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_document_template_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_document_template_fkey FOREIGN KEY (document_template_slug) REFERENCES public.document_templates(slug) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_face_validation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_face_validation_id_fkey FOREIGN KEY (face_validation_id) REFERENCES public.face_validations(id) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_icc_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_icc_profile_id_fkey FOREIGN KEY (icc_profile_id) REFERENCES public.icc_profiles(id) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_original_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_original_job_id_fkey FOREIGN KEY (original_job_id) REFERENCES public.print_jobs(id) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_parent_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_parent_job_id_fkey FOREIGN KEY (parent_job_id) REFERENCES public.print_jobs(id) ON DELETE CASCADE;


--
-- Name: print_jobs print_jobs_preset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_preset_id_fkey FOREIGN KEY (preset_id) REFERENCES public.print_presets(id) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_printer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_printer_id_fkey FOREIGN KEY (printer_id) REFERENCES public.printers(id) ON DELETE RESTRICT;


--
-- Name: print_jobs print_jobs_reassigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_reassigned_by_fkey FOREIGN KEY (reassigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_reassigned_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_reassigned_from_fkey FOREIGN KEY (reassigned_from) REFERENCES public.printers(id) ON DELETE SET NULL;


--
-- Name: print_jobs print_jobs_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_jobs
    ADD CONSTRAINT print_jobs_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE SET NULL;


--
-- Name: print_presets print_presets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_presets
    ADD CONSTRAINT print_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: print_presets print_presets_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_presets
    ADD CONSTRAINT print_presets_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE SET NULL;


--
-- Name: print_speed_log print_speed_log_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_speed_log
    ADD CONSTRAINT print_speed_log_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: print_speed_log print_speed_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_speed_log
    ADD CONSTRAINT print_speed_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.photo_print_orders(order_id) ON DELETE SET NULL;


--
-- Name: print_waste_log print_waste_log_print_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_waste_log
    ADD CONSTRAINT print_waste_log_print_job_id_fkey FOREIGN KEY (print_job_id) REFERENCES public.print_jobs(id) ON DELETE SET NULL;


--
-- Name: print_waste_log print_waste_log_printer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_waste_log
    ADD CONSTRAINT print_waste_log_printer_id_fkey FOREIGN KEY (printer_id) REFERENCES public.printers(id) ON DELETE SET NULL;


--
-- Name: print_waste_log print_waste_log_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_waste_log
    ADD CONSTRAINT print_waste_log_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: print_waste_log print_waste_log_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_waste_log
    ADD CONSTRAINT print_waste_log_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE SET NULL;


--
-- Name: printer_telemetry printer_telemetry_bridge_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_telemetry
    ADD CONSTRAINT printer_telemetry_bridge_device_id_fkey FOREIGN KEY (bridge_device_id) REFERENCES public.bridge_devices(id) ON DELETE SET NULL;


--
-- Name: printer_telemetry printer_telemetry_printer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_telemetry
    ADD CONSTRAINT printer_telemetry_printer_id_fkey FOREIGN KEY (printer_id) REFERENCES public.printers(id) ON DELETE CASCADE;


--
-- Name: printer_telemetry printer_telemetry_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printer_telemetry
    ADD CONSTRAINT printer_telemetry_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE SET NULL;


--
-- Name: printers printers_default_icc_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printers
    ADD CONSTRAINT printers_default_icc_profile_id_fkey FOREIGN KEY (default_icc_profile_id) REFERENCES public.icc_profiles(id) ON DELETE SET NULL;


--
-- Name: printers printers_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printers
    ADD CONSTRAINT printers_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE SET NULL;


--
-- Name: printing_house_products printing_house_products_printing_house_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.printing_house_products
    ADD CONSTRAINT printing_house_products_printing_house_id_fkey FOREIGN KEY (printing_house_id) REFERENCES public.printing_houses(id) ON DELETE CASCADE;


--
-- Name: product_categories product_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.product_categories(id) ON DELETE SET NULL;


--
-- Name: product_stock product_stock_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock
    ADD CONSTRAINT product_stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_stock product_stock_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock
    ADD CONSTRAINT product_stock_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: production_order_events production_order_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_order_events
    ADD CONSTRAINT production_order_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: production_order_events production_order_events_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_order_events
    ADD CONSTRAINT production_order_events_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES public.production_orders(id) ON DELETE CASCADE;


--
-- Name: production_orders production_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: production_orders production_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: production_orders production_orders_photo_print_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_photo_print_order_id_fkey FOREIGN KEY (photo_print_order_id) REFERENCES public.photo_print_orders(id) ON DELETE SET NULL;


--
-- Name: production_orders production_orders_printing_house_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_printing_house_id_fkey FOREIGN KEY (printing_house_id) REFERENCES public.printing_houses(id);


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(id) ON DELETE SET NULL;


--
-- Name: promo_redemptions promo_redemptions_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_redemptions
    ADD CONSTRAINT promo_redemptions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.marketing_campaigns(id);


--
-- Name: promo_redemptions promo_redemptions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_redemptions
    ADD CONSTRAINT promo_redemptions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: promo_redemptions promo_redemptions_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_redemptions
    ADD CONSTRAINT promo_redemptions_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id);


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: rbac_audit_log rbac_audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_log
    ADD CONSTRAINT rbac_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: rbac_audit_log rbac_audit_log_target_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_log
    ADD CONSTRAINT rbac_audit_log_target_permission_id_fkey FOREIGN KEY (target_permission_id) REFERENCES public.rbac_permissions(id);


--
-- Name: rbac_audit_log rbac_audit_log_target_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_log
    ADD CONSTRAINT rbac_audit_log_target_role_id_fkey FOREIGN KEY (target_role_id) REFERENCES public.rbac_roles(id);


--
-- Name: rbac_audit_log rbac_audit_log_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_audit_log
    ADD CONSTRAINT rbac_audit_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id);


--
-- Name: rbac_role_permissions rbac_role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.rbac_permissions(id) ON DELETE CASCADE;


--
-- Name: rbac_role_permissions rbac_role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.rbac_roles(id) ON DELETE CASCADE;


--
-- Name: rbac_user_overrides rbac_user_overrides_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_overrides
    ADD CONSTRAINT rbac_user_overrides_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: rbac_user_overrides rbac_user_overrides_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_overrides
    ADD CONSTRAINT rbac_user_overrides_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.rbac_permissions(id) ON DELETE CASCADE;


--
-- Name: rbac_user_overrides rbac_user_overrides_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rbac_user_overrides
    ADD CONSTRAINT rbac_user_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refund_requests refund_requests_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: refund_requests refund_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: replay_chunks replay_chunks_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.replay_chunks
    ADD CONSTRAINT replay_chunks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.replay_sessions(id) ON DELETE CASCADE;


--
-- Name: replay_sessions replay_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.replay_sessions
    ADD CONSTRAINT replay_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: reviews reviews_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: rollout_plans rollout_plans_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollout_plans
    ADD CONSTRAINT rollout_plans_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: rollout_plans rollout_plans_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rollout_plans
    ADD CONSTRAINT rollout_plans_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.agent_releases(id);


--
-- Name: saved_payment_methods saved_payment_methods_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_payment_methods
    ADD CONSTRAINT saved_payment_methods_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: schedule_preferences schedule_preferences_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_preferences
    ADD CONSTRAINT schedule_preferences_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: schedule_requests schedule_requests_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_requests
    ADD CONSTRAINT schedule_requests_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id);


--
-- Name: schedule_requests schedule_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_requests
    ADD CONSTRAINT schedule_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: scheduled_messages scheduled_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_messages
    ADD CONSTRAINT scheduled_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: scheduled_messages scheduled_messages_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_messages
    ADD CONSTRAINT scheduled_messages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: schedules schedules_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id) ON DELETE CASCADE;


--
-- Name: security_events security_events_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: service_catalog service_catalog_default_print_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_catalog
    ADD CONSTRAINT service_catalog_default_print_profile_id_fkey FOREIGN KEY (default_print_profile_id) REFERENCES public.icc_profiles(id) ON DELETE SET NULL;


--
-- Name: service_options service_options_option_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_options
    ADD CONSTRAINT service_options_option_group_id_fkey FOREIGN KEY (option_group_id) REFERENCES public.option_groups(id) ON DELETE CASCADE;


--
-- Name: service_options service_options_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_options
    ADD CONSTRAINT service_options_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: service_work_logs service_work_logs_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_work_logs
    ADD CONSTRAINT service_work_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: service_work_logs service_work_logs_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_work_logs
    ADD CONSTRAINT service_work_logs_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.pos_receipts(id) ON DELETE SET NULL;


--
-- Name: service_work_logs service_work_logs_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_work_logs
    ADD CONSTRAINT service_work_logs_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id);


--
-- Name: shift_briefings shift_briefings_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_briefings
    ADD CONSTRAINT shift_briefings_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: shift_briefings shift_briefings_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_briefings
    ADD CONSTRAINT shift_briefings_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.employee_shifts(id) ON DELETE CASCADE;


--
-- Name: shift_briefings shift_briefings_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_briefings
    ADD CONSTRAINT shift_briefings_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id);


--
-- Name: staff_conversation_participants staff_conversation_participants_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_conversation_participants
    ADD CONSTRAINT staff_conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.staff_conversations(id) ON DELETE CASCADE;


--
-- Name: staff_conversation_participants staff_conversation_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_conversation_participants
    ADD CONSTRAINT staff_conversation_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: staff_conversations staff_conversations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_conversations
    ADD CONSTRAINT staff_conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: staff_conversations staff_conversations_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_conversations
    ADD CONSTRAINT staff_conversations_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- Name: staff_mentions staff_mentions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_mentions
    ADD CONSTRAINT staff_mentions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.staff_messages(id) ON DELETE CASCADE;


--
-- Name: staff_mentions staff_mentions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_mentions
    ADD CONSTRAINT staff_mentions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: staff_message_reactions staff_message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_message_reactions
    ADD CONSTRAINT staff_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.staff_messages(id) ON DELETE CASCADE;


--
-- Name: staff_message_reactions staff_message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_message_reactions
    ADD CONSTRAINT staff_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: staff_messages staff_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_messages
    ADD CONSTRAINT staff_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.staff_conversations(id) ON DELETE CASCADE;


--
-- Name: staff_messages staff_messages_pinned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_messages
    ADD CONSTRAINT staff_messages_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES public.users(id);


--
-- Name: staff_messages staff_messages_reply_to_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_messages
    ADD CONSTRAINT staff_messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES public.staff_messages(id);


--
-- Name: staff_messages staff_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_messages
    ADD CONSTRAINT staff_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: staff_read_receipts staff_read_receipts_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_read_receipts
    ADD CONSTRAINT staff_read_receipts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.staff_conversations(id) ON DELETE CASCADE;


--
-- Name: staff_read_receipts staff_read_receipts_last_read_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_read_receipts
    ADD CONSTRAINT staff_read_receipts_last_read_message_id_fkey FOREIGN KEY (last_read_message_id) REFERENCES public.staff_messages(id);


--
-- Name: staff_read_receipts staff_read_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_read_receipts
    ADD CONSTRAINT staff_read_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: studio_reviews studio_reviews_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_reviews
    ADD CONSTRAINT studio_reviews_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: studio_reviews studio_reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_reviews
    ADD CONSTRAINT studio_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: studio_schedule_exceptions studio_schedule_exceptions_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_schedule_exceptions
    ADD CONSTRAINT studio_schedule_exceptions_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: studio_working_hours studio_working_hours_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_working_hours
    ADD CONSTRAINT studio_working_hours_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: subscription_card_changes subscription_card_changes_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_card_changes
    ADD CONSTRAINT subscription_card_changes_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.user_subscriptions(id) ON DELETE CASCADE;


--
-- Name: subscription_card_changes subscription_card_changes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_card_changes
    ADD CONSTRAINT subscription_card_changes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: subscription_credit_usage_log subscription_credit_usage_log_credit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credit_usage_log
    ADD CONSTRAINT subscription_credit_usage_log_credit_id_fkey FOREIGN KEY (credit_id) REFERENCES public.subscription_credits(id);


--
-- Name: subscription_credit_usage_log subscription_credit_usage_log_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credit_usage_log
    ADD CONSTRAINT subscription_credit_usage_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: subscription_credit_usage_log subscription_credit_usage_log_pos_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credit_usage_log
    ADD CONSTRAINT subscription_credit_usage_log_pos_receipt_id_fkey FOREIGN KEY (pos_receipt_id) REFERENCES public.pos_receipts(id);


--
-- Name: subscription_credit_usage_log subscription_credit_usage_log_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credit_usage_log
    ADD CONSTRAINT subscription_credit_usage_log_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: subscription_credit_usage_log subscription_credit_usage_log_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credit_usage_log
    ADD CONSTRAINT subscription_credit_usage_log_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.user_subscriptions(id);


--
-- Name: subscription_credits subscription_credits_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credits
    ADD CONSTRAINT subscription_credits_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: subscription_credits subscription_credits_rolled_over_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credits
    ADD CONSTRAINT subscription_credits_rolled_over_from_fkey FOREIGN KEY (rolled_over_from) REFERENCES public.subscription_credits(id);


--
-- Name: subscription_credits subscription_credits_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credits
    ADD CONSTRAINT subscription_credits_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.user_subscriptions(id) ON DELETE CASCADE;


--
-- Name: subscription_offers subscription_offers_chat_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_offers
    ADD CONSTRAINT subscription_offers_chat_session_id_fkey FOREIGN KEY (chat_session_id) REFERENCES public.conversations(id);


--
-- Name: subscription_offers subscription_offers_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_offers
    ADD CONSTRAINT subscription_offers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.users(id);


--
-- Name: subscription_offers subscription_offers_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_offers
    ADD CONSTRAINT subscription_offers_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id);


--
-- Name: subscription_offers subscription_offers_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_offers
    ADD CONSTRAINT subscription_offers_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id);


--
-- Name: subscription_offers subscription_offers_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_offers
    ADD CONSTRAINT subscription_offers_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.user_subscriptions(id);


--
-- Name: subscription_plan_items subscription_plan_items_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plan_items
    ADD CONSTRAINT subscription_plan_items_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE CASCADE;


--
-- Name: subscription_plan_items subscription_plan_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plan_items
    ADD CONSTRAINT subscription_plan_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: system_telemetry system_telemetry_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_telemetry
    ADD CONSTRAINT system_telemetry_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: system_telemetry system_telemetry_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_telemetry
    ADD CONSTRAINT system_telemetry_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE CASCADE;


--
-- Name: task_handoffs task_handoffs_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(id);


--
-- Name: task_handoffs task_handoffs_from_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_from_employee_id_fkey FOREIGN KEY (from_employee_id) REFERENCES public.users(id);


--
-- Name: task_handoffs task_handoffs_from_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_from_shift_id_fkey FOREIGN KEY (from_shift_id) REFERENCES public.employee_shifts(id) ON DELETE SET NULL;


--
-- Name: task_handoffs task_handoffs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.work_tasks(id) ON DELETE CASCADE;


--
-- Name: task_handoffs task_handoffs_to_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_handoffs
    ADD CONSTRAINT task_handoffs_to_employee_id_fkey FOREIGN KEY (to_employee_id) REFERENCES public.users(id);


--
-- Name: task_links task_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: task_links task_links_task_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_task_a_id_fkey FOREIGN KEY (task_a_id) REFERENCES public.work_tasks(id) ON DELETE CASCADE;


--
-- Name: task_links task_links_task_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_links
    ADD CONSTRAINT task_links_task_b_id_fkey FOREIGN KEY (task_b_id) REFERENCES public.work_tasks(id) ON DELETE CASCADE;


--
-- Name: task_notes task_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_notes
    ADD CONSTRAINT task_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_notes task_notes_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_notes
    ADD CONSTRAINT task_notes_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.work_tasks(id) ON DELETE CASCADE;


--
-- Name: user_achievements user_achievements_loyalty_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_loyalty_profile_id_fkey FOREIGN KEY (loyalty_profile_id) REFERENCES public.loyalty_profiles(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_subscriptions user_subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id);


--
-- Name: user_subscriptions user_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: verification_codes verification_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_codes
    ADD CONSTRAINT verification_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: visitor_chat_cart_items visitor_chat_cart_items_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_cart_items
    ADD CONSTRAINT visitor_chat_cart_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.visitor_chat_sessions(id) ON DELETE CASCADE;


--
-- Name: visitor_chat_messages visitor_chat_messages_reply_to_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_messages
    ADD CONSTRAINT visitor_chat_messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES public.visitor_chat_messages(id);


--
-- Name: visitor_chat_messages visitor_chat_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_messages
    ADD CONSTRAINT visitor_chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.visitor_chat_sessions(id) ON DELETE CASCADE;


--
-- Name: visitor_chat_session_tags visitor_chat_session_tags_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_session_tags
    ADD CONSTRAINT visitor_chat_session_tags_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);


--
-- Name: visitor_chat_session_tags visitor_chat_session_tags_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_session_tags
    ADD CONSTRAINT visitor_chat_session_tags_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.visitor_chat_sessions(id) ON DELETE CASCADE;


--
-- Name: visitor_chat_session_tags visitor_chat_session_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_session_tags
    ADD CONSTRAINT visitor_chat_session_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.chat_tags(id) ON DELETE CASCADE;


--
-- Name: visitor_chat_sessions visitor_chat_sessions_assigned_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_sessions
    ADD CONSTRAINT visitor_chat_sessions_assigned_operator_id_fkey FOREIGN KEY (assigned_operator_id) REFERENCES public.users(id);


--
-- Name: visitor_chat_sessions visitor_chat_sessions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_sessions
    ADD CONSTRAINT visitor_chat_sessions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: visitor_chat_sessions visitor_chat_sessions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_sessions
    ADD CONSTRAINT visitor_chat_sessions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: visitor_chat_sessions visitor_chat_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_chat_sessions
    ADD CONSTRAINT visitor_chat_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: visitor_push_subscriptions visitor_push_subscriptions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitor_push_subscriptions
    ADD CONSTRAINT visitor_push_subscriptions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: webhook_events webhook_events_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.channel_accounts(id) ON DELETE SET NULL;


--
-- Name: work_tasks work_tasks_assigned_studio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_assigned_studio_id_fkey FOREIGN KEY (assigned_studio_id) REFERENCES public.studios(id) ON DELETE SET NULL;


--
-- Name: work_tasks work_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: work_tasks work_tasks_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: work_tasks work_tasks_chat_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_chat_session_id_fkey FOREIGN KEY (chat_session_id) REFERENCES public.visitor_chat_sessions(id) ON DELETE SET NULL;


--
-- Name: work_tasks work_tasks_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: work_tasks work_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: work_tasks work_tasks_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_tasks
    ADD CONSTRAINT work_tasks_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: workflow_runs workflow_runs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflows workflows_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict eltbh903NaZJC3ub0KW4vbDVJExABVIOjbyVRPRaE2ylzfaAHndFAb7QUxuSrJz

-- Migration 124 — payment_links_history (audit log, P3 #15)
-- Применена 2026-04-19. См. database/migrations/124_payment_links_history.sql
-- Trigger trg_payment_links_audit captures INSERT/UPDATE/DELETE.


-- ============================================================================
-- Migration 20260530_client_service_attributions — атрибуция услуг клиентов
-- Применена 2026-05-30. См. database/migrations/20260530_client_service_attributions.sql
-- Team mapping-telegram-services (slice S1): нормализованная таблица атрибуции
-- услуг + денорм-кэш primary_service_* на contacts. method CHECK без 'none'
-- (sentinel живёт в денорм-кэше); service_slug/service_category — без FK.
-- ============================================================================

--
-- Name: client_service_attributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_service_attributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    channel character varying(20) NOT NULL,
    service_slug character varying(100) NOT NULL,
    service_label character varying(255),
    service_category character varying(50),
    method character varying(24) NOT NULL,
    tier character varying(12) NOT NULL,
    confidence numeric(4,3) DEFAULT 1.000 NOT NULL,
    source_table character varying(40),
    source_id uuid,
    determined_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_service_attributions_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT client_service_attributions_method_check CHECK (((method)::text = ANY ((ARRAY['order'::character varying, 'receipt'::character varying, 'subscription'::character varying, 'booking'::character varying, 'conversation'::character varying, 'text_inference'::character varying, 'manual'::character varying])::text[]))),
    CONSTRAINT client_service_attributions_tier_check CHECK (((tier)::text = ANY ((ARRAY['fact'::character varying, 'inferred'::character varying, 'none'::character varying])::text[])))
);

ALTER TABLE ONLY public.client_service_attributions
    ADD CONSTRAINT client_service_attributions_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX ux_csa_source_service ON public.client_service_attributions USING btree (source_table, source_id, service_slug) WHERE (source_id IS NOT NULL);
CREATE INDEX idx_csa_contact ON public.client_service_attributions USING btree (contact_id, determined_at DESC);
CREATE INDEX idx_csa_channel_service ON public.client_service_attributions USING btree (channel, service_slug);

ALTER TABLE ONLY public.client_service_attributions
    ADD CONSTRAINT client_service_attributions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;

--
-- Денорм-кэш атрибуции на contacts (4 колонки + CHECK + partial index)
--

ALTER TABLE public.contacts
    ADD COLUMN primary_service_slug character varying(100),
    ADD COLUMN primary_service_label character varying(255),
    ADD COLUMN service_attribution_tier character varying(12) DEFAULT 'none'::character varying,
    ADD COLUMN service_attributed_at timestamp with time zone,
    ADD CONSTRAINT contacts_service_attribution_tier_check CHECK (((service_attribution_tier)::text = ANY ((ARRAY['fact'::character varying, 'inferred'::character varying, 'none'::character varying])::text[])));

CREATE INDEX idx_contacts_primary_service ON public.contacts USING btree (primary_service_slug) WHERE (primary_service_slug IS NOT NULL);
