/**
 * Unit tests for src/lib/pdf.ts — the pure, Worker-safe PDF table renderer that
 * backs the manager reporting export (`GET /api/reports/sessions?format=pdf`).
 *
 * Covered:
 *   1. Emits a structurally valid PDF (header, xref, trailer, %%EOF)
 *   2. xref /Size and offset-count stay in lock-step with the object count
 *   3. Deterministic — identical input → byte-identical output
 *   4. Paginates: enough rows produce more than one Page (/Count > 1)
 *   5. Escapes `(` `)` `\` in cell text so a stray paren can't corrupt the stream
 *   6. Content-stream /Length matches the actual stream byte length
 */

import { describe, it, expect } from 'vitest';
import { renderTablePdf, type PdfColumn } from '@/lib/pdf';

const COLUMNS: readonly PdfColumn[] = [
  { header: 'A', width: 100 },
  { header: 'B', width: 100 },
];

const decode = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

describe('renderTablePdf', () => {
  it('emits a structurally valid PDF document', () => {
    const bytes = renderTablePdf({ title: 'Report', columns: COLUMNS, rows: [['x', 'y']] });
    expect(bytes).toBeInstanceOf(Uint8Array);
    const text = decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Pages');
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/BaseFont /Helvetica-Bold');
    expect(text).toContain('\nxref\n');
    expect(text).toContain('/Root 1 0 R');
    expect(text).toContain('startxref');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('keeps xref /Size in lock-step with the emitted object count', () => {
    const text = decode(
      renderTablePdf({ title: 'R', columns: COLUMNS, rows: [['a', 'b']] })
    );
    // One-page report → 6 objects (Catalog, Pages, 2 Fonts, Page, Contents) → Size 7.
    const objCount = (text.match(/\d+ 0 obj\n/g) ?? []).length;
    const sizeMatch = text.match(/\/Size (\d+)/);
    expect(sizeMatch).not.toBeNull();
    expect(Number(sizeMatch![1])).toBe(objCount + 1);

    // xref subsection header "0 N" must also equal Size, and there must be N
    // entry lines (1 free + objCount in-use).
    const xref = text.slice(text.indexOf('\nxref\n') + 6);
    const header = xref.match(/^0 (\d+)/);
    expect(Number(header![1])).toBe(objCount + 1);
    const entryLines = (xref.match(/^\d{10} \d{5} [fn] $/gm) ?? []).length;
    expect(entryLines).toBe(objCount + 1);
  });

  it('is deterministic — identical input yields byte-identical output', () => {
    const doc = { title: 'Same', subtitle: 'sub', columns: COLUMNS, rows: [['1', '2']] };
    const a = renderTablePdf(doc);
    const b = renderTablePdf(doc);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('paginates a large row set across multiple pages', () => {
    const rows = Array.from({ length: 400 }, (_, i) => [`row${i}`, `val${i}`]);
    const text = decode(renderTablePdf({ title: 'Big', columns: COLUMNS, rows }));
    const count = Number(text.match(/\/Count (\d+)/)![1]);
    expect(count).toBeGreaterThan(1);
    const pageObjs = (text.match(/\/Type \/Page\b/g) ?? []).length;
    expect(pageObjs).toBe(count);
  });

  it('always emits at least one page even with zero rows', () => {
    const text = decode(renderTablePdf({ title: 'Empty', columns: COLUMNS, rows: [] }));
    expect(text).toContain('/Count 1');
  });

  it('escapes parentheses and backslashes in cell text', () => {
    const text = decode(
      renderTablePdf({ title: 'T', columns: COLUMNS, rows: [['a (b) c', 'd\\e']] })
    );
    expect(text).toContain('a \\(b\\) c');
    expect(text).toContain('d\\\\e');
  });

  it('writes an xref whose every offset points at the matching object', () => {
    // This is the invariant a real PDF reader relies on: it seeks to the byte
    // offset in the xref and expects to find "<n> 0 obj". Exercised across a
    // multi-page document so per-page object numbering is covered too.
    const rows = Array.from({ length: 250 }, (_, i) => [`r${i}`, `v${i}`]);
    const bytes = renderTablePdf({ title: 'Xref', subtitle: 's', columns: COLUMNS, rows });
    const text = decode(bytes);

    const xrefStart = Number(text.match(/startxref\n(\d+)/)![1]);
    const size = Number(text.match(/\/Size (\d+)/)![1]);
    const entries = [...text.slice(xrefStart).matchAll(/^(\d{10}) \d{5} [fn] $/gm)].map((m) =>
      Number(m[1])
    );
    expect(entries.length).toBe(size);

    // Object 0 is the free head (offset 0); objects 1..size-1 must resolve.
    for (let i = 1; i < size; i++) {
      const at = text.slice(entries[i], entries[i] + `${i} 0 obj`.length);
      expect(at).toBe(`${i} 0 obj`);
    }
    // startxref must point exactly at the "xref" keyword.
    expect(text.slice(xrefStart, xrefStart + 4)).toBe('xref');
  });

  it("declares each content stream's /Length as its true byte length", () => {
    const text = decode(
      renderTablePdf({ title: 'Len', columns: COLUMNS, rows: [['hello', 'world']] })
    );
    const m = text.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
    expect(m).not.toBeNull();
    const declared = Number(m![1]);
    const actual = new TextEncoder().encode(m![2]).length;
    expect(declared).toBe(actual);
  });
});
