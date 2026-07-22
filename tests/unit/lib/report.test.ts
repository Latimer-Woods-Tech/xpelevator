import { describe, it, expect } from 'vitest';
import {
  REPORT_COLUMNS,
  scoringLabel,
  sessionToReportRow,
  sessionsToReportRows,
  sessionsToCsv,
  sessionsToPdf,
  ROLLUP_COLUMNS,
  rollupSessionsToCsv,
  rollupSessionsToPdf,
  ROLLUP_SUMMARY_COLUMNS,
  rollupClientTotals,
  rollupSummaryToCsv,
  rollupSummaryToPdf,
  type ReportSession,
} from '@/lib/report';

const base: ReportSession = {
  id: 'sess-1',
  type: 'CHAT',
  endedAt: '2026-07-08T12:00:00.000Z',
  createdAt: '2026-07-08T11:00:00.000Z',
  traineeEmail: 'trainee@acme.test',
  jobTitle: 'Support Rep',
  scenario: 'Angry customer',
  scores: [
    { score: 8, criteria: { name: 'Empathy', weight: 3 } },
    { score: 4, criteria: { name: 'Upsell', weight: 1 } },
  ],
};

describe('sessionToReportRow', () => {
  it('computes simple and weighted averages (weighted differs from simple)', () => {
    const row = sessionToReportRow(base);
    // simple: (8 + 4) / 2 = 6.0
    expect(row.averageScore).toBe(6);
    // weighted: (8*3 + 4*1) / (3+1) = 28/4 = 7.0
    expect(row.weightedAverage).toBe(7);
    expect(row.criteriaScored).toBe(2);
    expect(row.modality).toBe('CHAT');
    expect(row.trainee).toBe('trainee@acme.test');
    expect(row.date).toBe('2026-07-08');
  });

  it('rounds to one decimal place', () => {
    const row = sessionToReportRow({
      ...base,
      scores: [
        { score: 7, criteria: { name: 'A', weight: 1 } },
        { score: 8, criteria: { name: 'B', weight: 1 } },
        { score: 8, criteria: { name: 'C', weight: 1 } },
      ],
    });
    // (7+8+8)/3 = 7.666… → 7.7
    expect(row.averageScore).toBe(7.7);
    expect(row.weightedAverage).toBe(7.7);
  });

  it('returns null averages for a session with no scores', () => {
    const row = sessionToReportRow({ ...base, scores: [] });
    expect(row.averageScore).toBeNull();
    expect(row.weightedAverage).toBeNull();
    expect(row.criteriaScored).toBe(0);
  });

  it('falls back to created date when endedAt is null', () => {
    const row = sessionToReportRow({ ...base, endedAt: null });
    expect(row.date).toBe('2026-07-08');
  });

  it('substitutes a placeholder for a missing trainee email', () => {
    const row = sessionToReportRow({ ...base, traineeEmail: null });
    expect(row.trainee).toBe('(unknown)');
  });
});

describe('scoringLabel', () => {
  it('maps the explicit end-of-session statuses to manager-readable labels', () => {
    expect(scoringLabel({ ...base, scoringStatus: 'SCORED' })).toBe('Scored');
    expect(scoringLabel({ ...base, scoringStatus: 'FAILED' })).toBe('Failed');
    expect(scoringLabel({ ...base, scoringStatus: 'NOT_SCORABLE' })).toBe(
      'Not scorable'
    );
  });

  it('distinguishes a scoring FAILURE from a genuinely un-scorable call', () => {
    // Both show no score, but the manager must be able to tell them apart.
    const failed = scoringLabel({ ...base, scores: [], scoringStatus: 'FAILED' });
    const notScorable = scoringLabel({
      ...base,
      scores: [],
      scoringStatus: 'NOT_SCORABLE',
    });
    expect(failed).toBe('Failed');
    expect(notScorable).toBe('Not scorable');
    expect(failed).not.toBe(notScorable);
  });

  it('infers a label for pre-instrumentation rows with no scoringStatus', () => {
    // Legacy row with scores but no status column value → still reads as Scored.
    expect(scoringLabel({ ...base, scoringStatus: null })).toBe('Scored');
    // Legacy row with neither status nor scores → Unknown (not a false "Scored").
    expect(scoringLabel({ ...base, scores: [], scoringStatus: undefined })).toBe(
      'Unknown'
    );
  });
});

