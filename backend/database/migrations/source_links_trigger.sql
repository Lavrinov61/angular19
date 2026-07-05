-- Trigger to maintain kb_data_sources.entity_count when kb_source_links change
-- Idempotent: uses CREATE OR REPLACE / IF NOT EXISTS

CREATE OR REPLACE FUNCTION kb_update_source_entity_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE kb_data_sources SET entity_count = entity_count + 1 WHERE id = NEW.source_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE kb_data_sources SET entity_count = entity_count - 1 WHERE id = OLD.source_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_source_links_count ON kb_source_links;
CREATE TRIGGER trg_source_links_count
  AFTER INSERT OR DELETE ON kb_source_links
  FOR EACH ROW EXECUTE FUNCTION kb_update_source_entity_count();
