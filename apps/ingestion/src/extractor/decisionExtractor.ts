/**
 * decisionExtractor.ts
 * Converts a RawPR into a structured Decision via Groq LLM + Zod validation.
 * Returns null if the PR contains no architectural decision worth storing.
 *
 * Rules enforced:
 *   Rule 3  — Store decisions, not conversations
 *   Rule 8  — Outcome stored separately from decision
 *   Rule 9  — One responsibility per memory
 *   Rule 11 — Explain before warning (reason is always extracted)
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Decision } from '@GhostPR/shared-types';
import type { RawPR } from '../github/prFetcher.js';
import { callGroq } from './groqClient.js';

// ─── Zod schema for the LLM's JSON output ────────────────────────────────────

const ExtractedDecisionSchema = z.object({
  filePath: z.string().min(1, 'filePath must not be empty'),
  module: z.string().min(1, 'module must not be empty'),
  summary: z.string().min(10, 'summary must be at least 10 characters'),
  reason: z.string().min(10, 'reason must be at least 10 characters'),
  result: z.string().min(10, 'result must be at least 10 characters'),
  lesson: z.string().min(10, 'lesson must be at least 10 characters'),
});

type ExtractedDecision = z.infer<typeof ExtractedDecisionSchema>;

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(pr: RawPR): string {
  const filesText = pr.changedFiles.slice(0, 20).join('\n'); // Cap at 20 files for token efficiency
  // PR comments are chronological — keep the LAST 10 so the final, approved
  // reasoning survives the cap instead of early rejected suggestions (P1).
  const commentsText = pr.comments
    .slice(-10)
    .map((c, i) => `Comment ${i + 1}: ${c}`)
    .join('\n\n');

  // Truncate body to ~2000 chars to avoid token overflow
  const body = pr.body.length > 2000 ? pr.body.slice(0, 2000) + '...[truncated]' : pr.body;

  return `You are a decision extractor for a codebase memory system.

Given a GitHub PR, extract ONE architectural or technical decision that was made.

A decision MUST be one of:
- An architecture or design choice (e.g. "chose X over Y")
- A workaround with a documented reason (e.g. "patched X because Y doesn't support Z")
- An incident or postmortem outcome (e.g. "removed X after it caused Y in production")
- An explicit tradeoff that was consciously accepted

IGNORE these (return NO_DECISION):
- Casual chat, banter, or social comments
- Random code snippets without decision context
- Bug fixes without architectural significance
- Dependency version bumps with no explanation
- Typo/formatting fixes

Respond with ONLY valid JSON matching this exact shape — no markdown, no explanation:
{
  "filePath": "the single most relevant changed file path (e.g. auth/session.ts)",
  "module": "top-level module name derived from the file path (e.g. auth, payments, cache)",
  "summary": "one sentence: what was decided",
  "reason": "one sentence: why it was decided (the technical reason, not business reason)",
  "result": "one sentence: what actually happened as a result (outcome or expected outcome)",
  "lesson": "one sentence: what this teaches future developers working on this area"
}

If no architectural decision is present, respond with exactly: NO_DECISION

---
PR Title: ${pr.title}

PR Author: ${pr.author}

Comments (review + discussion — highest-signal reasoning):
${commentsText || '(no comments)'}

PR Body:
${body || '(no description provided)'}

Changed Files:
${filesText || '(no files listed)'}`;
}

// ─── Self-rating second pass (extraction quality gate) ───────────────────────

// Extractions scoring below this bar are discarded. Configurable so it can be
// tuned per repo without code changes; defaults to 0.6.
const EXTRACTION_SCORE_THRESHOLD = (() => {
  const v = parseFloat(process.env['EXTRACTION_CONFIDENCE_THRESHOLD'] ?? '');
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6;
})();

const ScoreSchema = z.object({
  score: z.number().min(0).max(1),
  verdict: z.string().optional(),
});

/**
 * Second LLM pass: rate how confidently the extracted record represents a REAL
 * architectural/technical decision faithfully grounded in the PR. This catches
 * cases where the first pass let a non-architectural PR through (routine fixes,
 * version bumps, fabricated reasoning).
 *
 * Returns a score in [0,1]. Fail-open: any API/parse error returns 1 so a flaky
 * rater never silently drops a legitimate decision.
 */
