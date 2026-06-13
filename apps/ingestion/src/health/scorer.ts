/**
 * scorer.ts
 * Computes confidence scores and health statuses for decisions.
 *
 * Rules enforced:
 *   Rule 7 — Every memory must expire (time-decay: active → questionable → deprecated)
 *   Rule 4 — Warning cards only at confidence > 0.75
 */

import type { Decision, HealthStatus } from '@GhostPR/shared-types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Initial confidence for a freshly extracted decision from a merged PR. */
const INITIAL_CONFIDENCE = 0.9;

/**
 * Decay constant k in: confidence = base * e^(-k * days)
 * k = 0.0020 → halves confidence every ~346 days.
 * At 90 days: ~0.9 * e^(-0.18) ≈ 0.75 (crosses active to questionable threshold)
 * At 549 days: ~0.9 * e^(-1.1) ≈ 0.30 (crosses questionable to deprecated threshold)
 */
const DECAY_K = 0.0020;

/** Status thresholds (Rule 7) */
const THRESHOLD_QUESTIONABLE = 0.75; // Below this (or equal) → questionable
const THRESHOLD_DEPRECATED = 0.3;   // Below this → deprecated

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(dateA: string, dateB: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.floor((new Date(dateB).getTime() - new Date(dateA).getTime()) / msPerDay));
}

function statusFromConfidence(confidence: number): HealthStatus {
  if (confidence >= THRESHOLD_QUESTIONABLE) return 'active';
  if (confidence >= THRESHOLD_DEPRECATED) return 'questionable';
  return 'deprecated';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * scoreNew — Returns the initial confidence and status for a brand-new decision.
 * New decisions extracted from merged PRs always start at INITIAL_CONFIDENCE.
 */
export function scoreNew(): { confidence: number; status: HealthStatus } {
  return {
    confidence: INITIAL_CONFIDENCE,
    status: 'active',
  };
}

/**
 * applyTimeDecay — Recalculates confidence for an existing decision based on age.
 * Uses exponential decay from the created date (or lastValidated if more recent).
 *
 * The 'lastValidated' date acts as a "reset anchor" — if a decision was recently
 * validated, decay is measured from that date instead of the creation date.
 *
 * @param decision - The existing decision to re-score
 * @param now - Reference date (defaults to today)
 * @returns Updated confidence and status
 */
export function applyTimeDecay(
  decision: Decision,
  now: Date = new Date()
): { confidence: number; status: HealthStatus } {
  // If decision is already manually deprecated, leave it alone
  if (decision.status === 'deprecated' && decision.confidence < THRESHOLD_DEPRECATED) {
    return { confidence: decision.confidence, status: 'deprecated' };
  }

  // Anchor: use lastValidated if it's more recent than created
  const anchorDate = decision.lastValidated
    ? new Date(decision.lastValidated) > new Date(decision.created)
      ? decision.lastValidated
      : decision.created
    : decision.created;

  const nowStr = now.toISOString();
  const ageDays = daysBetween(anchorDate, nowStr);

  // Exponential decay: confidence = INITIAL * e^(-k * days)
  // We decay from the stored confidence to avoid compounding on re-runs
  const decayed = INITIAL_CONFIDENCE * Math.exp(-DECAY_K * ageDays);

  // Clamp to [0, 1]
  const confidence = Math.max(0, Math.min(1, parseFloat(decayed.toFixed(4))));
  const status = statusFromConfidence(confidence);

  return { confidence, status };
}

/**
 * shouldShowWarning — True if the decision meets the confidence threshold for warning cards.
 * Rule 4: warn only if confidence > 0.75.
 */
export function shouldShowWarning(confidence: number): boolean {
  return confidence > 0.75;
}
