/**
 * prFetcher.ts
 * Fetches merged PRs + metadata + changed files from GitHub via Octokit.
 * Returns a typed RawPR[] — no LLM calls here, only GitHub API.
 */

import { Octokit } from '@octokit/rest';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A PR review summary — APPROVED / CHANGES_REQUESTED / COMMENTED + its text. Highest signal. */
export interface Review {
  state: string;    // e.g. "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED"
  author: string;
  body: string;
}

/** An inline code-review comment, with the file it was left on for context. */
export interface ReviewComment {
  author: string;
  path: string;     // File path the comment is anchored to
  body: string;
}

/** A general PR discussion-thread comment. */
export interface IssueComment {
  author: string;
  body: string;
}

export interface RawPR {
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
  mergedAt: string;         // ISO 8601
  comments: string[];       // Legacy flattened bodies (PR + review comments) — used by the signal scanner
  changedFiles: string[];   // File paths that were modified in this PR
  reviews: Review[];               // Review verdicts + bodies (bot-filtered)
  reviewComments: ReviewComment[]; // Inline code comments (bot-filtered)
  issueComments: IssueComment[];   // Discussion-thread comments (bot-filtered)
}

// ─── Bot / noise filtering ──────────────────────────────────────────────────

const BOT_LOGINS = new Set(['dependabot', 'github-actions', 'renovate', 'codecov', 'snyk-bot']);

/** Drop automated accounts so their boilerplate never reaches the extractor LLM. */
function isBot(username?: string | null): boolean {
  if (!username) return false;
  return username.includes('[bot]') || BOT_LOGINS.has(username);
}

const MIN_COMMENT_CHARS = 20; // Skip trivial "LGTM"/"+1" noise before the LLM

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
      // Small buffer between PRs — each PR now costs 4 extra API calls, so a run
      // can fire a few hundred requests. Well under GitHub's 5000/hr, but polite.
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Reviews (verdict + body) are the highest-signal source — the rationale a
      // senior dev wrote when approving or requesting changes. Fetch all four
      // endpoints in parallel.
      const [prCommentsRes, reviewCommentsRes, reviewsRes, filesRes] = await Promise.all([
        octokit.issues.listComments({ owner, repo, issue_number: pr.number, per_page: 50 }),
        octokit.pulls.listReviewComments({ owner, repo, pull_number: pr.number, per_page: 50 }),
        octokit.pulls.listReviews({ owner, repo, pull_number: pr.number, per_page: 50 }),
        octokit.pulls.listFiles({ owner, repo, pull_number: pr.number, per_page: 100 }),
      ]);

      const prComments = prCommentsRes.data;
      const reviewCommentsRaw = reviewCommentsRes.data;

      // Legacy flattened bodies — kept intact so the signal scanner (updater.ts)
      // keeps working unchanged.
      const allComments = [
        ...prComments.map((c) => c.body ?? ''),
        ...reviewCommentsRaw.map((c) => c.body ?? ''),
      ].filter((body) => body.trim().length > 0);

      // Structured, bot-filtered context for the extractor.
      const reviews: Review[] = reviewsRes.data
        .filter((r) => !!r.body && r.body.trim().length > MIN_COMMENT_CHARS && !isBot(r.user?.login))
        .map((r) => ({
          state: r.state ?? 'COMMENTED',
          author: r.user?.login ?? 'unknown',
          body: r.body as string,
        }));

      const reviewComments: ReviewComment[] = reviewCommentsRaw
        .filter((c) => c.body.trim().length > MIN_COMMENT_CHARS && !isBot(c.user?.login))
        .map((c) => ({
          author: c.user?.login ?? 'unknown',
          path: c.path,
          body: c.body,
        }));

      const issueComments: IssueComment[] = prComments
        .filter((c) => (c.body ?? '').trim().length > MIN_COMMENT_CHARS && !isBot(c.user?.login))
        .map((c) => ({
          author: c.user?.login ?? 'unknown',
          body: c.body as string,
        }));

      const changedFiles = filesRes.data.map((f) => f.filename);

      result.push({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? '',
        author: pr.user?.login ?? 'unknown',
        url: pr.html_url,
        mergedAt: pr.merged_at as string, // We filtered for non-null above
        comments: allComments,
        changedFiles,
        reviews,
        reviewComments,
        issueComments,
      });

      console.log(
        `   ✓ PR #${pr.number}: "${pr.title}" (${changedFiles.length} files, ` +
          `${reviews.length} reviews, ${reviewComments.length + issueComments.length} comments)`
      );
    } catch (err) {
      console.warn(`   ⚠ Failed to fetch details for PR #${pr.number}:`, err);
      // Don't fail the whole run for one bad PR
    }
  }

  return result;
}
