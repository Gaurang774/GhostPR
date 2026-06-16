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

const MAX_CONTEXT_CHARS = 6000; // ~1500 tokens — keeps Groq calls cheap and fast

/**
 * Assemble the PR context block fed to the LLM. Sections are ordered by signal
 * strength (reviews first) and each item is individually truncated, so a hard
 * overall cap never slices through the middle of a single review/comment.
 * Empty sections are omitted — a PR with no reviews/comments degrades cleanly to
 * just title + description + changed files (same as the pre-comment behaviour).
 */
function buildPRContext(pr: RawPR): string {
  const sections: string[] = [];

  sections.push(`PR #${pr.number}: ${pr.title}`);
  sections.push(`Author: @${pr.author}`);

  if (pr.body.trim()) {
    sections.push(`Description:\n${pr.body.slice(0, 1000)}`);
  }

  if (pr.changedFiles.length > 0) {
    sections.push(`Changed Files:\n${pr.changedFiles.slice(0, 20).join('\n')}`);
  }

  if (pr.reviews.length > 0) {
    const text = pr.reviews
      .slice(0, 10)
      .map((r) => `[${r.state} by @${r.author}]\n${r.body.slice(0, 500)}`)
      .join('\n\n');
    sections.push(`PR Reviews:\n${text}`);
  }

  if (pr.reviewComments.length > 0) {
    const text = pr.reviewComments
      .slice(0, 10) // cap inline comments
      .map((c) => `[@${c.author} on ${c.path}]\n${c.body.slice(0, 300)}`)
      .join('\n\n');
    sections.push(`Inline Comments:\n${text}`);
  }

  if (pr.issueComments.length > 0) {
    const text = pr.issueComments
      .slice(0, 10)
      .map((c) => `[@${c.author}]\n${c.body.slice(0, 400)}`)
      .join('\n\n');
    sections.push(`Discussion:\n${text}`);
  }

  return sections.join('\n\n---\n\n').slice(0, MAX_CONTEXT_CHARS);
}

function buildPrompt(pr: RawPR): string {
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

When review comments or discussion conflict with the PR description, prefer the reasoning in the reviews/inline comments — they represent the considered technical judgment reached during code review, whereas the description is often written before that discussion.

---
${buildPRContext(pr)}`;
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
