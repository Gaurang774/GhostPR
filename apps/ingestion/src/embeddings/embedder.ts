/**
 * embedder.ts — local sentence embeddings for semantic decision search.
 *
 * Uses @xenova/transformers (all-MiniLM-L6-v2) entirely in-process: no API key,
 * no per-call network. The ~23MB model is downloaded once to the HuggingFace
 * cache on first use, then served from disk.
 *
 * We embed a composite fingerprint (file + module + summary + reason) so a
 * decision still surfaces when its file is later renamed/moved — the MCP query
 * matches on semantic content, not an exact path.
 */

import { pipeline } from '@xenova/transformers';
import type { Decision } from '@GhostPR/shared-types';

const MODEL = 'Xenova/all-MiniLM-L6-v2';

// Lazily-initialised singleton — loading the model is expensive, do it once.
let embedderPromise: Promise<unknown> | null = null;

async function getEmbedder(): Promise<any> {
  if (!embedderPromise) {
    console.error(`🧠 Loading embedding model (${MODEL}) — first run downloads ~23MB...`);
    embedderPromise = pipeline('feature-extraction', MODEL);
  }
  return embedderPromise;
}

/** Embed an arbitrary text into a normalized vector. */
export async function embedText(text: string): Promise<number[]> {
  const embed = await getEmbedder();
  const output = await embed(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

/** Build the composite fingerprint string stored/embedded for a decision. */
export function buildDecisionFingerprint(decision: Decision): string {
  return [
    `file: ${decision.filePath}`,
    `module: ${decision.module}`,
    `summary: ${decision.summary}`,
    `reason: ${decision.reason}`,
  ].join('\n');
}

/** Generate the embedding vector for a decision's fingerprint. */
export async function embedDecision(decision: Decision): Promise<number[]> {
  return embedText(buildDecisionFingerprint(decision));
}
