import { NextResponse } from 'next/server';
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

export async function GET() {
  try {
    const db = await getDb();

    // Query decisions
    const decisionRows = queryAll(
      db,
      `SELECT * FROM decisions ORDER BY created DESC`
    );

    const decisions: Decision[] = decisionRows.map((row) => {
      // Query agent log for this decision
      const logRows = queryAll(
        db,
        `SELECT action, timestamp, result FROM agent_log WHERE decision_id = :id ORDER BY timestamp DESC`,
        { ':id': row.id }
      );

      const agentLog: AgentAction[] = logRows.map((log) => ({
        action: log.action as any,
        timestamp: log.timestamp,
        result: log.result,
      }));

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
        agentLog,
      };
    });

    return NextResponse.json(decisions);
  } catch (err: any) {
    console.error('API Error /api/decisions:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch decisions' },
      { status: 500 }
    );
  }
}
