import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import { canReadResource } from '@/lib/tenant-guard';
import { errorFields, log, requestIdFrom } from '@/lib/log';

// POST /api/scenarios/[id]/duplicate
//
// Clone an existing scenario the caller can SEE into a fresh, hand-authored
// scenario owned by the caller's OWN org. This is the operator inventory lever
// (channel-first, #16 Phase 4 / P3a-8): an operator takes a starter/global
// scenario — or one of their own — and clones it as a private, editable copy to
// tailor per client, instead of re-typing persona/objective/hints by hand.
//
// Guarantees, mirroring the sibling scenario write paths:
//  - ADMIN only (anon → 401 at middleware + handler; non-admin → 403).
//  - Source must be VISIBLE to the caller (own-org OR global) via
//    `canReadResource` — you cannot clone another tenant's private scenario
//    (cross-tenant read IDOR → 403; unknown id → 404).
//  - The copy lands in the caller's OWN org (`org_id = userOrgId`), even when
//    the source is a global catalog row — that is exactly how an operator turns
//    the shared library into private inventory.
//  - The full script (persona / objective / hints) IS copied — the caller is an
//    ADMIN authoring their own scenario, the same trust level as PUT/POST.
//  - Pack provenance (`source_pack_id` / `source_scenario_key` / `pack_version`)
//    is deliberately RESET to NULL: a duplicate is a hand-authored scenario, not
//    a pack import. Copying it would (a) mislabel the copy as pack-managed so a
//    later "upgrade pack" (R-054) would clobber the operator's edits, and (b)
//    collide with the partial-unique index `scenarios_org_pack_scenario_key`
//    (org_id, source_pack_id, source_scenario_key) when the source was itself an
//    import — the INSERT would fail. Omitting the columns leaves them NULL.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');
    const userOrgId = session.user.orgId;

    const { id } = await params;

    const sourceRows = await sql`
      SELECT
        org_id as "orgId",
        job_title_id as "jobTitleId",
        name,
        description,
        type,
        script
      FROM scenarios
      WHERE id = ${id}
    `;
    if (sourceRows.length === 0) {
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
    }
    const source = sourceRows[0] as {
      orgId: string | null;
      jobTitleId: string;
      name: string;
      description: string | null;
      type: string;
      script: unknown;
    };

    // Tenant scope: only a scenario the caller can READ (own-org OR global) may
    // be cloned. Without this an admin could clone another tenant's private
    // scenario — the same cross-tenant read the GET path guards.
    if (!canReadResource(source.orgId, userOrgId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [scenario] = await sql`
      INSERT INTO scenarios (
        id,
        job_title_id,
        name,
        description,
        type,
        script,
        org_id
      )
      VALUES (
        gen_random_uuid(),
        ${source.jobTitleId},
        ${`${source.name} (copy)`},
        ${source.description ?? null},
        ${source.type},
        ${JSON.stringify(source.script ?? {})},
        ${userOrgId}
      )
      RETURNING
        id,
        job_title_id as "jobTitleId",
        name,
        description,
        type as "simulationType",
        script,
        org_id as "orgId",
        created_at as "createdAt"
    `;

    const [jobTitle] = await sql`
      SELECT id, name
      FROM job_titles
      WHERE id = ${source.jobTitleId}
    `;

    return NextResponse.json({ ...scenario, jobTitle }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const requestId = requestIdFrom(request.headers);
    log('error', 'scenarios.duplicate_failed', { requestId, ...errorFields(error) });
    return NextResponse.json({ error: 'Failed to duplicate scenario' }, { status: 500 });
  }
}
