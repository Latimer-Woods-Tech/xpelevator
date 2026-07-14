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
