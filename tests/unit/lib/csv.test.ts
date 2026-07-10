import { describe, it, expect } from 'vitest';
import { escapeCsvField, toCsv } from '@/lib/csv';

describe('escapeCsvField', () => {
  it('passes plain values through unquoted', () => {
    expect(escapeCsvField('hello')).toBe('hello');
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(true)).toBe('true');
  });

  it('renders null/undefined as an empty field', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('quotes fields containing a comma', () => {
    expect(escapeCsvField('Smith, Jane')).toBe('"Smith, Jane"');
  });

  it('quotes and doubles interior quotes', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes fields containing newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('a\r\nb')).toBe('"a\r\nb"');
  });
});

describe('toCsv', () => {
  it('serialises a header + rows with CRLF terminators and a trailing CRLF', () => {
    const csv = toCsv(['a', 'b'], [
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(csv).toBe('a,b\r\n1,2\r\n3,4\r\n');
  });

  it('escapes cells so commas/quotes cannot corrupt the column layout', () => {
    const csv = toCsv(['name', 'note'], [['Doe, John', 'said "ok"']]);
    expect(csv).toBe('name,note\r\n"Doe, John","said ""ok"""\r\n');
  });

  it('handles an empty row set (header only)', () => {
    expect(toCsv(['x', 'y'], [])).toBe('x,y\r\n');
  });
});
