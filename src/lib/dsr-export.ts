/**
 * Data-subject-access export projection (issue #157, §10 DSR — access half).
 *
 * Backs `GET /api/me/export`: a self-service copy of the authenticated caller's
 * OWN personal data — their identity, their org context, and every simulation
 * session they ran (with the transcript, per-turn telemetry, and scores). This
 * is the GDPR/CCPA "give me my data" access request, served without a human in
 * the loop. The deletion half and the retention *durations* stay a founder
 * policy gate (documented in `docs/PII_INVENTORY.md`); this module ships only
 * the read-only access capability, which needs no policy decision.
 *
 * Security contract — the same discipline as `self-context.ts` / `branding.ts`:
 *   - Strictly SELF-scoped. The route filters sessions by the caller's OWN
 *     `user_id`; nothing here accepts an id from the request, so a caller can
 *     only ever receive their own data — there is no cross-tenant surface even
 *     without an admin role.
 *   - Every field is copied EXPLICITLY, never spread. A scenario carries hidden
 *     mechanics (script / persona / hidden hints / customer objective) that the
 *     Phase-2 hardening keeps from trainees; those are the operator's IP, not
 *     the data subject's personal data, so they are deliberately NOT projected
 *     here even if a raw row carries them. Only the trainee-visible scenario
 *     name + description survive. A new sensitive column added upstream can
 *     never leak through this projection.
 *
 * Pure + dependency-free so it is unit-testable without NextAuth / Neon imports
 * and a single source of truth backs the route.
 */

/**
 * Defensive upper bound on sessions in one export. A single trainee's session
 * count is already bounded by the per-user daily cap (`MAX_SESSIONS_PER_DAY`),
 * so this is far above any real data subject; it exists only so a pathological
 * account can never produce an unbounded Worker response. When it engages the
 * export marks itself `truncated: true` so the cap is never silent.
 */
export const DSR_EXPORT_MAX_SESSIONS = 1000;

/** The data subject's own identity — no tokens, no secrets. */
export interface DsrUser {
  id: string;
  email: string | null;
  name: string | null;
  role: 'ADMIN' | 'MEMBER';
  orgId: string | null;
  createdAt: string | null;
}

/** The caller's OWN org context (brand-safe subset), or null when they have no org. */
export interface DsrOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  kind: string;
}

/** One weighted criterion score attached to a session. */
export interface DsrScore {
  criterion: string | null;
  category: string | null;
  weight: number | null;
  score: number | null;
  feedback: string | null;
}

