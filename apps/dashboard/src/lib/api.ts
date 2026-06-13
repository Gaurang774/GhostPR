import type { Decision } from '@GhostPR/shared-types';

export async function fetchDecisions(): Promise<Decision[]> {
  // Use absolute URL on server, relative on client
  const baseUrl = typeof window === 'undefined' ? `http://localhost:${process.env.DASHBOARD_PORT || 3000}` : '';
  const res = await fetch(`${baseUrl}/api/decisions`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to fetch decisions');
  }
  return res.json();
}

export async function fetchDecision(id: string): Promise<Decision> {
  const baseUrl = typeof window === 'undefined' ? `http://localhost:${process.env.DASHBOARD_PORT || 3000}` : '';
  const res = await fetch(`${baseUrl}/api/decisions/${id}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch decision ${id}`);
  }
  return res.json();
}