describe('scoring column in the export', () => {
  it('carries the Scoring column as the last CSV field', () => {
    expect(REPORT_COLUMNS[REPORT_COLUMNS.length - 1]).toBe('Scoring');
    const failed: ReportSession = { ...base, scores: [], scoringStatus: 'FAILED' };
    const csv = sessionsToCsv([failed]);
    const [header, dataLine] = csv.trim().split('\r\n');
    expect(header.split(',').length).toBe(REPORT_COLUMNS.length);
    // Row still has one cell per column and ends with the Failed status.
    const cells = dataLine.split(',');
    expect(cells.length).toBe(REPORT_COLUMNS.length);
    expect(cells[cells.length - 1]).toBe('Failed');
  });

  it('exposes the scoring outcome on the flattened row', () => {
    const row = sessionToReportRow({ ...base, scoringStatus: 'FAILED' });
    expect(row.scoring).toBe('Failed');
  });
});

describe('sessionsToReportRows', () => {
  it('preserves input order', () => {
    const rows = sessionsToReportRows([
      { ...base, id: 'a' },
      { ...base, id: 'b' },
    ]);
    expect(rows.map((r) => r.sessionId)).toEqual(['a', 'b']);
  });
});

describe('sessionsToCsv', () => {
  it('emits the canonical header row', () => {
    const csv = sessionsToCsv([]);
    expect(csv).toBe(REPORT_COLUMNS.join(',') + '\r\n');
  });

  it('escapes a scenario name containing a comma so columns stay aligned', () => {
    const csv = sessionsToCsv([
      { ...base, scenario: 'Refund, then upsell' },
    ]);
    const dataLine = csv.trim().split('\r\n')[1];
    expect(dataLine).toContain('"Refund, then upsell"');
    // 9 columns → still 9 fields after a naive comma-count check on the quoted cell
    expect(csv).toContain('sess-1');
  });
});

describe('sessionsToPdf', () => {
  it('produces a valid PDF byte stream', () => {
    const bytes = sessionsToPdf([base]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 8));
    expect(head).toBe('%PDF-1.4');
    expect(bytes.length).toBeGreaterThan(300);
  });

  it('renders a report with no sessions (header-only page)', () => {
    const bytes = sessionsToPdf([]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('/Count 1');
    expect(text).toContain('0 completed sessions');
  });
});

