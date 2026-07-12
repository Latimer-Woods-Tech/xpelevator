import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canAccessSession } from '@/lib/session-access';


// Score a simulation session.
// ADMIN-only: scores feed analytics and the manager reports operators show
// their clients. Auto-scoring runs server-side (scoreSession); this manual
// endpoint exists for admin overrides — a trainee must never be able to
// write their own scores.
export async function POST(request: Request) {
  try {
    const { session: authSession } = await requireAuth(request, 'ADMIN');
    const userId = authSession.user.id;
    const userOrgId = authSession.user.orgId;
    const userRole = authSession.user.role;

    const body = await request.json();
    const { sessionId, scores } = body;

    if (typeof sessionId !== 'string' || !sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (
      !Array.isArray(scores) ||
      scores.length === 0 ||
      !scores.every(
        (s) =>
          s &&
          typeof s.criteriaId === 'string' &&
          typeof s.score === 'number' &&
          s.score >= 1 &&
          s.score <= 10 &&
          (s.feedback === undefined || typeof s.feedback === 'string')
      )
    ) {
      return NextResponse.json(
        { error: 'scores must be a non-empty array of { criteriaId, score (1-10), feedback? }' },
        { status: 400 }
      );
    }

    // Verify session exists and user has access
    const sessionResult = await sql`
      SELECT id, user_id as "userId", org_id as "orgId"
      FROM simulation_sessions
      WHERE id = ${sessionId}
      LIMIT 1
    `;
    const session = sessionResult.length > 0 ? {
      id: sessionResult[0].id as string,
      userId: sessionResult[0].userId as string | null,
      orgId: sessionResult[0].orgId as string | null,
    } : null;
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    // Multi-tenancy: user must own session or be admin in same org
    if (!canAccessSession(session, { id: userId, role: userRole, orgId: userOrgId })) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // scores: [{ criteriaId, score, feedback }]
    // Create scores in parallel
    const createdScores = await Promise.all(
      scores.map(async (s: { criteriaId: string; score: number; feedback?: string }) => {
        const result = await sql`
          INSERT INTO scores (id, session_id, criteria_id, score, feedback, scored_at)
          VALUES (gen_random_uuid(), ${sessionId}, ${s.criteriaId}, ${s.score}, ${s.feedback ?? null}, NOW())
          RETURNING id, session_id as "sessionId", criteria_id as "criteriaId", score, feedback, scored_at as "scoredAt"
        `;
        return result[0];
      })
    );

    // Mark session as completed
    await sql`
      UPDATE simulation_sessions
      SET status = 'COMPLETED', ended_at = NOW()
      WHERE id = ${sessionId}
    `;

    return NextResponse.json(createdScores, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to score simulation:', error);
    return NextResponse.json(
      { error: 'Failed to score simulation', detail: process.env.NODE_ENV !== 'production' ? msg : undefined },
      { status: 500 }
    );
  }
}
