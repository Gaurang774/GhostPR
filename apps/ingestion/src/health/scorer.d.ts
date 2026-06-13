/**
 * scorer.ts
 * Computes confidence scores and health statuses for decisions.
 *
 * Rules enforced:
 *   Rule 7 — Every memory must expire (time-decay: active → questionable → deprecated)
 *   Rule 4 — Warning cards only at confidence > 0.75
 */
import type { Decision, HealthStatus } from '@GhostPR/shared-types';
/**
 * scoreNew — Returns the initial confidence and status for a brand-new decision.
 * New decisions extracted from merged PRs always start at INITIAL_CONFIDENCE.
 */
export declare function scoreNew(): {
    confidence: number;
    status: HealthStatus;
};
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
export declare function applyTimeDecay(decision: Decision, now?: Date): {
    confidence: number;
    status: HealthStatus;
};
/**
 * shouldShowWarning — True if the decision meets the confidence threshold for warning cards.
 * Rule 4: warn only if confidence > 0.75.
 */
export declare function shouldShowWarning(confidence: number): boolean;
//# sourceMappingURL=scorer.d.ts.map