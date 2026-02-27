/**
 * Telnyx REST API helper — thin wrapper around fetch.
 * Works in both Node.js and Cloudflare edge runtime.
 *
 * Requires environment variables:
 *   TELNYX_API_KEY       — from https://portal.telnyx.com/#/app/api-keys
 *   TELNYX_CONNECTION_ID — Call Control Application ID
 *   TELNYX_WEBHOOK_URL   — public HTTPS URL for Telnyx to send call events
 *
 * Telnyx Call Control docs: https://developers.telnyx.com/docs/call-control
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';

const TELNYX_BASE = 'https://api.telnyx.com/v2';

/**
 * Resolve Telnyx env vars at REQUEST time (not build time).
 *
 * process.env.* is inlined by webpack at build time — runtime secrets set via
 * `wrangler pages secret put` are never visible through it in CF Workers.
 * getCloudflareContext().env is a true runtime binding that always carries the
 * real secret. process.env is kept as a fallback for local `next dev`.
 */
function getTelnyxEnv(): { apiKey: string; connectionId: string; webhookUrl: string } {
  let apiKey: string | undefined;
  let connectionId: string | undefined;
  let webhookUrl: string | undefined;

  // 1. Cloudflare runtime bindings (production)
  try {
    const { env } = getCloudflareContext();
    const cfEnv = env as Record<string, string | undefined>;
    apiKey = cfEnv.TELNYX_API_KEY;
    connectionId = cfEnv.TELNYX_CONNECTION_ID;
    webhookUrl = cfEnv.TELNYX_WEBHOOK_URL;
  } catch {
    // Not in a CF Worker context (local dev) — fall through
  }

  // 2. process.env fallback for local development
  apiKey ??= process.env.TELNYX_API_KEY?.replace(/\r/g, '');
  connectionId ??= process.env.TELNYX_CONNECTION_ID?.replace(/\r/g, '');
  webhookUrl ??= process.env.TELNYX_WEBHOOK_URL?.replace(/\r/g, '');

  return {
    apiKey: apiKey ?? '',
    connectionId: connectionId ?? '',
    webhookUrl: webhookUrl ?? '',
  };
}

function telnyxHeaders() {
  const { apiKey } = getTelnyxEnv();
  if (!apiKey) throw new Error('TELNYX_API_KEY is not set');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

/** Initiate an outbound call via Telnyx Call Control. */
export async function initiateCall(params: {
  to: string;        // E.164 destination number, e.g. "+12125550100"
  from: string;      // Your Telnyx number in E.164
  clientState: string; // Base64-encoded state to thread through webhooks
}) {
  const res = await fetch(`${TELNYX_BASE}/calls`, {
    method: 'POST',
    headers: telnyxHeaders(),
    body: JSON.stringify({
      connection_id: getTelnyxEnv().connectionId || undefined,
      to: params.to,
      from: params.from,
      webhook_url: getTelnyxEnv().webhookUrl || undefined,
      client_state: params.clientState,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telnyx call initiation failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ data: { call_control_id: string; call_leg_id: string } }>;
}

/** Speak text on an active call (text-to-speech). */
export async function callSpeak(callControlId: string, payload: {
  payload: string;        // The text to speak
  language?: string;      // e.g. "en-US"
  voice?: string;         // e.g. "female"
  clientState?: string;
}) {
  const res = await fetch(`${TELNYX_BASE}/calls/${callControlId}/actions/speak`, {
    method: 'POST',
    headers: telnyxHeaders(),
    body: JSON.stringify({
      payload: payload.payload,
      language: payload.language ?? 'en-US',
      voice: payload.voice ?? 'female',
      client_state: payload.clientState,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telnyx speak failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Start real-time speech-to-text transcription on an active call.
 *
 * NOTE: gather_using_speak does NOT support speech recognition — it is DTMF-only.
 * The correct Telnyx STT API is start_transcription which fires call.transcription
 * webhooks with a `transcription_data.transcript` and `transcription_data.is_final`
 * on each utterance.
 *
 * Transcription engine options:
 *   'B' = Telnyx (default, available on all accounts)
 *   'A' = Google (requires Google STT integration secret in portal)
 *   'Deepgram' = Deepgram (requires Deepgram key)
 *
 * Webhook fired: call.transcription
 *   payload.transcription_data.transcript  — the spoken text
 *   payload.transcription_data.is_final    — true when utterance is complete
 *
 * NOTE: engine 'B' is a legacy alias — new SDK uses 'Telnyx'.
 * language must be a short BCP-47 root code ('en', NOT 'en-US') for engine Telnyx/B.
 */
export async function startTranscription(callControlId: string, options: {
  engine?: 'A' | 'B' | 'Google' | 'Telnyx' | 'Deepgram';
  language?: string;
  track?: 'inbound' | 'outbound' | 'both';
  clientState?: string;
}) {
  // Use 'Telnyx' (canonical engine name, alias for Whisper) — no external creds needed.
  // Keep body minimal: top-level transcription_engine + transcription_tracks only.
  const body: Record<string, unknown> = {
    transcription_engine: 'Telnyx',
    transcription_tracks: options.track ?? 'inbound',  // 'inbound' = caller voice only, not AI TTS
    client_state: options.clientState,
  };
  console.log('[telnyx] transcription_start request body:', JSON.stringify({ ...body, client_state: '<redacted>' }));
  const res = await fetch(`${TELNYX_BASE}/calls/${callControlId}/actions/transcription_start`, {
    method: 'POST',
    headers: telnyxHeaders(),
    body: JSON.stringify(body),
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`Telnyx start_transcription failed: ${res.status} ${responseText}`);
  }
  console.log('[telnyx] transcription_start response:', res.status, responseText.slice(0, 200));
  return JSON.parse(responseText);
}

/** Stop real-time speech-to-text transcription on an active call. */
export async function stopTranscription(callControlId: string, options?: {
  clientState?: string;
}) {
  const res = await fetch(`${TELNYX_BASE}/calls/${callControlId}/actions/transcription_stop`, {
    method: 'POST',
    headers: telnyxHeaders(),
    body: JSON.stringify({
      client_state: options?.clientState,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telnyx stop_transcription failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** Hang up a call. */
export async function callHangup(callControlId: string) {
  const res = await fetch(`${TELNYX_BASE}/calls/${callControlId}/actions/hangup`, {
    method: 'POST',
    headers: telnyxHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telnyx hangup failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** Encode arbitrary data as base64 for Telnyx client_state. */
export function encodeClientState(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

/** Decode Telnyx client_state back to an object. */
export function decodeClientState<T = Record<string, unknown>>(encoded: string): T {
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as T;
}
