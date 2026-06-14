import { NextResponse } from 'next/server';
import { getDecisionById } from '@/lib/decisions';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const decision = await getDecisionById(id);

    if (!decision) {
      return NextResponse.json(
        { error: 'Decision not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(decision);
  } catch (err: any) {
    console.error(`API Error /api/decisions/${params?.id}:`, err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch decision' },
      { status: 500 }
    );
  }
}