async function scoreExtraction(pr: RawPR, extracted: ExtractedDecision): Promise<number> {
  const prompt = `You are a strict quality auditor for a codebase decision memory system.
Given a GitHub PR and a decision record extracted from it, rate how confident you are that the record captures a REAL architectural or technical decision that is faithfully grounded in the PR — not invented, and not a trivial bugfix/typo/formatting/dependency bump dressed up as a decision.

Score rubric (0.0 - 1.0):
- 0.9-1.0: clearly an architectural/design decision, faithfully and specifically captured
- 0.6-0.8: a genuine technical decision but somewhat generic or partly inferred
- 0.3-0.5: weak — borderline significance, or loosely grounded in the PR
- 0.0-0.2: not a real decision (routine fix, formatting, version bump) or fabricated

PR Title: ${pr.title}
PR Body: ${(pr.body || '(none)').slice(0, 1500)}
Changed Files: ${pr.changedFiles.slice(0, 20).join(', ') || '(none)'}

Extracted Decision:
- summary: ${extracted.summary}
- reason: ${extracted.reason}
- result: ${extracted.result}

Respond with ONLY valid JSON, no markdown:
{ "score": 0.0, "verdict": "one short phrase" }`;

  let raw: string;
  try {
    raw = await callGroq(prompt);
  } catch (err) {
    console.warn(`   ⚠ PR #${pr.number}: extraction-scoring call failed — accepting by default:`, err);
    return 1;
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn(`   ⚠ PR #${pr.number}: extraction-scorer returned non-JSON — accepting by default`);
    return 1;
  }

  const v = ScoreSchema.safeParse(parsed);
  if (!v.success) {
    console.warn(`   ⚠ PR #${pr.number}: extraction-scorer output invalid — accepting by default`);
    return 1;
  }
  return v.data.score;
}

// ─── Extractor ────────────────────────────────────────────────────────────────

/**
 * Extract a Decision from a RawPR.
 * Returns null if no decision is found or if extraction fails validation.
 */
export async function extractDecision(pr: RawPR): Promise<Decision | null> {
  const prompt = buildPrompt(pr);

  let rawResponse: string;
  try {
    rawResponse = await callGroq(prompt);
  } catch (err) {
    console.warn(`   ⚠ Groq API error for PR #${pr.number}:`, err);
    return null;
  }

  // Check for explicit "no decision" signal
  if (rawResponse.trim().toUpperCase() === 'NO_DECISION') {
    return null;
  }

  // Strip any accidental markdown fences (```json ... ```)
  const cleaned = rawResponse
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn(`   ⚠ PR #${pr.number}: Groq returned non-JSON response:`, rawResponse.slice(0, 200));
    return null;
  }

  // Validate with Zod
  const validation = ExtractedDecisionSchema.safeParse(parsed);
  if (!validation.success) {
    console.warn(
      `   ⚠ PR #${pr.number}: Groq output failed Zod validation:`,
      validation.error.issues.map((i) => i.message).join(', ')
    );
    return null;
  }

  const extracted: ExtractedDecision = validation.data;

  // Second-pass self-rating: drop extractions that don't clear the quality bar.
  // Catches non-architectural PRs the first pass let through.
  const qualityScore = await scoreExtraction(pr, extracted);
  if (qualityScore < EXTRACTION_SCORE_THRESHOLD) {
    console.log(
      `   ⬜ PR #${pr.number}: extraction quality ${qualityScore.toFixed(2)} < ${EXTRACTION_SCORE_THRESHOLD} — discarding as low-confidence`
    );
    return null;
  }

  // Derive module from filePath if the LLM left module too generic
  const derivedModule = extracted.module.toLowerCase().trim();

  // Assemble the full Decision object
  const decision: Decision = {
    id: uuidv4(),
    filePath: extracted.filePath,
    module: derivedModule,
    summary: extracted.summary,
    reason: extracted.reason,
    result: extracted.result,
    lesson: extracted.lesson,
    source: {
      type: 'pr',
      url: pr.url,
      author: pr.author,
      refNumber: pr.number,
    },
    confidence: 0.9,          // Initial confidence — high trust for a fresh merged PR
    status: 'active',         // All new decisions start active
    created: new Date().toISOString(),
    lastValidated: null,       // Never validated yet
    agentLog: [],              // No agent interactions yet
  };

  return decision;
}
