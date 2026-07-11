/**
 * Minimal, dependency-free PDF generation (PDF 1.4) — Worker-safe.
 *
 * No Node built-ins, no `Buffer`, no external library: this builds a tabular,
 * paginated PDF as raw bytes using only string building + `TextEncoder`, so it
 * runs identically in the OpenNext worker, Node, and vitest. It is the single
 * source of truth for how the manager reporting export
 * (`GET /api/reports/sessions?format=pdf`) turns rows into a downloadable
 * `.pdf` artifact operators hand to their clients — the PDF sibling of
 * `@/lib/csv`.
 *
 * Scope is deliberately narrow: two standard fonts (Helvetica + Helvetica-Bold,
 * which every PDF viewer ships so nothing is embedded), left-aligned text cells,
 * one horizontal rule under the header, and fixed-width columns with `...`
 * truncation. That is all a scores report needs, and it keeps the byte layout
 * (and therefore the xref table) simple enough to be fully unit-tested.
 */

/** A table column: a header label and a fixed width in PDF points (1/72 inch). */
export interface PdfColumn {
  header: string;
  width: number;
}

/** Everything needed to render a single paginated table document. */
export interface PdfTableDoc {
  title: string;
  subtitle?: string;
  columns: readonly PdfColumn[];
  /** One inner array per row; each cell is coerced to a string. */
  rows: ReadonlyArray<readonly (string | number | null | undefined)[]>;
}

// ── Page geometry (US Letter, portrait) ──────────────────────────────────────
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const TITLE_SIZE = 16;
const SUBTITLE_SIZE = 9;
const HEADER_SIZE = 9;
const BODY_SIZE = 8;
const ROW_HEIGHT = 14;
// y of the first header row on page 1 (below the title block) and on later pages.
const HEADER_Y_FIRST = PAGE_HEIGHT - 96;
const HEADER_Y_REST = PAGE_HEIGHT - MARGIN - HEADER_SIZE;
const BOTTOM_LIMIT = MARGIN + 4;

const encoder = new TextEncoder();
const byteLen = (s: string): number => encoder.encode(s).length;

/** Escape a string for use inside a PDF `(...)` literal. */
function pdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Collapse anything the standard Helvetica encoding + our 1-byte-per-char offset
 * math can't represent to plain ASCII. Newlines/tabs become spaces so a cell can
 * never break the single-line text layout.
 */
function toAscii(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E]/g, '?');
}

/**
 * Truncate `text` (with a trailing `...`) so it fits within `width` points at
 * `fontSize`. Uses a conservative average glyph width (0.52·fontSize) — good
 * enough for Helvetica report text and never over-runs a column.
 */
function fitText(text: string, width: number, fontSize: number): string {
  const clean = toAscii(text);
  const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.52)));
  if (clean.length <= maxChars) return clean;
  if (maxChars <= 3) return clean.slice(0, maxChars);
  return clean.slice(0, maxChars - 3) + '...';
}

/** Left x-offset of each column, cumulative from the left margin. */
function columnOffsets(columns: readonly PdfColumn[]): number[] {
  const offsets: number[] = [];
  let x = MARGIN;
  for (const col of columns) {
    offsets.push(x);
    x += col.width;
  }
  return offsets;
}

/** One `BT … Tj … ET` text-showing operator at an absolute position. */
function textOp(x: number, y: number, font: string, size: number, text: string): string {
  return `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfString(text)}) Tj ET`;
}

/** Build the content stream for one page and return the operator string. */
function pageContent(
  doc: PdfTableDoc,
  xs: number[],
  pageRows: PdfTableDoc['rows'],
  isFirstPage: boolean
): string {
  const ops: string[] = [];

  if (isFirstPage) {
    ops.push(textOp(MARGIN, PAGE_HEIGHT - MARGIN - TITLE_SIZE, 'F2', TITLE_SIZE, doc.title));
    if (doc.subtitle) {
      ops.push(
        textOp(MARGIN, PAGE_HEIGHT - MARGIN - TITLE_SIZE - 16, 'F1', SUBTITLE_SIZE, doc.subtitle)
      );
    }
  }

  const headerY = isFirstPage ? HEADER_Y_FIRST : HEADER_Y_REST;
  doc.columns.forEach((col, i) => {
    ops.push(textOp(xs[i], headerY, 'F2', HEADER_SIZE, col.header));
  });

  // Rule under the header row.
  const ruleY = headerY - 4;
  const ruleRight = PAGE_WIDTH - MARGIN;
  ops.push(`0.6 G 0.7 w ${MARGIN} ${ruleY} m ${ruleRight} ${ruleY} l S`);

  let y = headerY - ROW_HEIGHT;
  for (const row of pageRows) {
    doc.columns.forEach((col, i) => {
      const cell = row[i];
      const text = cell == null ? '' : String(cell);
      ops.push(textOp(xs[i], y, 'F1', BODY_SIZE, fitText(text, col.width - 4, BODY_SIZE)));
    });
    y -= ROW_HEIGHT;
  }

  return ops.join('\n');
}

/** How many data rows fit on a page below its header row. */
function rowsPerPage(isFirstPage: boolean): number {
  const headerY = isFirstPage ? HEADER_Y_FIRST : HEADER_Y_REST;
  return Math.max(1, Math.floor((headerY - ROW_HEIGHT - BOTTOM_LIMIT) / ROW_HEIGHT));
}

/** Split rows into page-sized chunks (page 1 has less room for the title block). */
function paginate(rows: PdfTableDoc['rows']): PdfTableDoc['rows'][] {
  const pages: PdfTableDoc['rows'][] = [];
  let index = 0;
  // Always emit at least one page, even with zero rows (header + "no data").
  do {
    const capacity = rowsPerPage(pages.length === 0);
    pages.push(rows.slice(index, index + capacity));
    index += capacity;
  } while (index < rows.length);
  return pages;
}

/**
 * Render a paginated table as a PDF document, returning the raw file bytes.
 * Deterministic: the same input always produces byte-identical output (no
 * timestamps, no randomness), so callers that need a timestamp put it in the
 * `subtitle`.
 */
export function renderTablePdf(doc: PdfTableDoc): Uint8Array {
  const xs = columnOffsets(doc.columns);
  const pages = paginate(doc.rows);

  // Object layout: 1=Catalog, 2=Pages, 3=F1, 4=F2, then per page a Page object
  // followed by its Contents object.
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  const pageObjNums = pages.map((_, i) => 5 + i * 2);
  objects.push(
    `<< /Type /Pages /Kids [ ${pageObjNums.map((n) => `${n} 0 R`).join(' ')} ] /Count ${pages.length} >>`
  ); // 2
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); // 3
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ); // 4

  pages.forEach((pageRows, i) => {
    const contentNum = 6 + i * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>`
    );
    const content = pageContent(doc, xs, pageRows, i === 0);
    objects.push(`<< /Length ${byteLen(content)} >>\nstream\n${content}\nendstream`);
  });

  // Serialise with a cross-reference table of exact byte offsets.
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(byteLen(body));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = byteLen(body);
  const size = objects.length + 1;
  body += `xref\n0 ${size}\n`;
  body += '0000000000 65535 f \n';
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return encoder.encode(body);
}
