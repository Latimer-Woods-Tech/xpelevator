/**
 * GET /api/me/export — a self-service copy of the authenticated caller's OWN
 * personal data (issue #157, §10 DSR — the access half).
 *
 * The GDPR/CCPA data-subject *access* request, served without a human in the
 * loop: identity + own org context + every simulation session the caller ran
 * (transcript, per-turn telemetry, weighted scores), as a downloadable JSON
 * document. The deletion half and the retention *durations* remain a founder
 * policy gate (documented in `docs/PII_INVENTORY.md`); this route ships only
 * the read-only access capability, which needs no policy decision.
 *
 * Security + tenancy:
 *   - Authentication required: anon → 401 (the `/api/*` middleware matcher gates
 *     the path and `requireAuth` double-checks in the handler). Permanent live
 *     regression gate in `deploy.yml`.
 *   - Strictly self-scoped: sessions are filtered by the caller's OWN `user_id`
 *     (the `/api/simulations` member-branch filter). No id is accepted from the
 *     request, so a caller can only ever receive their own data — there is no
 *     cross-tenant read even for a non-admin.
 *   - Hidden-mechanic-safe: the projection (`buildDsrExport`) copies only the
 *     trainee-visible scenario name + description — a scenario's script / hidden
 *     hints / persona / objective (the operator's IP, protected from trainees in
 *     Phase 2) are never exported.
 *   - `Content-Disposition: attachment` + `Cache-Control: no-store` — a
 *     per-user download, never shared or cached.
 */
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import {
  buildDsrExport,
  dsrExportFilename,
  DSR_EXPORT_MAX_SESSIONS,
  type RawUserRow,
  type RawDsrOrgRow,
  type RawDsrSessionRow,
} from '@/lib/dsr-export';
import { errorFields, log, requestIdFrom } from '@/lib/log';

export async function GET(request: Request) {
  const requestId = requestIdFrom(request.headers);
  try {
    // Any authenticated user (ADMIN or MEMBER). Anon → AuthError(401).
    const { session } = await requireAuth(request);
    const user = session.user;

    // The caller's own `users` row (for account creation date). Read by the
    // caller's OWN dbUserId/email — never an id from the request.
    let userRow: RawUserRow | null = null;
    if (user.dbUserId) {
      const rows = await sql`
        SELECT created_at AS "createdAt"
        FROM users
        WHERE id = ${user.dbUserId}
        LIMIT 1
      `;
      if (rows.length > 0) userRow = rows[0] as RawUserRow;
    }

    // The caller's own org context (brand-safe subset), by their OWN orgId.
    let orgRow: RawDsrOrgRow | null = null;
    if (user.orgId) {
      const rows = await sql`
        SELECT id, name, slug, plan, kind
        FROM organizations
        WHERE id = ${user.orgId}
        LIMIT 1
      `;
      if (rows.length > 0) orgRow = rows[0] as RawDsrOrgRow;
    }

    // The caller's OWN sessions only — scoped by user_id, exactly like the
    // `/api/simulations` GET member branch. The scenario is reduced to its
    // trainee-visible name + description here in SQL (no `script` column), so
    // the operator's hidden mechanics never enter the export. `+ 1` on the cap
    // lets the projection detect (and flag) truncation without a second query.
    const sessionRows = (await sql`
      SELECT
        ss.id,
        ss.type,
        ss.status,
        ss.scoring_status AS "scoringStatus",
        ss.started_at     AS "startedAt",
        ss.ended_at       AS "endedAt",
        ss.created_at     AS "createdAt",
        s.name            AS "scenarioName",
        s.description     AS "scenarioDescription",
        jt.name           AS "jobTitleName",
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'role', cm.role,
                'content', cm.content,
                'timestamp', cm.timestamp,
                'ttftMs', cm.ttft_ms,
                'totalMs', cm.total_ms,
                'latencyTier', cm.latency_tier,
                'model', cm.model,
                'promptTokens', cm.prompt_tokens,
                'completionTokens', cm.completion_tokens,
                'totalTokens', cm.total_tokens
              ) ORDER BY cm.timestamp
            )
            FROM chat_messages cm
            WHERE cm.session_id = ss.id
          ),
          '[]'
        ) AS messages,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'criterion', c.name,
                'category', c.category,
                'weight', c.weight,
                'score', sc.score,
                'feedback', sc.feedback
              ) ORDER BY sc.scored_at
            )
            FROM scores sc
            LEFT JOIN criteria c ON c.id = sc.criteria_id
            WHERE sc.session_id = ss.id
          ),
          '[]'
        ) AS scores
      FROM simulation_sessions ss
      LEFT JOIN scenarios s ON s.id = ss.scenario_id
      LEFT JOIN job_titles jt ON jt.id = ss.job_title_id
      WHERE ss.user_id = ${user.id}
      ORDER BY ss.created_at DESC
      LIMIT ${DSR_EXPORT_MAX_SESSIONS + 1}
    `) as RawDsrSessionRow[];

    const generatedAt = new Date().toISOString();
    const doc = buildDsrExport(user, userRow, orgRow, sessionRows, generatedAt);

    return NextResponse.json(doc, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${dsrExportFilename(generatedAt)}"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    log('error', 'me_export.failed', { requestId, ...errorFields(error) });
    return NextResponse.json(
      { error: 'Failed to build data export' },
      { status: 500 }
    );
  }
}
