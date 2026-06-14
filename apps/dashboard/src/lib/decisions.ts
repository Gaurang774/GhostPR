import { getDb } from '@/lib/db';
import type { Decision, AgentAction } from '@GhostPR/shared-types';

function queryAll(db: any, sql: string, params: Record<string, any> = {}): any[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(db: any, sql: string, params: Record<string, any> = {}): any | null {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function mapAgentLog(db: any, decisionId: string): AgentAction[] {
  const logRows = queryAll(
    db,
    `SELECT action, timestamp, result FROM agent_log WHERE decision_id = :id ORDER BY timestamp DESC`,
    { ':id': decisionId }
  );
  return logRows.map((log) => ({
    action: log.action as any,
    timestamp: log.timestamp,
    result: log.result,
  }));
}

function mapDecision(db: any, row: any): Decision {
  return {
    id: row.id,
    filePath: row.file_path,
    module: row.module,
    summary: row.summary,
    reason: row.reason,
    result: row.result,
    lesson: row.lesson,
    confidence: row.confidence,
    status: row.status as any,
    created: row.created,
    lastValidated: row.last_validated,
    source: {
      type: row.source_type as any,
      url: row.source_url,
      author: row.source_author,
      refNumber: row.source_ref,
    },
    agentLog: mapAgentLog(db, row.id),
  };
}

/**
 * Read all decisions directly from the database.
 * Used by both the /api/decisions route and server components (no HTTP self-fetch).
 */
export async function getAllDecisions(): Promise<Decision[]> {
  const db = await getDb();
  const decisionRows = queryAll(db, `SELECT * FROM decisions ORDER BY created DESC`);
  return decisionRows.map((row) => mapDecision(db, row));
}

/**
 * Read a single decision by ID directly from the database.
 * Returns null if not found.
 */
export async function getDecisionById(id: string): Promise<Decision | null> {
  const db = await getDb();
  const row = queryOne(db, `SELECT * FROM decisions WHERE id = :id`, { ':id': id });
  if (!row) return null;
  return mapDecision(db, row);
}
