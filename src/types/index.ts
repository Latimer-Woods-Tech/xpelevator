// ─── Enums / Union Types ──────────────────────────────────────────────────────

export type SimulationType = 'PHONE' | 'CHAT' | 'VOICE';
export type SessionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ABANDONED';
export type MessageRole = 'CUSTOMER' | 'AGENT';

// ─── Domain Models ────────────────────────────────────────────────────────────

export interface Criteria {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  category: string | null;
  active: boolean;
}

export interface JobTitle {
  id: string;
  name: string;
  description: string | null;
  scenarios?: Scenario[];
}

export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  type: SimulationType;
  script?: Record<string, unknown>;
  jobTitleId?: string;
  jobTitle?: { name: string };
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface ScoreItem {
  id: string;
  score: number;
  feedback: string | null;
  criteria: { name: string; description?: string | null; weight?: number };
}

export interface SimulationSession {
  id: string;
  status: SessionStatus;
  type: SimulationType;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  messages: Message[];
  scores: ScoreItem[];
  scenario: { name: string; description: string | null; type: string };
  jobTitle: { name: string };
}

// ─── AI / Script Types (canonical — imported by lib/ai.ts and UI components) ──

export type ScenarioScript = {
  customerPersona: string;
  customerObjective: string;
  difficulty: 'easy' | 'medium' | 'hard';
  hints?: string[];
  maxTurns?: number;
};

export type ScoreResult = {
  criteriaId: string;
  criteriaName: string;
  score: number;
  justification: string;
};

// ─── SSE Event Payloads ───────────────────────────────────────────────────────

export type SSEEventType =
  | 'chunk'
  | 'done'
  | 'error'
  | 'session_ending'
  | 'session_ended';

export interface SSEChunkEvent {
  type: 'chunk';
  content: string;
}

export interface SSEDoneEvent {
  type: 'done';
  content: string;
}

export interface SSEErrorEvent {
  type: 'error';
  message: string;
}

export interface SSESessionEndingEvent {
  type: 'session_ending';
  content: string;
}

export interface SSESessionEndedEvent {
  type: 'session_ended';
  sessionId: string;
}

export type SSEEvent =
  | SSEChunkEvent
  | SSEDoneEvent
  | SSEErrorEvent
  | SSESessionEndingEvent
  | SSESessionEndedEvent;
