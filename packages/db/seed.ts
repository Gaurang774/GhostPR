import { randomUUID } from 'crypto';
import type { Decision } from '@GhostPR/shared-types';

// Seed decisions for demo purposes.
// These represent real-looking architectural decisions with source citations.
// Rule 2: Every decision has a source. Rule 9: One decision per entry.

const getRelativeDateStr = (daysAgo: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
};

export const seedDecisions: Omit<Decision, 'agentLog'>[] = [];
