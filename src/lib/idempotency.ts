/**
 * DB-backed event-ID idempotency guard for inbound provider webhooks.
 *
 * Telnyx (and most Call Control / billing providers) deliver webhooks
 * AT-LEAST-ONCE: the same event — carrying a stable `data.id` — can arrive more
 * than once (a lost 200 ACK, an edge retry, a provider-side re-fanout). The
 * `/api/telnyx/webhook` handler returns 200 immediately and does its real work
 * in the background via `ctx.waitUntil`, so a duplicate delivery re-runs the
 * whole handler. On the phone path that means two `gather`/`speak` requests
 * racing on one live call (the "conflicting gather" bug documented at the top of
 * the webhook route — it can leave the line silent), a doubled model turn, or a
 * second scoring pass. A per-event-ID claim collapses every retry of one event
 * to a single execution.
 *
 * Claim-once semantics: the FIRST caller to insert the event id wins and runs
 * the handler; every later delivery of the same id finds the row already present
 * and is skipped. The claim is written to a shared Postgres row (Neon HTTP `sql`)
 * — authoritative across the many Worker isolates/colos a single account runs,
 * exactly like `src/lib/rate-limit.ts` and `src/lib/limits.ts` (an in-memory
 * Set would only dedupe within one isolate and silently leak duplicates).
 *
 * Fails OPEN by design: if the claim write throws (a transient DB blip) the
 * handler still runs. For a live call, DROPPING an event (fail closed) is the
 * worse failure — a missed `call.transcription` leaves the caller in silence —
 * so a DB hiccup must never swallow a real event. The cost of failing open is a
 * rare double-process on the exact overlap of a retry and a DB outage, which is
 * strictly better than a dead call. This mirrors the fail-open stance the rate
 * limiter takes for the same reason.
 *
 * The claim is taken BEFORE the handler runs (not after it succeeds): a retry
 * fires because the provider never saw our ACK, not because our processing
 * failed, and the handler is already best-effort (its errors are caught and
 * logged upstream, never surfaced to the caller). Claiming first is what
 * suppresses the racing-duplicate; it does not change the not-retried-on-failure
 * behaviour the route already had.
 */
import { sql as defaultSql } from '@/lib/db';

/** A neon-style tagged-template query function. */
export type SqlClient = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

export interface IdempotencyDeps {
  /** Injectable for tests; defaults to the real neon `sql` client. */
  sql?: SqlClient;
}

/**
 * Atomically claim `eventId`. Returns `true` when THIS caller is the first to
 * see the event (the handler should run) and `false` when the event was already
 * claimed (a duplicate — skip). The `ON CONFLICT DO NOTHING ... RETURNING`
 * insert is a single round-trip: a returned row means the insert took, an empty
 * result means the id already existed. Throws are the caller's to interpret
 * (`withIdempotency` treats them as fail-open).
 */
export async function claimEvent(eventId: string, sql: SqlClient): Promise<boolean> {
  const rows = await sql`
    INSERT INTO webhook_events (event_id, seen_at)
    VALUES (${eventId}, NOW())
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `;
  return rows.length > 0;
}

/**
 * Run `handler` at most once per `eventId`. A duplicate delivery of the same
 * event is skipped; a missing `eventId` (no key to dedupe on) or a DB error
 * during the claim both fall through to running the handler (fail open — see the
 * module header). Any error from `handler` itself propagates to the caller
 * unchanged; this guard only governs whether the handler runs, never how its
 * result is handled.
 *
 * Usage in the webhook route:
 *   await withIdempotency(body.data?.id, () => handleEvent(...));
 */
export async function withIdempotency(
  eventId: string | undefined | null,
  handler: () => Promise<void>,
  deps: IdempotencyDeps = {},
): Promise<void> {
  const sql = deps.sql ?? (defaultSql as unknown as SqlClient);

  // No stable id → nothing to dedupe on; process (fail open).
  if (!eventId) {
    await handler();
    return;
  }

  let firstSeen = true;
  try {
    firstSeen = await claimEvent(eventId, sql);
  } catch (err) {
    // Fail OPEN — a DB blip must never drop a live call event.
    console.error(`[idempotency] claim failed for "${eventId}", processing anyway:`, err);
    firstSeen = true;
  }

  if (!firstSeen) {
    console.log(`[idempotency] duplicate event skipped: ${eventId}`);
    return;
  }

  await handler();
}
