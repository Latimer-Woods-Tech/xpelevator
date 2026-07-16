/**
 * Shared end-of-session scoring.
 *
 * Both the chat path (`endSession` in api/chat) and the phone path (the Telnyx
 * webhook's `[RESOLVED]` branch) previously re-implemented this same sequence
 * — load criteria → gate → score → insert — independently, and the phone path
 * omitted `scoring_status` entirely, so every phone session was `null` in the
 * manager report. This module is the single source of truth so the two paths
 * cannot drift again (the recurring chat↔phone divergence in LESSONS_LEARNED).
 */

import { sql } from '@/lib/db';
import { scoreSession, type ScoringCriterion } from '@/lib/ai';
import type { ScoreResult } from '@/types';

/** A session needs at least this many messages to be worth scoring. */
export const SCORING_MIN_TRANSCRIPT = 2;

export type ScoringStatus = 'SCORED' | 'FAILED' | 'NOT_SCORABLE';

export interface TranscriptLine {
  role: 'CUSTOMER' | 'AGENT';
  content: string;
}

export interface ScoringOutcome {
  scores: ScoreResult[];
  scoringStatus: ScoringStatus;
  /** True when the session was scorable but produced zero scores — a scoring
   * engine failure (expired credential, unparseable judge output), NOT a
   * genuinely un-scorable call. Callers surface this instead of a silent zero. */
  scoringFailed: boolean;
}

/**
 * Persist WHY a session has (or lacks) scores. `NOT_SCORABLE` (too short / no
 * criteria) and `FAILED` (engine error) are distinct so the manager report can
 * tell an engine failure apart from a genuinely un-scored call — a plain `null`
 * score cannot, which is the "managers don't trust the /10" kill-signal. Pure.
 */
export function resolveScoringStatus(scorable: boolean, scoreCount: number): ScoringStatus {
  if (!scorable) return 'NOT_SCORABLE';
  return scoreCount > 0 ? 'SCORED' : 'FAILED';
}

/**
 * Resolve the active scoring criteria for a session: the criteria linked to its
 * job title, falling back to all active criteria when the job has no explicit
 * links. Matches the previous per-path behavior exactly.
 */
export async function loadScoringCriteria(sessionId: string): Promise<ScoringCriterion[]> {
  const linked = await sql`
    SELECT c.id, c.name, c.description, c.weight
    FROM simulation_sessions ss
    JOIN job_criteria jc ON jc.job_title_id = ss.job_title_id
    JOIN criteria c ON c.id = jc.criteria_id
    WHERE ss.id = ${sessionId} AND c.active = true
  `;
  if (linked.length > 0) return linked as ScoringCriterion[];
  const all = await sql`SELECT id, name, description, weight FROM criteria WHERE active = true`;
  return all as ScoringCriterion[];
}

/**
 * Insert all score rows for a session in a SINGLE round trip (was N sequential
 * Neon HTTP inserts). Uses json_to_recordset so exactly one bound parameter
 * (the JSON payload) is sent — unambiguous binding, one statement.
 */
export async function insertScoresBatch(sessionId: string, scores: ScoreResult[]): Promise<void> {
  if (scores.length === 0) return;
  const payload = JSON.stringify(
    scores.map(s => ({ criteriaId: s.criteriaId, score: s.score, feedback: s.justification }))
  );
  await sql`
    INSERT INTO scores (id, session_id, criteria_id, score, feedback, scored_at)
    SELECT gen_random_uuid(), ${sessionId}, r."criteriaId", r.score, r.feedback, NOW()
    FROM json_to_recordset(${payload}::json)
      AS r("criteriaId" text, score int, feedback text)
  `;
}

/**
 * Mark a session COMPLETED, score its transcript, persist the scores (batched)
 * and the scoring_status. Shared by the chat and phone end-of-session paths.
 *
 * The transcript is passed in (not loaded here) so each caller keeps its exact
 * prior semantics: chat scores the in-memory transcript as of the turn that
 * ended it; phone scores the freshly-loaded DB transcript.
 */
export async function finalizeAndScoreSession(
  sessionId: string,
  transcript: TranscriptLine[]
): Promise<ScoringOutcome> {
  await sql`
    UPDATE simulation_sessions
    SET status = 'COMPLETED', ended_at = NOW()
    WHERE id = ${sessionId}
  `;

  const criteria = await loadScoringCriteria(sessionId);
  const scorable = transcript.length >= SCORING_MIN_TRANSCRIPT && criteria.length > 0;

  let scores: ScoreResult[] = [];
  if (scorable) {
    try {
      scores = await scoreSession(transcript, criteria);
    } catch (err) {
      console.error('[scoring] Auto-scoring failed:', err);
    }
  }

  await insertScoresBatch(sessionId, scores);

  const scoringStatus = resolveScoringStatus(scorable, scores.length);
  await sql`
    UPDATE simulation_sessions
    SET scoring_status = ${scoringStatus}
    WHERE id = ${sessionId}
  `;

  return { scores, scoringStatus, scoringFailed: scorable && scores.length === 0 };
}
