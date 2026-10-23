/**
 * embedder.ts — local sentence embeddings for the MCP server's semantic fallback.
 *
 * Mirrors the ingestion embedder (same model + pooling) so query vectors are
 * comparable to the vectors stored at ingest time.
 *
 * Protocol safety: this process speaks JSON-RPC over stdout, so NOTHING here may
 * write to stdout. We therefore (a) load @xenova/transformers lazily via dynamic
 * import — server startup never touches it — and (b) pass a no-op progress
 * callback so model-download progress is never printed. We deliberately do NOT
 * hijack process.stdout.write: the MCP SDK writes responses to stdout
 * concurrently, and redirecting it during an async model load would drop them.
 */

const MODEL = 'Xenova/all-MiniLM-L6-v2';

let embedderPromise: Promise<any> | null = null;

async function getEmbedder(): Promise<any> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', MODEL, { progress_callback: () => {} });
    })().catch((err) => {
      // Reset so a later call can retry (e.g. transient model-download failure).
      embedderPromise = null;
      throw err;
    });
  }
  return embedderPromise;
}

/** Embed an arbitrary text into a normalized vector. */
export async function embedText(text: string): Promise<number[]> {
  const embed = await getEmbedder();
  const output: any = await embed(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

/** Cosine similarity between two equal-length vectors (0 if degenerate). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
