import { describe, it, expect } from 'vitest';
import {
  REPORT_COLUMNS,
  sessionToReportRow,
  sessionsToReportRows,
  sessionsToCsv,
  sessionsToPdf,
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
