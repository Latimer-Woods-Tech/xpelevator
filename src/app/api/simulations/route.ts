import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';


// Start a new simulation session
export async function POST(request: Request) {
  try {
    // auth() is best-effort — a missing AUTH_SECRET should not block simulation creation
    const session = await auth().catch(() => null);
    const body = await request.json();
    const { jobTitleId, scenarioId, type } = body;

    // Use the authenticated user's id if available; fall back to body for anonymous/guest sessions
    const userId: string | null = session?.user?.id ?? body.userId ?? null;

    // PrismaNeonHTTP does not support implicit transactions triggered by create+include.
    // Create plain, then fetch relations separately (same pattern used in scenarios/route.ts).
    // Resolve the DB User id if available (populated for OAuth users via auth.ts signIn callback)
    const dbUserId: string | null = (session?.user as { dbUserId?: string } | undefined)?.dbUserId ?? null;

    const created = await prisma.simulationSession.create({
      data: {
        jobTitleId,
        scenarioId,
        type: type as 'PHONE' | 'CHAT' | 'VOICE',
        status: 'IN_PROGRESS',
        userId,
        dbUserId,
        startedAt: new Date(),
      },
    });
    const newSession = await prisma.simulationSession.findUnique({
      where: { id: created.id },
      include: { scenario: true, jobTitle: true },
    });

    return NextResponse.json(newSession, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to create simulation:', msg);
    return NextResponse.json(
      { error: 'Failed to create simulation', detail: process.env.NODE_ENV !== 'production' ? msg : undefined },
      { status: 500 }
    );
  }
}

// List simulation sessions
export async function GET(request: Request) {
  try {
    const session = await auth().catch(() => null);
    const { searchParams } = new URL(request.url);

    // Authenticated user sees only their sessions; anonymous query falls back to userId param
    const userId = session?.user?.id ?? searchParams.get('userId');

    const sessions = await prisma.simulationSession.findMany({
      where: userId ? { userId } : undefined,
      include: {
        scenario: true,
        jobTitle: true,
        scores: { include: { criteria: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(sessions);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to list simulations:', msg);
    return NextResponse.json(
      { error: 'Failed to list simulations', detail: process.env.NODE_ENV !== 'production' ? msg : undefined },
      { status: 500 }
    );
  }
}
