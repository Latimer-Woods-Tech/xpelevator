/**
 * Pure, dependency-free CSV serialisation (RFC 4180).
 *
 * Worker-safe: no Node built-ins, no `Buffer`, no network — just string
 * building, so it runs identically in the OpenNext worker, Node, and vitest.
 * This is the single source of truth for how the manager reporting export
 * (`GET /api/reports/sessions`) turns rows into a downloadable `.csv` artifact
 * operators hand to their clients.
 */

/** A single CSV cell. `null`/`undefined` render as an empty field. */
export type CsvCell = string | number | boolean | null | undefined;

/**
 * Escape one field per RFC 4180: a field is wrapped in double quotes when it
 * contains a comma, a double quote, or a CR/LF, and any interior double quote
 * is doubled. Plain fields pass through untouched.
 */
export function escapeCsvField(value: CsvCell): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialise a header row + data rows into an RFC-4180 CSV string.
 *
 * Rows are CRLF-terminated (the line ending the spec mandates and that Excel
 * expects) and the output ends with a trailing CRLF. Every field is escaped via
 * {@link escapeCsvField}, so values containing commas, quotes, or newlines
 * (e.g. a scenario name or trainee email) never corrupt the column layout.
 */
export function toCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(','));
  return lines.join('\r\n') + '\r\n';
}