/** One transcript turn plus its per-turn telemetry (R-066 / R-132). */
export interface DsrMessage {
  role: string;
  content: string;
  timestamp: string | null;
  ttftMs: number | null;
  totalMs: number | null;
  latencyTier: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

/** One of the data subject's own simulation sessions. */
export interface DsrSession {
  id: string;
  type: string | null;
  status: string | null;
  scoringStatus: string | null;
  scenario: string | null;
  scenarioDescription: string | null;
  jobTitle: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  messages: DsrMessage[];
  scores: DsrScore[];
}

/** The `GET /api/me/export` document. */
export interface DsrExport {
  /** Constant marker so a consumer can recognise the artifact + its schema. */
  export: {
    kind: 'xpelevator-data-subject-export';
    version: 1;
    generatedAt: string;
    /** True when the session list hit `DSR_EXPORT_MAX_SESSIONS` and was capped. */
    truncated: boolean;
  };
  user: DsrUser;
  org: DsrOrg | null;
  sessions: DsrSession[];
}

/** The minimal caller shape carried by the authenticated session. */
export interface DsrUserInput {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: 'ADMIN' | 'MEMBER';
  orgId?: string | null;
}

/** A raw `users` row as read for the caller's own record (extra columns dropped). */
export interface RawUserRow {
  createdAt?: string | Date | null;
}

/** A raw `organizations` row for the caller's own org (extra columns dropped). */
export interface RawDsrOrgRow {
  id: string;
  name: string;
  slug: string;
  plan?: string | null;
  kind?: string | null;
}

/** A raw session row (already json-shaped by the route query). Extra fields —
 * notably any scenario `script`/hidden mechanics — are deliberately dropped. */
export interface RawDsrSessionRow {
  id: string;
  type?: string | null;
  status?: string | null;
  scoringStatus?: string | null;
  scenarioName?: string | null;
  scenarioDescription?: string | null;
  jobTitleName?: string | null;
  startedAt?: string | Date | null;
  endedAt?: string | Date | null;
  createdAt?: string | Date | null;
  messages?: unknown;
  scores?: unknown;
}

/** Normalize a timestamp-ish value to an ISO string (or null). */
function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Normalize a numeric-ish value to a finite number (or null). */
function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a string-ish value (or null). */
function toStr(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

/** Project one transcript turn, copying only the trainee-owned fields. */
function toMessage(raw: unknown): DsrMessage {
  const m = (raw ?? {}) as Record<string, unknown>;
  return {
    role: toStr(m.role) ?? 'UNKNOWN',
    content: toStr(m.content) ?? '',
    timestamp: toIso(m.timestamp),
    ttftMs: toNum(m.ttftMs),
    totalMs: toNum(m.totalMs),
    latencyTier: toStr(m.latencyTier),
    model: toStr(m.model),
    promptTokens: toNum(m.promptTokens),
    completionTokens: toNum(m.completionTokens),
    totalTokens: toNum(m.totalTokens),
  };
}

/** Project one weighted criterion score. */
function toScore(raw: unknown): DsrScore {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    criterion: toStr(s.criterion),
    category: toStr(s.category),
    weight: toNum(s.weight),
    score: toNum(s.score),
    feedback: toStr(s.feedback),
  };
}

/**
 * Project one of the caller's own sessions. Copies each field explicitly — the
 * scenario is reduced to its trainee-visible name + description, so a raw row
 * carrying `script` / hidden hints / persona / objective can never leak into a
 * data-subject export.
 */
function toSession(raw: RawDsrSessionRow): DsrSession {
  const messages = Array.isArray(raw.messages) ? raw.messages.map(toMessage) : [];
  const scores = Array.isArray(raw.scores) ? raw.scores.map(toScore) : [];
  return {
    id: raw.id,
    type: toStr(raw.type),
    status: toStr(raw.status),
    scoringStatus: toStr(raw.scoringStatus),
    scenario: toStr(raw.scenarioName),
    scenarioDescription: toStr(raw.scenarioDescription),
    jobTitle: toStr(raw.jobTitleName),
    startedAt: toIso(raw.startedAt),
    endedAt: toIso(raw.endedAt),
    createdAt: toIso(raw.createdAt),
    messages,
    scores,
  };
}

/**
 * Build the data-subject export document from the caller's own rows.
 *
 * @param user - the authenticated caller (self, never a request-supplied id)
 * @param userRow - the caller's own `users` row (for `createdAt`), or null
 * @param orgRow - the caller's own org row, or null (no org / platform admin)
 * @param sessionRows - the caller's own sessions (already scoped by `user_id`)
 * @param generatedAt - the export timestamp (injected — never `Date.now()` here)
 */
export function buildDsrExport(
  user: DsrUserInput,
  userRow: RawUserRow | null,
  orgRow: RawDsrOrgRow | null,
  sessionRows: RawDsrSessionRow[],
  generatedAt: string
): DsrExport {
  const role: 'ADMIN' | 'MEMBER' = user.role === 'ADMIN' ? 'ADMIN' : 'MEMBER';

  const truncated = sessionRows.length > DSR_EXPORT_MAX_SESSIONS;
  const bounded = truncated
    ? sessionRows.slice(0, DSR_EXPORT_MAX_SESSIONS)
    : sessionRows;

  const org: DsrOrg | null = orgRow
    ? {
        id: orgRow.id,
        name: orgRow.name,
        slug: orgRow.slug,
        plan: orgRow.plan ?? 'FREE',
        kind: orgRow.kind ?? 'STANDALONE',
      }
    : null;

  return {
    export: {
      kind: 'xpelevator-data-subject-export',
      version: 1,
      generatedAt,
      truncated,
    },
    user: {
      id: user.id,
      email: user.email ?? null,
      name: user.name ?? null,
      role,
      orgId: user.orgId ?? null,
      createdAt: toIso(userRow?.createdAt),
    },
    org,
    sessions: bounded.map(toSession),
  };
}

/** The download filename for an export generated at `generatedAt` (ISO). The
 * date prefix keeps successive exports distinguishable in a downloads folder. */
export function dsrExportFilename(generatedAt: string): string {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(generatedAt)?.[1] ?? 'export';
  return `xpelevator-data-export-${day}.json`;
}
