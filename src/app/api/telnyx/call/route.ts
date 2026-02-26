
/**
 * POST /api/telnyx/call
 *
 * Initiates an outbound phone call for a PHONE-type simulation session.
 * The virtual customer AI will answer and conduct the scenario.
 *
 * Request body:
 *   sessionId  — the SimulationSession.id to associate the call with
 *   to         — E.164 phone number to dial, e.g. "+12125550100"
 *   from       — Your Telnyx number in E.164 (or use .env TELNYX_FROM_NUMBER)
 *
 * On success:
 *   Returns { callControlId, callLegId } and updates session status to IN_PROGRESS
 *
 * Prerequisites:
 *   - TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_WEBHOOK_URL set in .env
 *   - Session must exist and be of type PHONE
 */
import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { sql } from '@/lib/db';
import { initiateCall, encodeClientState } from '@/lib/telnyx';


export async function POST(request: Request) {
  try {
    const { sessionId, to, from } = (await request.json()) as {
      sessionId: string;
      to: string;
      from?: string;
    };

    if (!sessionId || !to) {
      return NextResponse.json({ error: 'sessionId and to are required' }, { status: 400 });
    }

    // Verify the session exists and is a PHONE type
    const sessionRows = await sql`
      SELECT 
        ss.id,
        ss.type,
        ss.scenario_id as "scenarioId",
        ss.job_title_id as "jobTitleId",
        json_build_object('id', s.id, 'name', s.name) as scenario,
        json_build_object('id', jt.id, 'name', jt.name) as "jobTitle"
      FROM simulation_sessions ss
      LEFT JOIN scenarios s ON s.id = ss.scenario_id
      LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
      WHERE ss.id = ${sessionId}
    `;

    if (sessionRows.length === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const session: any = sessionRows[0];
    if (session.type !== 'PHONE') {
      return NextResponse.json({ error: 'Session is not a PHONE type' }, { status: 400 });
    }

    // Encode session context into Telnyx client_state (threaded through all webhooks)
    const clientState = encodeClientState({
      sessionId: session.id,
      scenarioId: session.scenarioId,
      jobTitleId: session.jobTitleId,
      scenarioName: session.scenario.name,
    });

    // Resolve TELNYX_FROM_NUMBER at request time — process.env is inlined at
    // build time by webpack and won't carry CF runtime secrets.
    let callerNumber = from;
    if (!callerNumber) {
      try {
        const { env } = getCloudflareContext();
        callerNumber = (env as Record<string, string | undefined>).TELNYX_FROM_NUMBER;
      } catch {
        // local dev — fall through
      }
      callerNumber ??= process.env.TELNYX_FROM_NUMBER?.replace(/\r/g, '');
    }
    if (!callerNumber) {
      return NextResponse.json(
        { error: 'No from number — set TELNYX_FROM_NUMBER in .env or as a Cloudflare secret' },
        { status: 400 }
      );
    }

    const result = await initiateCall({ to, from: callerNumber, clientState });

    // Update session to IN_PROGRESS and store call metadata
    await sql`
      UPDATE simulation_sessions
      SET 
        status = 'IN_PROGRESS',
        started_at = NOW()
      WHERE id = ${sessionId}
    `;

    return NextResponse.json({
      callControlId: result.data.call_control_id,
      callLegId: result.data.call_leg_id,
      sessionId,
    });
  } catch (error) {
    console.error('Telnyx call initiation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initiate call' },
      { status: 500 }
    );
  }
}
