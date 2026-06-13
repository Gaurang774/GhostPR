import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const SQL = await initSqlJs();
  const dbBuffer = readFileSync('../../data/GhostPR.db');
  const db = new SQL.Database(dbBuffer);
  
  const results = db.exec("SELECT id, file_path, module, summary, reason, result, lesson, confidence, status FROM decisions");
  if (results.length > 0) {
    const rows = results[0].values;
    console.log(`Found ${rows.length} decisions:`);
    for (const r of rows) {
      console.log(`- ID: ${r[0]}`);
      console.log(`  File: ${r[1]}`);
      console.log(`  Module: ${r[2]}`);
      console.log(`  Summary: ${r[3]}`);
      console.log(`  Reason: ${r[4]}`);
      console.log(`  Result: ${r[5]}`);
      console.log(`  Lesson: ${r[6]}`);
      console.log(`  Confidence: ${r[7]}`);
      console.log(`  Status: ${r[8]}`);
      console.log('---');
    }
  } else {
    console.log("No decisions found in decisions table.");
  }
}

main().catch(console.error);
