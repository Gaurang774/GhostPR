/**
 * prFetcher.ts
 * Fetches merged PRs + metadata + changed files from GitHub via Octokit.
 * Returns a typed RawPR[] — no LLM calls here, only GitHub API.
 */

import { Octokit } from '@octokit/rest';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawPR {
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
  mergedAt: string;         // ISO 8601
  comments: string[];       // All comment bodies (PR comments + review comments)
  changedFiles: string[];   // File paths that were modified in this PR
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

export async function fetchMergedPRs(options: {
  token: string;
  owner: string;
  repo: string;
  limit?: number;
}): Promise<RawPR[]> {
  const { token, owner, repo, limit = 20 } = options;

  const octokit = new Octokit({ auth: token });

  console.log(`🐙 Fetching up to ${limit} merged PRs from ${owner}/${repo}...`);

  // GitHub has no direct "merged" filter — we list closed PRs and keep the ones
  // with a non-null merged_at. A single page is not enough: an active repo can
  // have many closed-but-unmerged PRs (dependabot closures, declined PRs) at the
  // top, so we paginate until we've collected `limit` merged PRs (or run out /
  // hit a safety cap on pages scanned).
  const MAX_PAGES = 10; // up to 1000 closed PRs scanned — plenty for any limit
  const mergedPRs: Array<Awaited<ReturnType<typeof octokit.pulls.list>>['data'][number]> = [];

  for (let page = 1; page <= MAX_PAGES && mergedPRs.length < limit; page++) {
    const { data: pullRequests } = await octokit.pulls.list({
      owner,
      repo,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
      page,
    });

    if (pullRequests.length === 0) break; // no more closed PRs

    for (const pr of pullRequests) {
      if (pr.merged_at !== null) {
        mergedPRs.push(pr);
        if (mergedPRs.length >= limit) break;
      }
    }
  }

  console.log(`   Found ${mergedPRs.length} merged PRs to process`);

  const result: RawPR[] = [];

  for (const pr of mergedPRs) {
    try {
      // Fetch PR comments (top-level conversation comments)
      const { data: prComments } = await octokit.issues.listComments({
        owner,
        repo,
        issue_number: pr.number,
        per_page: 50,
      });

      // Fetch PR review comments (inline code comments)
      const { data: reviewComments } = await octokit.pulls.listReviewComments({
        owner,
        repo,
        pull_number: pr.number,
        per_page: 50,
      });

      // Fetch changed files
      const { data: files } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      });

      const allComments = [
        ...prComments.map((c) => c.body ?? ''),
        ...reviewComments.map((c) => c.body ?? ''),
      ].filter((body) => body.trim().length > 0);

      const changedFiles = files.map((f) => f.filename);

      result.push({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? '',
        author: pr.user?.login ?? 'unknown',
        url: pr.html_url,
        mergedAt: pr.merged_at as string, // We filtered for non-null above
        comments: allComments,
        changedFiles,
      });

      console.log(`   ✓ PR #${pr.number}: "${pr.title}" (${changedFiles.length} files)`);
    } catch (err) {
      console.warn(`   ⚠ Failed to fetch details for PR #${pr.number}:`, err);
      // Don't fail the whole run for one bad PR
    }
  }

  return result;
}
