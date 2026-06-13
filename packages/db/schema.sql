-- GhostPR SQLite Schema
-- Run via packages/db/migrate.ts
-- Do NOT change column names without updating shared-types/src/index.ts

-- Decisions table: one row per extracted architectural decision
CREATE TABLE IF NOT EXISTS decisions (
  id             TEXT PRIMARY KEY,            -- UUID v4
  file_path      TEXT NOT NULL,               -- e.g. "auth/session.ts"
  module         TEXT NOT NULL,               -- e.g. "auth"
  summary        TEXT NOT NULL,               -- One-sentence decision summary
  reason         TEXT NOT NULL,               -- Why this was decided
  result         TEXT NOT NULL,               -- What actually happened
  lesson         TEXT NOT NULL,               -- What future devs should know
  confidence     REAL NOT NULL DEFAULT 1.0,   -- 0.0 – 1.0
  status         TEXT NOT NULL DEFAULT 'active', -- active | questionable | deprecated
  created        TEXT NOT NULL,               -- ISO 8601
  last_validated TEXT,                        -- ISO 8601 or NULL
  -- Source fields (flattened from DecisionSource)
  source_type    TEXT NOT NULL,               -- "pr" | "issue"
  source_url     TEXT NOT NULL,               -- Full GitHub URL
  source_author  TEXT NOT NULL,               -- GitHub username
  source_ref     INTEGER NOT NULL             -- PR / issue number
);

-- Agent log: one row per MCP interaction with a decision (decision_id NULL for query-miss events)
CREATE TABLE IF NOT EXISTS agent_log (
  id          TEXT PRIMARY KEY,    -- UUID v4
  decision_id TEXT REFERENCES decisions(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,       -- retrieved | shown | accepted | ignored | queried
  timestamp   TEXT NOT NULL,       -- ISO 8601
  result      TEXT NOT NULL        -- Human-readable outcome description
);

-- Indexes for fast MCP lookups (by file + module, the primary query pattern)
CREATE INDEX IF NOT EXISTS idx_decisions_file_path ON decisions(file_path);
CREATE INDEX IF NOT EXISTS idx_decisions_module    ON decisions(module);
CREATE INDEX IF NOT EXISTS idx_decisions_status    ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_agent_log_decision  ON agent_log(decision_id);
