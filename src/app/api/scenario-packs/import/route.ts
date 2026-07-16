import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import {
  getScenarioPack,
  buildPackImportPlan,
  packModalityProfile,
} from '@/lib/scenario-packs';

// POST /api/scenario-packs/import
// Body: { packId: string, dryRun?: boolean }
//
// Materialises a starter scenario-library pack (the public catalog inventory
// shipped in #55) into the CALLER'S org as org-scoped `job_titles` + `scenarios`
// rows — the half that makes the inventory actually *usable* (issue #16, Phase 4:
// "operators need sellable inventory on day one").
//
// Security + tenancy:
//   * ADMIN only (`requireAuth(_, ADMIN)`) — anon → 401, non-admin → 403.
//   * Strict org scoping — every row is stamped with the caller's `orgId`; an
//     admin with no org cannot import (400). No cross-tenant write is possible.
//   * The hidden-mechanic `script` (persona / objective / hints) is written
//     server-side into the org's private `scenarios` rows and is only ever
//     surfaced to that org's admins by the existing Phase-2 sanitizer — it is
//     never returned by this route or the public catalog (R-021).
//
// Idempotency + versioning (founder note on #55): the write is
// `ON CONFLICT DO NOTHING` against the org-scoped provenance indexes added in
// migration 20260712120000, so re-importing a pack never duplicates and never
// clobbers an operator's later edits — a pack imported for a client stays frozen
// even if the public starter pack later improves. `pack_version` is stamped so
// that drift is detectable in a future "upgrade pack" slice.
export async function POST(request: Request) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');
    const orgId = session.user.orgId;

    if (!orgId) {
      // A platform admin with no tenant has no workspace to import into. Import
      // is deliberately tenant-scoped, so refuse rather than write a global row.
      return NextResponse.json(
        { error: 'Import requires an org context; this admin has no org.' },
        { status: 400 },
      );
    }

    let body: { packId?: unknown; dryRun?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const packId = typeof body.packId === 'string' ? body.packId : '';
    if (!packId) {
      return NextResponse.json({ error: 'packId is required' }, { status: 400 });
    }

    const pack = getScenarioPack(packId);
    if (!pack) {
      return NextResponse.json({ error: `Unknown pack: ${packId}` }, { status: 404 });
    }

    const plan = buildPackImportPlan(pack, orgId);
    const profile = packModalityProfile(pack);

    // Dry-run preview — no writes. Lets an operator see the operational shape
    // (modality mix, latency risk, interruption handling) before committing a
    // pack to a client workspace, per the founder's cost-profile note.
    if (body.dryRun === true) {
      return NextResponse.json({
        dryRun: true,
        packId: pack.id,
        packName: pack.name,
        packVersion: plan.packVersion,
        role: pack.jobTitle.name,
        scenarioCount: plan.scenarios.length,
        profile,
        scenarios: plan.scenarios.map((s) => ({
          key: s.sourceScenarioKey,
          name: s.name,
          type: s.type,
        })),
      });
    }

    // 1. Find-or-create the pack's role (org-scoped). ON CONFLICT DO NOTHING on
    //    the org-scoped partial unique index, then read back the id on skip.
    const createdJob = await sql`
      INSERT INTO job_titles (id, org_id, name, description, source_pack_id, pack_version)
      VALUES (
        gen_random_uuid(),
        ${orgId},
        ${plan.jobTitle.name},
        ${plan.jobTitle.description},
        ${plan.jobTitle.sourcePackId},
        ${plan.jobTitle.packVersion}
      )
      ON CONFLICT (org_id, name) WHERE org_id IS NOT NULL DO NOTHING
      RETURNING id
    `;

    let jobTitleId: string;
    let jobTitleCreated: boolean;
    if (createdJob.length > 0) {
      jobTitleId = createdJob[0].id as string;
      jobTitleCreated = true;
    } else {
      const existing = await sql`
        SELECT id FROM job_titles WHERE org_id = ${orgId} AND name = ${plan.jobTitle.name} LIMIT 1
      `;
      if (existing.length === 0) {
        throw new Error('job title conflict but no existing row found');
      }
      jobTitleId = existing[0].id as string;
      jobTitleCreated = false;
    }

    // 2. Materialise each scenario under that role, idempotent on the pack
    //    scenario key. DO NOTHING → RETURNING is empty on a re-import skip.
    let created = 0;
    let skipped = 0;
    for (const s of plan.scenarios) {
      const r = await sql`
        INSERT INTO scenarios (
          id, org_id, job_title_id, name, description, type, script,
          source_pack_id, source_scenario_key, pack_version
        )
        VALUES (
          gen_random_uuid(),
          ${orgId},
          ${jobTitleId},
          ${s.name},
          ${s.description},
          ${s.type},
          ${JSON.stringify(s.script)},
          ${s.sourcePackId},
          ${s.sourceScenarioKey},
          ${s.packVersion}
        )
        ON CONFLICT (org_id, source_pack_id, source_scenario_key)
          WHERE source_pack_id IS NOT NULL AND org_id IS NOT NULL
          DO NOTHING
        RETURNING id
      `;
      if (r.length > 0) created += 1;
      else skipped += 1;
    }

    // 201 when anything new landed, 200 when the import was a full no-op re-run.
    const status = jobTitleCreated || created > 0 ? 201 : 200;
    return NextResponse.json(
      {
        packId: pack.id,
        packName: pack.name,
        packVersion: plan.packVersion,
        jobTitle: { id: jobTitleId, name: plan.jobTitle.name, created: jobTitleCreated },
        scenarios: { created, skipped, total: plan.scenarios.length },
        profile,
      },
      { status },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[scenario-packs/import] POST failed:', error);
    return NextResponse.json({ error: 'Failed to import pack' }, { status: 500 });
  }
}
