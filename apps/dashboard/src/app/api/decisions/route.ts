import { NextResponse } from 'next/server';
import { getAllDecisions } from '@/lib/decisions';

// Reads `status` from the query string, so it must be rendered per-request
// rather than statically prerendered at build time.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const decisions = await getAllDecisions();
    const status = new URL(request.url).searchParams.get('status');
    const filtered = status
      ? decisions.filter((d) => d.status === status)
      : decisions;
    return NextResponse.json(filtered);
  } catch (err: any) {
    console.error('API Error /api/decisions:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch decisions' },
      { status: 500 }
    );
  }
}
