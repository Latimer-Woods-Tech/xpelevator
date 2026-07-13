import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import {
  getScenarioPack,
  buildPackUpgradePlan,
  packModalityProfile,
  PACK_CATALOG_VERSION,
  type StoredPackScenario,
} from '@/lib/scenario-packs';

// POST /api/scenario-packs/upgrade
// Body: { packId: string, dryRun?: boolean }
//
// The opt-in counterpart to the non-clobbering import (R-047). Import is
// frozen-by-default — re-importing never overwrites an operator's rows, so a pack
// materialised at version N stays at N even after the public catalog improves.
// Upgrade lets an ADMIN explicitly re-sync an ALREADY-IMPORTED pack to the
// current catalog version: stale rows (`pack_version` older than the catalog) are
// overwritten with the current content and stamped to the new version, catalog
// scenarios the org lacks are inserted (idempotent), and rows removed from the
// catalog are reported as orphaned but NEVER deleted (the operator may still be
// running them). Issue #16, Phase 4 (the "upgrade pack" slice the import route's
// `pack_version` stamp was designed for).
//
// Security + tenancy (mirrors the import route):
//   * ADMIN only (`requireAuth(_, ADMIN)`) — anon → 401, non-admin → 403.
//   * Strict org scoping — every read/write is filtered by the caller's `orgId`;
//     an admin with no org cannot upgrade (400). No cross-tenant write possible.
//   * Only pack-provenanced rows (`source_pack_id = packId`) are touched — a
//     hand-authored scenario is never overwritten by an upgrade.
export async function POST(request: Request) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');
    const orgId = session.user.orgId;

    if (!orgId) {
      return NextResponse.json(
        { error: 'Upgrade requires an org context; this admin has no org.' },
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

    // The org's currently-stored, pack-provenanced scenario rows (key + version).
    const storedRows = await sql`
      SELECT source_scenario_key AS "sourceScenarioKey", pack_version AS "packVersion"
      FROM scenarios
      WHERE org_id = ${orgId} AND source_pack_id = ${pack.id}
    `;
    const stored: StoredPackScenario[] = storedRows.map((r) => ({
      sourceScenarioKey: r.sourceScenarioKey as string,
      packVersion: r.packVersion == null ? null : Number(r.packVersion),
    }));

    // Never imported → nothing to upgrade. This is deliberately distinct from
    // import: a no-op 200 that guides the caller rather than silently importing.
    if (stored.length === 0) {
      return NextResponse.json(
        {
          packId: pack.id,
          packName: pack.name,
          imported: false,
          targetVersion: PACK_CATALOG_VERSION,
          message: 'This pack has not been imported into your workspace yet — import it first.',
        },
        { status: 200 },
      );
    }

    const plan = buildPackUpgradePlan(pack, stored, orgId);
    const profile = packModalityProfile(pack);

    // Dry-run preview — no writes. Shows the operator the exact drift (which
    // scenarios update / insert / stay unchanged / are orphaned) before committing.
    if (body.dryRun === true) {
      return NextResponse.json({
        dryRun: true,
        packId: pack.id,
        packName: pack.name,
        targetVersion: plan.targetVersion,
        counts: {
          update: plan.toUpdate.length,
          insert: plan.toInsert.length,
          unchanged: plan.unchangedKeys.length,
          orphaned: plan.orphanedKeys.length,
        },
        items: plan.items,
        profile,
      });
    }

    // 1. Overwrite each stale row with the current catalog content + new version.
    //    Tenant + provenance scoped, so only this org's pack rows are touched and
    //    a hand-authored scenario is never affected.
    let updated = 0;
    for (const s of plan.toUpdate) {
      const r = await sql`
        UPDATE scenarios SET
          name = ${s.name},
          description = ${s.description},
          type = ${s.type},
          script = ${JSON.stringify(s.script)},
          pack_version = ${s.packVersion}
        WHERE org_id = ${orgId}
          AND source_pack_id = ${s.sourcePackId}
          AND source_scenario_key = ${s.sourceScenarioKey}
        RETURNING id
      `;
      if (r.length > 0) updated += 1;
    }

    // 2. Insert catalog scenarios the org lacks (a newer version can add
    //    scenarios). Needs the pack's existing org-scoped role; resolve it once.
    //    Insert is idempotent on the same provenance index the import uses.
    let inserted = 0;
    if (plan.toInsert.length > 0) {
      const jobRows = await sql`
        SELECT id FROM job_titles
        WHERE org_id = ${orgId} AND source_pack_id = ${pack.id}
        LIMIT 1
      `;
      const jobTitleId = jobRows.length > 0 ? (jobRows[0].id as string) : null;
      if (jobTitleId) {
        for (const s of plan.toInsert) {
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
          if (r.length > 0) inserted += 1;
        }
      }
    }

    // 200 always — upgrade is a re-sync; when everything was already current the
    // result is a clean no-op (updated=0, inserted=0). Orphaned rows are reported
    // for the operator's awareness but are intentionally left in place.
    return NextResponse.json({
      packId: pack.id,
      packName: pack.name,
      imported: true,
      targetVersion: plan.targetVersion,
      scenarios: {
        updated,
        inserted,
        unchanged: plan.unchangedKeys.length,
        orphaned: plan.orphanedKeys.length,
        orphanedKeys: plan.orphanedKeys,
      },
      profile,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[scenario-packs/upgrade] POST failed:', error);
    return NextResponse.json({ error: 'Failed to upgrade pack' }, { status: 500 });
  }
}
