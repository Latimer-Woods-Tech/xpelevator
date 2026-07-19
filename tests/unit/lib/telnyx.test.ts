/**
 * Unit tests for src/lib/telnyx.ts
 *
 * Bridges tested:
 *   1. encodeClientState / decodeClientState round-trip — baggage carried intact
 *   2. initiateCall sends correct POST to Telnyx API    — man steps onto bridge
 *   3. initiateCall throws when TELNYX_API_KEY missing  — bridge locked, no crossing
 *   4. callSpeak sends speak action                     — voice heard halfway across
 *   5. start/stopTranscription send transcription actions — STT lifecycle
 *   6. callHangup sends hangup action                   — bridge exit
 *   7. Telnyx API error surfaces as thrown Error        — bridge collapses, caught
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── mock global fetch BEFORE importing telnyx.ts ─────────────────────────────
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  encodeClientState,
  decodeClientState,
  initiateCall,
  callSpeak,
  startTranscription,
  stopTranscription,
  callHangup,
  getTelnyxPublicKey,
} from '@/lib/telnyx';

// ─────────────────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function makeErrorResponse(status: number, text: string) {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('not JSON')),
    text: () => Promise.resolve(text),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/telnyx — encodeClientState / decodeClientState', () => {
  it('round-trips a plain object', () => {
    const state = { sessionId: 'sess-1', scenarioId: 'sc-1', turnCount: 3 };
    const encoded = encodeClientState(state);
    expect(typeof encoded).toBe('string');
    const decoded = decodeClientState<typeof state>(encoded);
    expect(decoded).toEqual(state);
  });

  it('produces a base64 string (no spaces, valid chars)', () => {
    const encoded = encodeClientState({ x: 1 });
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('round-trips a state with special characters in strings', () => {
    const state = { note: 'Customer said: "Hello & goodbye 😊"' };
    const encoded = encodeClientState(state);
    expect(decodeClientState<typeof state>(encoded)).toEqual(state);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/telnyx — initiateCall', () => {
  const originalKey = process.env.TELNYX_API_KEY;

  beforeEach(() => {
    process.env.TELNYX_API_KEY = 'test-key';
    process.env.TELNYX_CONNECTION_ID = 'conn-id';
    process.env.TELNYX_WEBHOOK_URL = 'https://example.com/webhook';
    fetchMock.mockReset();
  });

  afterEach(() => {
    process.env.TELNYX_API_KEY = originalKey;
  });

  it('sends POST to /v2/calls with correct payload', async () => {
    fetchMock.mockResolvedValueOnce(
      makeOkResponse({ data: { call_control_id: 'cc-123', call_leg_id: 'leg-456' } })
    );

    const result = await initiateCall({
      to: '+12125550100',
      from: '+15550000000',
      clientState: 'abc123',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v2/calls');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string);
    expect(body.to).toBe('+12125550100');
    expect(body.from).toBe('+15550000000');
    expect(body.client_state).toBe('abc123');
    expect(body.webhook_url).toBe('https://example.com/webhook');

    expect(result.data.call_control_id).toBe('cc-123');
  });

  it('throws when TELNYX_API_KEY is not set', async () => {
    delete process.env.TELNYX_API_KEY;
    await expect(
      initiateCall({ to: '+1', from: '+1', clientState: '' })
    ).rejects.toThrow('TELNYX_API_KEY is not set');
  });

  it('throws with status code when Telnyx returns non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(makeErrorResponse(422, 'Invalid number'));
    await expect(
      initiateCall({ to: '+12125550100', from: '+15550000000', clientState: '' })
    ).rejects.toThrow('422');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/telnyx — callSpeak', () => {
  beforeEach(() => {
    process.env.TELNYX_API_KEY = 'test-key';
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(makeOkResponse({}));
  });

  it('sends POST to /actions/speak with text payload', async () => {
    await callSpeak('cc-789', { payload: 'Hello, thank you for calling.' });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('cc-789/actions/speak');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string);
    expect(body.payload).toBe('Hello, thank you for calling.');
    expect(body.language).toBe('en-US');
    // Default voice is a natural US-English female Polly Neural voice.
    expect(body.voice).toBe('Polly.Joanna-Neural');
  });

  it('uses custom language and voice when provided', async () => {
    await callSpeak('cc-789', { payload: 'Bonjour', language: 'fr-FR', voice: 'male' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.language).toBe('fr-FR');
    expect(body.voice).toBe('male');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/telnyx — startTranscription / stopTranscription', () => {
  beforeEach(() => {
    process.env.TELNYX_API_KEY = 'test-key';
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(makeOkResponse({ data: {} }));
  });

  it('startTranscription POSTs to /actions/transcription_start with the Telnyx engine', async () => {
    await startTranscription('cc-101', { clientState: 'state-xyz' });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('cc-101/actions/transcription_start');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string);
    expect(body.transcription_engine).toBe('Telnyx');
    // Defaults to caller audio only so the customer's own TTS is not transcribed.
    expect(body.transcription_tracks).toBe('inbound');
    expect(body.client_state).toBe('state-xyz');
  });

  it('startTranscription honours an explicit track', async () => {
    await startTranscription('cc-101', { track: 'both' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.transcription_tracks).toBe('both');
  });

  it('stopTranscription POSTs to /actions/transcription_stop', async () => {
    await stopTranscription('cc-202', { clientState: 'st' });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('cc-202/actions/transcription_stop');
    expect(opts.method).toBe('POST');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/telnyx — callHangup', () => {
  beforeEach(() => {
    process.env.TELNYX_API_KEY = 'test-key';
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(makeOkResponse({}));
  });

  it('sends POST to /actions/hangup', async () => {
    await callHangup('cc-202');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('cc-202/actions/hangup');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lib/telnyx — getTelnyxPublicKey', () => {
  const original = process.env.TELNYX_PUBLIC_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.TELNYX_PUBLIC_KEY;
    else process.env.TELNYX_PUBLIC_KEY = original;
  });

  it('returns undefined when the key is unset everywhere', () => {
    // getCloudflareContext() throws outside a Worker → process.env fallback,
    // which is also unset here.
    delete process.env.TELNYX_PUBLIC_KEY;
    expect(getTelnyxPublicKey()).toBeUndefined();
  });

  it('reads the process.env fallback and trims a trailing newline (GCP-SM trap)', () => {
    process.env.TELNYX_PUBLIC_KEY = 'cHVia2V5\n';
    expect(getTelnyxPublicKey()).toBe('cHVia2V5');
  });

  it('treats a whitespace-only value as unset', () => {
    process.env.TELNYX_PUBLIC_KEY = '  \n';
    expect(getTelnyxPublicKey()).toBeUndefined();
  });
});
