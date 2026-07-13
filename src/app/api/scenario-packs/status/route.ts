import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAuth, AuthError } from '@/lib/auth-api';
import {
  SCENARIO_PACKS,
  PACK_CATALOG_VERSION,
  computePackStatus,
  type StoredPackScenario,
} from '@/lib/scenario-packs';

// GET /api/scenario-packs/status
//
// ADMIN-only, strictly org-scoped read that reports, for every starter pack in
// the catalog, whether the CALLER'S org has imported it and whether an opt-in
// upgrade (R-054) is available. It is the read the admin "Scenario Packs"
// surface needs to render accurate per-pack actions (Import vs Upgrade) without
// probing each write route. It carries NO hidden mechanics — only import
// bookkeeping (counts + drift), never a scenario `script` (persona / objective /
// hints, R-021).
//
// Security + tenancy (mirrors the import/upgrade write routes):
//   * ADMIN only (`requireAuth(_, ADMIN)`) — anon → 401, non-admin → 403.
//   * Strict org scoping — the single provenance read is filtered by the
//     caller's `orgId`; an admin with no org has no workspace to import into (400).
//   * Gated by middleware: `/api/scenario-packs` is an EXACT public route, so
//     this `/status` subpath is NOT public — the /api/* matcher 401s anon first,
//     and the handler double-checks ADMIN + org scope.
export async function GET(request: Request) {
  try {
    const { session } = await requireAuth(request, 'ADMIN');
    const orgId = session.user.orgId;

    if (!orgId) {
      // A platform admin with no tenant has no workspace whose pack state to
      // report. Status is deliberately tenant-scoped, so refuse rather than
      // report a global (org-less) view.
      return NextResponse.json(
        { error: 'Pack status requires an org context; this admin has no org.' },
        { status: 400 },
      );
    }

    // One read of all the org's pack-provenanced scenario rows, grouped by pack
    // in JS. Only the idempotency key + stored version are needed — never the
    // hidden `script`.
    const rows = await sql`
      SELECT source_pack_id AS "sourcePackId",
             source_scenario_key AS "sourceScenarioKey",
             pack_version AS "packVersion"
      FROM scenarios
      WHERE org_id = ${orgId} AND source_pack_id IS NOT NULL
    `;

    const byPack = new Map<string, StoredPackScenario[]>();
    for (const r of rows as Array<Record<string, unknown>>) {
      const packId = r.sourcePackId as string;
      const list = byPack.get(packId) ?? [];
      list.push({
        sourceScenarioKey: r.sourceScenarioKey as string,
        packVersion: r.packVersion == null ? null : Number(r.packVersion),
      });
      byPack.set(packId, list);
    }

    const packs = SCENARIO_PACKS.map((pack) =>
      computePackStatus(pack, byPack.get(pack.id) ?? [], orgId),
    );

    return NextResponse.json(
      { catalogVersion: PACK_CATALOG_VERSION, packs },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[scenario-packs/status] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load pack status' }, { status: 500 });
  }
}
