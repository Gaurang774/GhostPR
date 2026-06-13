import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { Decision, AgentAction } from '@GhostPR/shared-types';

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

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const db = await getDb();

    // Query single decision
    const row = queryOne(
      db,
      `SELECT * FROM decisions WHERE id = :id`,
      { ':id': id }
    );

    if (!row) {
      return NextResponse.json(
        { error: 'Decision not found' },
        { status: 404 }
      );
    }

    // Query agent log for this decision
    const logRows = queryAll(
      db,
      `SELECT action, timestamp, result FROM agent_log WHERE decision_id = :id ORDER BY timestamp DESC`,
      { ':id': id }
    );

    const agentLog: AgentAction[] = logRows.map((log) => ({
      action: log.action as any,
      timestamp: log.timestamp,
      result: log.result,
    }));

    const decision: Decision = {
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
      agentLog,
    };

    return NextResponse.json(decision);
  } catch (err: any) {
    console.error(`API Error /api/decisions/${params?.id}:`, err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch decision' },
      { status: 500 }
    );
  }
}
