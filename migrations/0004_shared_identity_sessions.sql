BEGIN;
CREATE TABLE identity_login_transactions (
  state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  browser_binding_hash char(64) NOT NULL CHECK (browser_binding_hash ~ '^[a-f0-9]{64}$'), nonce text NOT NULL,
  code_verifier text NOT NULL, redirect_uri text NOT NULL, return_to text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity_sessions (
  session_hash char(64) PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  csrf_hash char(64) NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'), actor_json jsonb NOT NULL,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX identity_login_expiry_idx ON identity_login_transactions(expires_at);
CREATE INDEX identity_session_expiry_idx ON identity_sessions(expires_at) WHERE revoked_at IS NULL;
REVOKE ALL ON identity_login_transactions,identity_sessions FROM PUBLIC;
COMMIT;
