import { NextResponse } from 'next/server';
import { getAllDecisions } from '@/lib/decisions';

export async function GET() {
  try {
    const decisions = await getAllDecisions();
    return NextResponse.json(decisions);
  } catch (err: any) {
    console.error('API Error /api/decisions:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch decisions' },
      { status: 500 }
    );
  }
}
