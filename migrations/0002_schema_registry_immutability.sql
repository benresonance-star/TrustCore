BEGIN;

CREATE OR REPLACE FUNCTION protect_schema_package_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.namespace IS DISTINCT FROM NEW.namespace
    OR OLD.name IS DISTINCT FROM NEW.name
    OR OLD.semantic_version IS DISTINCT FROM NEW.semantic_version
    OR OLD.schema_digest IS DISTINCT FROM NEW.schema_digest
    OR OLD.manifest_json IS DISTINCT FROM NEW.manifest_json THEN
    RAISE EXCEPTION 'published schema package identity and manifest are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER schema_packages_immutable_definition
BEFORE UPDATE ON schema_packages
FOR EACH ROW EXECUTE FUNCTION protect_schema_package_identity();

COMMENT ON TABLE schema_packages IS
  'Versioned schema definitions. Published identity, digest and manifest are immutable; status may be deprecated or revoked.';

COMMIT;
