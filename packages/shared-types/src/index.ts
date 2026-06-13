// GhostPR — Shared Types
// This file is the single source of truth for all data shapes.
// Do NOT add fields without updating schema.sql and seed.ts.

export type HealthStatus = 'active' | 'questionable' | 'deprecated';

export type AgentActionType = 'retrieved' | 'shown' | 'accepted' | 'ignored';

export interface AgentAction {
  action: AgentActionType;
  timestamp: string;  // ISO 8601
  result: string;     // e.g. "agent proceeded without modification"
}

export interface DecisionSource {
  type: 'pr' | 'issue';
  url: string;        // Full GitHub URL e.g. https://github.com/org/repo/pull/143
  author: string;     // GitHub username
  refNumber: number;  // PR or issue number
}

export interface Decision {
  id: string;                    // UUID v4
  filePath: string;              // e.g. "auth/session.ts"
  module: string;                // e.g. "auth"
  summary: string;               // What was decided (one sentence)
  reason: string;                // Why it was decided
  result: string;                // What actually happened (outcome)
  lesson: string;                // What this teaches future decisions
  source: DecisionSource;
  confidence: number;            // 0.0 – 1.0 (warn cards only shown if > 0.75)
  status: HealthStatus;
  created: string;               // ISO 8601
  lastValidated: string | null;  // ISO 8601 or null if never validated
  agentLog: AgentAction[];
}

// MCP tool input shape — enforced by Zod in mcp-server
export interface GetFileDecisionsInput {
  file: string;    // e.g. "auth/session.ts"
  module: string;  // e.g. "auth"
  intent: string;  // e.g. "edit" | "review" | "refactor"
}

// Warning card shape — what MCP injects into the AI's context window
export interface WarningCard {
  decisionId: string;
  filePath: string;
  summary: string;
  reason: string;
  result: string;
  lesson: string;
  confidence: number;
  status: HealthStatus;
  source: DecisionSource;
  isHighConfidence: boolean; // true if confidence > 0.75
}
