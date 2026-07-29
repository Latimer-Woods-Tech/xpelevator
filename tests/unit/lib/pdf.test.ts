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

  it('truncates an over-wide cell with an ellipsis and never over-runs', () => {
    const long = 'this-is-a-very-long-cell-value-that-cannot-possibly-fit-in-a-narrow-column';
    const narrow: readonly PdfColumn[] = [
      { header: 'H', width: 40 },
      { header: 'Tiny', width: 8 },
    ];
    const text = decode(renderTablePdf({ title: 'Trunc', columns: narrow, rows: [[long, long]] }));
    // The wide-but-finite column ellipsises; the raw full value never appears.
    expect(text).toContain('...');
    expect(text).not.toContain(long);
  });

  it('sanitises non-ASCII and control characters in cell text', () => {
    const text = decode(
      renderTablePdf({ title: 'Unicode', columns: COLUMNS, rows: [['café\tné', 'a\r\nb']] })
    );
    // Non-ASCII → '?', tabs/newlines → spaces, so the stream stays single-line ASCII.
    expect(text).toContain('caf? n?');
    expect(text).toContain('a b');
  });

  it('renders a title/subtitle with typographic punctuation as readable ASCII (no mojibake)', () => {
    // Every real report title uses an em-dash and every subtitle a middot; these
    // bypass fitText, so before the textOp/toAscii choke point they reached the
    // stream as raw UTF-8 and a WinAnsi viewer rendered them as mojibake
    // (`—` → `â€"`, `·` → `Â·`).
    const bytes = renderTablePdf({
      title: 'XPElevator — Session Report',
      subtitle: 'Generated 2026-07-29 · 3 completed sessions · “weighted” average /10',
      columns: COLUMNS,
      rows: [['a', 'b']],
    });
    const text = decode(bytes);

    // Transliterated to readable ASCII, not '?' and not garbled.
    expect(text).toContain('XPElevator - Session Report');
    expect(text).toContain('Generated 2026-07-29 - 3 completed sessions - "weighted" average /10');

    // The tell-tale WinAnsi mojibake for the UTF-8 middot / em-dash / curly
    // quote is gone (this is what fails if the toAscii choke point is removed).
    expect(text).not.toContain('Â·'); // U+00B7 as UTF-8 under WinAnsi
    expect(text).not.toContain('â'); // em-dash / curly-quote lead byte 0xE2

    // Byte-precise: the multi-byte UTF-8 sequences must not appear at all.
    const hasSeq = (seq: number[]): boolean => {
      for (let i = 0; i + seq.length <= bytes.length; i++) {
        if (seq.every((b, j) => bytes[i + j] === b)) return true;
      }
      return false;
    };
    expect(hasSeq([0xc2, 0xb7])).toBe(false); // U+00B7 ·
    expect(hasSeq([0xe2, 0x80, 0x94])).toBe(false); // U+2014 —
    expect(hasSeq([0xe2, 0x80, 0x9c])).toBe(false); // U+201C “
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
