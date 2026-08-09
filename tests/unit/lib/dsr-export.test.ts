import { describe, it, expect } from 'vitest';
import {
  buildDsrExport,
  dsrExportFilename,
  DSR_EXPORT_MAX_SESSIONS,
  type RawDsrSessionRow,
} from '@/lib/dsr-export';

// Pure-projection tests for the data-subject export (issue #157, §10 DSR access
// half). The point of this suite is the SECURITY invariant: the projection must
// copy fields explicitly and never let a scenario's hidden mechanics
// (script / hints / persona / objective — the operator's IP, kept from trainees
// in Phase 2) leak into a data subject's own-data export. The route's live
// anon → 401 is a deploy gate; the DB-mocked route behaviour is in
// tests/unit/api/me-export.test.ts.

const GEN = '2026-08-09T15:04:05.000Z';

const user = {
  id: 'auth-user-1',
  email: 'trainee@acme.io',
  name: 'Tess Trainee',
  role: 'MEMBER' as const,
  orgId: 'org-acme',
};

describe('buildDsrExport — envelope + identity', () => {
  it('stamps the export marker and copies the caller identity explicitly', () => {
    const doc = buildDsrExport(
      user,
      { createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'org-acme', name: 'Acme', slug: 'acme', plan: 'ENTERPRISE', kind: 'OPERATOR' },
      [],
      GEN
    );
    expect(doc.export).toEqual({
      kind: 'xpelevator-data-subject-export',
      version: 1,
      generatedAt: GEN,
      truncated: false,
    });
    expect(doc.user).toEqual({
      id: 'auth-user-1',
      email: 'trainee@acme.io',
      name: 'Tess Trainee',
      role: 'MEMBER',
      orgId: 'org-acme',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    expect(doc.org).toEqual({
      id: 'org-acme',
      name: 'Acme',
      slug: 'acme',
      plan: 'ENTERPRISE',
      kind: 'OPERATOR',
    });
    expect(doc.sessions).toEqual([]);
  });

  it('null user row → createdAt null; null org → org null; unknown role → MEMBER', () => {
    const doc = buildDsrExport(
      { id: 'u', role: undefined },
      null,
      null,
      [],
      GEN
    );
    expect(doc.user.createdAt).toBeNull();
    expect(doc.user.email).toBeNull();
    expect(doc.user.name).toBeNull();
    expect(doc.user.orgId).toBeNull();
    expect(doc.user.role).toBe('MEMBER');
    expect(doc.org).toBeNull();
  });
});

describe('buildDsrExport — session + transcript projection', () => {
  const rawSession: RawDsrSessionRow & Record<string, unknown> = {
    id: 'sess-1',
    type: 'CHAT',
    status: 'COMPLETED',
    scoringStatus: 'SCORED',
    scenarioName: 'Angry churn caller',
    scenarioDescription: 'A long-time customer threatening to cancel.',
    jobTitleName: 'Support Rep',
    startedAt: '2026-08-01T10:00:00.000Z',
    endedAt: '2026-08-01T10:12:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    messages: [
      {
        role: 'USER',
        content: 'Hi, how can I help?',
        timestamp: '2026-08-01T10:00:05.000Z',
        ttftMs: null,
        totalMs: null,
        latencyTier: null,
        model: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
      {
        role: 'CUSTOMER',
        content: 'I want to cancel!',
        timestamp: '2026-08-01T10:00:09.000Z',
        ttftMs: 420,
        totalMs: 1100,
        latencyTier: 'acceptable',
        model: 'llama-3.3-70b',
        promptTokens: 512,
        completionTokens: 40,
        totalTokens: 552,
      },
    ],
    scores: [
      { criterion: 'Empathy', category: 'soft', weight: 2, score: 7, feedback: 'Good tone.' },
    ],
    // Hostile extra fields a raw row might carry — MUST NOT appear in output.
    script: 'HIDDEN: persona=furious; secret goal=get a refund',
    hints: ['do not offer a refund'],
    customerPersona: 'furious',
    customerObjective: 'extract a refund',
    orgId: 'org-acme',
    userId: 'auth-user-1',
  };

  it('projects the trainee-visible fields, telemetry, and scores', () => {
    const doc = buildDsrExport(user, null, null, [rawSession], GEN);
    expect(doc.sessions).toHaveLength(1);
    const s = doc.sessions[0];
    expect(s.id).toBe('sess-1');
    expect(s.scenario).toBe('Angry churn caller');
    expect(s.scenarioDescription).toBe('A long-time customer threatening to cancel.');
    expect(s.jobTitle).toBe('Support Rep');
    expect(s.messages).toHaveLength(2);
    expect(s.messages[1]).toMatchObject({
      role: 'CUSTOMER',
      content: 'I want to cancel!',
      totalTokens: 552,
      latencyTier: 'acceptable',
    });
    expect(s.scores[0]).toEqual({
      criterion: 'Empathy',
      category: 'soft',
      weight: 2,
      score: 7,
      feedback: 'Good tone.',
    });
  });

  // PROOF-OF-REJECTION (Standing Law 1): the projection must never leak hidden
  // scenario mechanics. Serialize the whole export and assert none of them
  // survive anywhere — if `toSession` ever spread the raw row, this fails.
  it('never leaks a scenario script / hidden hints / persona / objective', () => {
    const doc = buildDsrExport(user, null, null, [rawSession], GEN);
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain('HIDDEN');
    expect(serialized).not.toContain('secret goal');
    expect(serialized).not.toContain('do not offer a refund');
    expect(serialized).not.toContain('customerObjective');
    expect(serialized).not.toContain('customerPersona');
    expect(serialized).not.toContain('"script"');
    expect(serialized).not.toContain('"hints"');
    // The session object exposes exactly the whitelisted keys — nothing else.
    expect(Object.keys(doc.sessions[0]).sort()).toEqual(
      [
        'createdAt',
        'endedAt',
        'id',
        'jobTitle',
        'messages',
        'scenario',
        'scenarioDescription',
        'scores',
        'scoringStatus',
        'startedAt',
        'status',
        'type',
      ].sort()
    );
  });

  it('tolerates missing/non-array messages + scores', () => {
    const doc = buildDsrExport(
      user,
      null,
      null,
      [{ id: 'sess-2' } as RawDsrSessionRow],
      GEN
    );
    expect(doc.sessions[0].messages).toEqual([]);
    expect(doc.sessions[0].scores).toEqual([]);
    expect(doc.sessions[0].scenario).toBeNull();
  });
});

describe('buildDsrExport — truncation guard', () => {
  it('flags truncated:true and caps at DSR_EXPORT_MAX_SESSIONS', () => {
    const many: RawDsrSessionRow[] = Array.from(
      { length: DSR_EXPORT_MAX_SESSIONS + 5 },
      (_v, i) => ({ id: `s-${i}` })
    );
    const doc = buildDsrExport(user, null, null, many, GEN);
    expect(doc.export.truncated).toBe(true);
    expect(doc.sessions).toHaveLength(DSR_EXPORT_MAX_SESSIONS);
  });

  it('exactly at the cap is not truncated', () => {
    const many: RawDsrSessionRow[] = Array.from(
      { length: DSR_EXPORT_MAX_SESSIONS },
      (_v, i) => ({ id: `s-${i}` })
    );
    const doc = buildDsrExport(user, null, null, many, GEN);
    expect(doc.export.truncated).toBe(false);
    expect(doc.sessions).toHaveLength(DSR_EXPORT_MAX_SESSIONS);
  });
});

describe('dsrExportFilename', () => {
  it('embeds the export date', () => {
    expect(dsrExportFilename(GEN)).toBe('xpelevator-data-export-2026-08-09.json');
  });
  it('falls back gracefully on a non-ISO value', () => {
    expect(dsrExportFilename('not-a-date')).toBe('xpelevator-data-export-export.json');
  });
});
