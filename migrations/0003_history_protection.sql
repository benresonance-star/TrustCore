BEGIN;
ALTER TABLE tombstones ADD COLUMN restored_at timestamptz;
CREATE UNIQUE INDEX one_open_resource_tombstone ON tombstones (workspace_id, subject_id) WHERE subject_kind='resource' AND restored_at IS NULL AND purge_state<>'purged';
CREATE OR REPLACE FUNCTION trust_reject_immutable_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE='23000'; END; $$;
CREATE TRIGGER revisions_are_immutable BEFORE UPDATE OR DELETE ON revisions FOR EACH ROW EXECUTE FUNCTION trust_reject_immutable_update();
CREATE TRIGGER blob_objects_are_immutable BEFORE DELETE ON blob_objects FOR EACH ROW EXECUTE FUNCTION trust_reject_immutable_update();
CREATE OR REPLACE FUNCTION trust_limit_blob_updates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id OR NEW.sha256<>OLD.sha256 OR NEW.byte_length<>OLD.byte_length OR NEW.media_type<>OLD.media_type OR NEW.storage_provider<>OLD.storage_provider OR NEW.storage_key<>OLD.storage_key OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'blob identity and storage coordinates are immutable' USING ERRCODE='23000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER blob_object_identity_is_immutable BEFORE UPDATE ON blob_objects FOR EACH ROW EXECUTE FUNCTION trust_limit_blob_updates();
COMMIT;
