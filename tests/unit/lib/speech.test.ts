import { describe, it, expect } from 'vitest';
import { splitSpeechChunks, stripControlMarkers } from '@/lib/speech';

describe('stripControlMarkers', () => {
  it('removes inline control markers and trims', () => {
    expect(stripControlMarkers('All good [RESOLVED]')).toBe('All good');
    expect(stripControlMarkers('[START] hello')).toBe('hello');
    expect(stripControlMarkers('done [END]')).toBe('done');
  });

  it('is case-insensitive and handles multiple markers', () => {
    expect(stripControlMarkers('a [resolved] b [END]')).toBe('a b');
  });

  it('collapses internal whitespace to single spaces', () => {
    expect(stripControlMarkers('too   many\n\tspaces')).toBe('too many spaces');
  });

  it('returns empty string for marker-only / blank input', () => {
    expect(stripControlMarkers('[RESOLVED]')).toBe('');
    expect(stripControlMarkers('   ')).toBe('');
  });
});

describe('splitSpeechChunks — incremental streaming', () => {
  it('emits a sentence only once it is terminated AND followed by whitespace', () => {
    // Terminator with no following char yet — sentence may still be growing.
    expect(splitSpeechChunks('Hello there.', 0)).toEqual({ chunks: [], consumed: 0 });
    // Now a trailing space arrives → the sentence is complete.
    const r = splitSpeechChunks('Hello there. ', 0);
    expect(r.chunks).toEqual(['Hello there.']);
    // Cursor stops just past the terminator; the trailing space is unconsumed.
    expect(r.consumed).toBe('Hello there.'.length);
  });

  it('emits multiple complete sentences and leaves the partial tail unconsumed', () => {
    const r = splitSpeechChunks('One. Two! Three', 0);
    expect(r.chunks).toEqual(['One.', 'Two!']);
    // "Three" (no terminator) is not consumed; the space after "Two!" is the
    // first unconsumed char, so the cursor sits just past "Two!".
    expect(r.consumed).toBe('One. Two!'.length);
  });

  it('does not split a decimal number mid-stream', () => {
    // The '.' in 3.5 is followed by a digit, not whitespace → not a boundary.
    expect(splitSpeechChunks('It costs 3.5 dollars total', 0).chunks).toEqual([]);
    expect(splitSpeechChunks('It costs 3.5 dollars total. ', 0).chunks).toEqual([
      'It costs 3.5 dollars total.',
    ]);
  });

  it('treats ? and … and runs of terminators as one boundary', () => {
    expect(splitSpeechChunks('Really?! ', 0).chunks).toEqual(['Really?!']);
    expect(splitSpeechChunks('Well... ', 0).chunks).toEqual(['Well...']);
    expect(splitSpeechChunks('Hmm… ', 0).chunks).toEqual(['Hmm…']);
  });

  it('absorbs trailing closing quotes/brackets into the sentence', () => {
    expect(splitSpeechChunks('He said "no." Then left.', 0).chunks).toEqual([
      'He said "no."',
    ]);
  });

  it('splits on a newline even without terminating punctuation', () => {
    const r = splitSpeechChunks('First line\nsecond', 0);
    expect(r.chunks).toEqual(['First line']);
    expect(r.consumed).toBe('First line\n'.length);
  });

  it('threads `consumed` across successive calls without re-emitting', () => {
    let acc = '';
    let consumed = 0;
    const spoken: string[] = [];
    for (const frag of ['Hi there. ', 'How ', 'are you? ', 'Bye']) {
      acc += frag;
      const r = splitSpeechChunks(acc, consumed);
      consumed = r.consumed;
      spoken.push(...r.chunks);
    }
    expect(spoken).toEqual(['Hi there.', 'How are you?']);
  });
});

describe('splitSpeechChunks — flush', () => {
  it('emits the trailing remainder when the stream ends', () => {
    const first = splitSpeechChunks('All set. Anything else', 0);
    expect(first.chunks).toEqual(['All set.']);
    const flushed = splitSpeechChunks('All set. Anything else', first.consumed, true);
    expect(flushed.chunks).toEqual(['Anything else']);
    expect(flushed.consumed).toBe('All set. Anything else'.length);
  });

  it('speaks a whole short reply that never had an interior boundary', () => {
    const r = splitSpeechChunks('I need help with my order please.', 0, true);
    expect(r.chunks).toEqual(['I need help with my order please.']);
  });

  it('strips a trailing [RESOLVED] marker from the flushed tail', () => {
    const r = splitSpeechChunks('Thanks, that fixed it! [RESOLVED]', 0, true);
    expect(r.chunks).toEqual(['Thanks, that fixed it!']);
    expect(r.chunks.join(' ')).not.toContain('RESOLVED');
  });

  it('emits nothing when the flushed remainder is only a control marker', () => {
    const first = splitSpeechChunks('Done here. ', 0);
    const flushed = splitSpeechChunks('Done here. [RESOLVED]', first.consumed, true);
    expect(flushed.chunks).toEqual([]);
  });

  it('returns no chunks for empty input', () => {
    expect(splitSpeechChunks('', 0)).toEqual({ chunks: [], consumed: 0 });
    expect(splitSpeechChunks('', 0, true)).toEqual({ chunks: [], consumed: 0 });
  });
});
