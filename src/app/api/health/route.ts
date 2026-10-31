import { NextResponse } from 'next/server';
import { buildInfo } from '@/build-info';
import { getTelnyxReadiness } from '@/lib/telnyx';

// GET /api/health — returns which required env vars are present (without
// values) plus the build identity (commit SHA + build timestamp) stamped by
// deploy.yml, so "which build is production serving?" is answerable (G72).
//
// It also carries a non-secret `telephony` readiness block (booleans only)
// resolved through the SAME runtime resolvers the Telnyx webhook verifier uses
// (src/lib/telnyx.ts). This is the ONLY outside-observable signal that the
// webhook signing key is actually resolvable in the live worker: an unsigned
// black-box probe of /api/telnyx/webhook returns 401 whether the key is present
// or missing, so it cannot tell a healthy fail-closed from the #125 regression
// (key undefined in prod → every webhook rejected → phone modality dark). The
// uptime monitor asserts `telephony.publicKey` AND `telephony.apiKey` (the latter
// also unconditionally required: telnyxHeaders() throws without it, so a verified
// call still can't speak/listen) so a phone outage opens an alert in ≤15 min
// instead of going silent. It does NOT gate `ok`/the HTTP status — the
// core-loop readiness contract (and the deploy post-deploy gate) stays driven
// by the three required vars only.
export async function GET() {
  const vars = ['DATABASE_URL', 'AUTH_SECRET', 'GROQ_API_KEY'];
  const status: Record<string, boolean> = {};
  for (const v of vars) {
    status[v] = !!(process.env[v] && process.env[v]!.trim().length > 0);
  }
  const allOk = Object.values(status).every(Boolean);
  const telephony = getTelnyxReadiness();
  return NextResponse.json(
    { ok: allOk, commit: buildInfo.commit, builtAt: buildInfo.builtAt, env: status, telephony },
    { status: allOk ? 200 : 503 },
  );
}