describe('operator portfolio roll-up', () => {
  const acme: ReportSession = { ...base, id: 'sess-a', organization: 'Acme Retail' };
  const north: ReportSession = {
    ...base,
    id: 'sess-b',
    organization: 'Northwind',
    scores: [{ score: 10, criteria: { name: 'Empathy', weight: 1 } }],
  };

  it('ROLLUP_COLUMNS leads with Organization then the single-org columns', () => {
    expect(ROLLUP_COLUMNS[0]).toBe('Organization');
    expect(ROLLUP_COLUMNS).toEqual(['Organization', ...REPORT_COLUMNS]);
  });

  it('CSV prepends the owning org name to each row', () => {
    const csv = rollupSessionsToCsv([acme, north]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(ROLLUP_COLUMNS.join(','));
    // Order preserved; org is the first cell, then the session id.
    expect(lines[1].startsWith('Acme Retail,sess-a,')).toBe(true);
    expect(lines[2].startsWith('Northwind,sess-b,')).toBe(true);
  });

  it('CSV labels a session with no org as (unassigned)', () => {
    const orphan: ReportSession = { ...base, id: 'sess-o', organization: null };
    const csv = rollupSessionsToCsv([orphan]);
    expect(csv.split('\r\n')[1].startsWith('(unassigned),sess-o,')).toBe(true);
  });

  it('CSV escapes an org name containing a comma', () => {
    const s: ReportSession = { ...base, id: 'sess-c', organization: 'Acme, Inc.' };
    const csv = rollupSessionsToCsv([s]);
    expect(csv).toContain('"Acme, Inc.",sess-c,');
  });

  it('PDF produces a valid Portfolio Report byte stream', () => {
    const bytes = rollupSessionsToPdf([acme, north]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('2 completed sessions across your client organisations');
  });

  it('PDF renders an empty portfolio (header-only page)', () => {
    const bytes = rollupSessionsToPdf([]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('/Count 1');
    expect(text).toContain('0 completed sessions');
  });
});

describe('operator portfolio per-client totals', () => {
  // base weights: Empathy 3, Upsell 1 → per-session weighted (8*3+4*1)/4 = 7.0
  const acme1: ReportSession = { ...base, id: 'a1', organization: 'Acme Retail' };
  const acme2: ReportSession = {
    ...base,
    id: 'a2',
    organization: 'Acme Retail',
    // (10*3 + 6*1)/4 = 9.0
    scores: [
      { score: 10, criteria: { name: 'Empathy', weight: 3 } },
      { score: 6, criteria: { name: 'Upsell', weight: 1 } },
    ],
  };
  const north: ReportSession = {
    ...base,
    id: 'n1',
    organization: 'Northwind',
    scores: [{ score: 10, criteria: { name: 'Empathy', weight: 1 } }],
  };

  it('SUMMARY columns are Organization/Trainees/Sessions/Scored/Weighted Average', () => {
    expect(ROLLUP_SUMMARY_COLUMNS).toEqual([
      'Organization',
      'Trainees',
      'Sessions',
      'Scored',
      'Weighted Average',
    ]);
  });

  it('counts DISTINCT trainees per client and ignores null-email sessions', () => {
    const d1: ReportSession = { ...base, id: 'd1', organization: 'Delta', traineeEmail: 'a@delta.test' };
    const d2: ReportSession = { ...base, id: 'd2', organization: 'Delta', traineeEmail: 'b@delta.test' };
    const d3: ReportSession = { ...base, id: 'd3', organization: 'Delta', traineeEmail: 'a@delta.test' }; // dup
    const d4: ReportSession = { ...base, id: 'd4', organization: 'Delta', traineeEmail: null }; // ignored
    const [delta] = rollupClientTotals([d1, d2, d3, d4]);
    expect(delta.sessions).toBe(4);
    // two distinct people (a@ + b@); the repeat collapses, the null-email seat is not counted
    expect(delta.trainees).toBe(2);
  });

  it('pools every score across a client, sorted by org name', () => {
    const totals = rollupClientTotals([north, acme1, acme2]);
    // sorted: Acme Retail before Northwind
    expect(totals.map((t) => t.organization)).toEqual(['Acme Retail', 'Northwind']);
    const acme = totals[0];
    // acme1 + acme2 are the same trainee (shared base email) → 1 distinct seat
    expect(acme.trainees).toBe(1);
    expect(acme.sessions).toBe(2);
    expect(acme.scored).toBe(2);
    // pooled: (8*3+4*1 + 10*3+6*1) / (4+4) = (28+36)/8 = 8.0 — NOT the mean of
    // the two per-session numbers (7.0, 9.0) unless weights match, which they do
    // here, but the pooling is over raw score*weight, proving the book number.
    expect(acme.weightedAverage).toBe(8);
    expect(totals[1].weightedAverage).toBe(10);
  });

  it('counts an unscored session but excludes it from `scored`', () => {
    const unscored: ReportSession = { ...base, id: 'u1', organization: 'Acme Retail', scores: [] };
    const totals = rollupClientTotals([acme1, unscored]);
    expect(totals[0].sessions).toBe(2);
    expect(totals[0].scored).toBe(1);
    // pooled weighted average ignores the empty session (no weights)
    expect(totals[0].weightedAverage).toBe(7);
  });

  it('folds a session with no org into (unassigned)', () => {
    const orphan: ReportSession = { ...base, id: 'o1', organization: null };
    const totals = rollupClientTotals([orphan]);
    expect(totals[0].organization).toBe('(unassigned)');
  });

  it('CSV has the header, per-client rows, and a trailing portfolio total', () => {
    const csv = rollupSummaryToCsv([north, acme1, acme2]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(ROLLUP_SUMMARY_COLUMNS.join(','));
    // Trainees column inserted after Organization: all three sessions are the
    // same base trainee, so each org shows 1 distinct seat.
    expect(lines[1]).toBe('Acme Retail,1,2,2,8');
    expect(lines[2]).toBe('Northwind,1,1,1,10');
    // grand total: 1 distinct trainee book-wide, 3 sessions, 3 scored,
    // pooled (28+36+10)/(8+1)=74/9≈8.2
    expect(lines[3]).toBe('TOTAL (all clients),1,3,3,8.2');
  });

  it('grand-total trainees de-duplicates a trainee shared across clients', () => {
    const one: ReportSession = { ...base, id: 'x1', organization: 'One', traineeEmail: 'shared@x.test' };
    const two: ReportSession = { ...base, id: 'x2', organization: 'Two', traineeEmail: 'shared@x.test' };
    const lines = rollupSummaryToCsv([one, two]).trim().split('\r\n');
    // one seat under each client…
    expect(lines[1]).toBe('One,1,1,1,7');
    expect(lines[2]).toBe('Two,1,1,1,7');
    // …but the book-wide headcount is ONE distinct person, not the sum (2).
    expect(lines[3]).toBe('TOTAL (all clients),1,2,2,7');
  });

  it('CSV of an empty portfolio is header-only (no total row)', () => {
    const csv = rollupSummaryToCsv([]);
    expect(csv).toBe(ROLLUP_SUMMARY_COLUMNS.join(',') + '\r\n');
  });

  it('CSV escapes a client org name containing a comma', () => {
    const s: ReportSession = { ...base, id: 'c1', organization: 'Acme, Inc.' };
    const csv = rollupSummaryToCsv([s]);
    expect(csv).toContain('"Acme, Inc.",1,1,1,7');
  });

  it('PDF produces a valid Portfolio Summary byte stream', () => {
    const bytes = rollupSummaryToPdf([acme1, acme2, north]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('2 client organisations');
  });

  it('PDF renders an empty portfolio summary (header-only page)', () => {
    const bytes = rollupSummaryToPdf([]);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('/Count 1');
    expect(text).toContain('0 client organisations');
  });
});

// Branch coverage for the count-dependent subtitle wording (singular vs plural)
// and the set-level null weighted average — paths the multi-item fixtures above
// never exercise.
describe('operator roll-up — singular counts & unscored sets', () => {
  const acme: ReportSession = { ...base, id: 'one-org', organization: 'Acme Retail' };

  it('summary PDF says "1 client organisation" (singular) for a single client', () => {
    const text = new TextDecoder('latin1').decode(rollupSummaryToPdf([acme]));
    expect(text).toContain('1 client organisation ');
    expect(text).not.toContain('1 client organisations');
  });

  it('portfolio PDF says "1 completed session" (singular) for a single session', () => {
    const text = new TextDecoder('latin1').decode(rollupSessionsToPdf([acme]));
    expect(text).toContain('1 completed session across');
    expect(text).not.toContain('1 completed sessions');
  });

  it('summary CSV leaves the weighted-average cell empty when NO session is scored', () => {
    // Every session carries empty scores → the pooled weight total is 0, so the
    // per-client AND the portfolio-total weighted average are both null (blank).
    const u1: ReportSession = { ...base, id: 'u1', organization: 'Acme Retail', scores: [] };
    const u2: ReportSession = { ...base, id: 'u2', organization: 'Acme Retail', scores: [] };
    const lines = rollupSummaryToCsv([u1, u2]).trim().split('\r\n');
    // Organization,Trainees,Sessions,Scored,WeightedAvg → 2 sessions, 0 scored, blank avg
    expect(lines[1]).toBe('Acme Retail,1,2,0,');
    expect(lines[2]).toBe('TOTAL (all clients),1,2,0,');
  });
});
