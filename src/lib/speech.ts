/**
 * speech — pure helpers that turn a streaming customer reply into
 * incrementally speakable sentence chunks.
 *
 * Voice mode used to wait for the FULL model response before speaking a single
 * word (browser TTS fired only on the SSE `done` event), producing multi-second
 * dead air every turn — the "half speed sparring session" feel the founder
 * flagged (issue #16, Phase E-root #2). These helpers let the caller speak each
 * sentence the moment it is complete, so the first audio starts on the first
 * clause instead of after the whole reply.
 *
 * Runtime-agnostic and dependency-free (no DOM, no Node built-ins). All the
 * boundary logic lives here — not in the React component — so it is exercised
 * under the src/lib coverage gate and is immune to React state-batching.
 */

/** Inline control markers the model may emit that must never be spoken aloud. */
const CONTROL_MARKER = /\[(?:RESOLVED|END|START)\]/gi;

/** Sentence-terminating punctuation. */
const SENTENCE_ENDER = new Set(['.', '!', '?', '…']);

/** Closing punctuation that belongs to the sentence it trails (quotes/brackets). */
const TRAILING = new Set(['"', "'", ')', ']', '”', '’']);

/**
 * Strip inline control markers and collapse surrounding whitespace so a chunk
 * is clean, single-spaced, speak-ready text.
 */
export function stripControlMarkers(text: string): string {
  return text.replace(CONTROL_MARKER, ' ').replace(/\s+/g, ' ').trim();
}

export interface SpeechSplit {
  /** Newly-complete, speak-ready sentences (markers stripped, empties dropped). */
  chunks: string[];
  /** Char offset into `accumulated` consumed so far — thread back on the next call. */
  consumed: number;
}

/**
 * Extract the sentences that have become complete in `accumulated` since the
 * previous call, given how many characters were already `consumed`.
 *
 * A sentence is treated as complete when it ends in `.`/`!`/`?`/`…` (plus any
 * run of trailing quotes/brackets) followed by whitespace, or at a newline.
 * Requiring a following whitespace guarantees we never speak a half-formed
 * clause and never split a decimal like `3.5` while it is still streaming.
 *
 * With `flush = true` (the stream has ended) the trailing remainder is emitted
 * too — even without terminating punctuation — so the final words are spoken.
 *
 * @param accumulated  the full reply text seen so far (raw chunk concatenation)
 * @param consumed     chars already emitted as chunks on prior calls
 * @param flush        emit the trailing remainder (call once at end of stream)
 */
export function splitSpeechChunks(
  accumulated: string,
  consumed: number,
  flush = false
): SpeechSplit {
  const pending = accumulated.slice(consumed);
  const chunks: string[] = [];
  let start = 0; // offset within `pending` of the current unspoken sentence

  for (let i = 0; i < pending.length; i++) {
    const ch = pending[i];

    // A newline always ends the current line.
    if (ch === '\n') {
      const sentence = stripControlMarkers(pending.slice(start, i + 1));
      if (sentence) chunks.push(sentence);
      start = i + 1;
      continue;
    }

    if (!SENTENCE_ENDER.has(ch)) continue;

    // Absorb a run of terminators + trailing closers (e.g. `?!`, `...`, `."`).
    let end = i + 1;
    while (
      end < pending.length &&
      (SENTENCE_ENDER.has(pending[end]) || TRAILING.has(pending[end]))
    ) {
      end++;
    }
    // Confirmed boundary only when whitespace follows the run — otherwise the
    // clause may still be growing (or it's a decimal like `3.5`), so wait.
    if (end < pending.length && /\s/.test(pending[end])) {
      const sentence = stripControlMarkers(pending.slice(start, end));
      if (sentence) chunks.push(sentence);
      start = end;
    }
    i = end - 1;
  }

  let newConsumed = consumed + start;
  if (flush) {
    const tail = stripControlMarkers(pending.slice(start));
    if (tail) chunks.push(tail);
    newConsumed = accumulated.length;
  }
  return { chunks, consumed: newConsumed };
}
