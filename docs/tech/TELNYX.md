# Telnyx Reference — XPElevator

Telnyx provides programmable communications (voice, SMS, fax). XPElevator uses it for **phone simulation** — employees practice phone-based customer interactions.

**SDK**: `telnyx` (official Node.js SDK)
**Dashboard**: https://portal.telnyx.com
**Docs**: https://developers.telnyx.com

---

## Installation

```bash
npm install telnyx
```

---

## Authentication

```ts
import Telnyx from 'telnyx';

const telnyx = Telnyx(process.env.TELNYX_API_KEY!);
```

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Call Control Application** | Config object in Telnyx portal that defines webhook URL for call events |
| **Call Control Session** | A live phone call managed via webhooks |
| **Webhook** | HTTP POST Telnyx sends to your server for each call event |
| **Command** | HTTP request from your server to Telnyx to control a call (speak, gather, hangup) |

### The Call Flow

```
1. Trainer initiates call → POST /api/telnyx/initiate
2. Telnyx dials the employee's phone
3. Employee answers → Telnyx sends 'call.answered' webhook
4. Your server sends 'speak' command → Telnyx reads AI-generated text
5. Employee responds → Telnyx streams audio to your server (or gathers DTMF)
6. Your server processes response → generate next AI reply → speak again
7. Either party hangs up → 'call.hangup' webhook
8. Session marked COMPLETED, auto-scoring triggered
```

---

## Outbound Call Initiation

```ts
// POST /api/telnyx/initiate
export async function POST(request: Request) {
  const { sessionId, employeePhone } = await request.json();

  const call = await telnyx.calls.create({
    connection_id: process.env.TELNYX_CONNECTION_ID!,
    to: employeePhone,          // employee's phone number (E.164: +12125551234)
    from: '+1XXXXXXXXXX',       // your Telnyx number
    webhook_url: `${process.env.NEXTAUTH_URL}/api/telnyx/webhook`,
    client_state: Buffer.from(JSON.stringify({ sessionId })).toString('base64'),
  });

  return NextResponse.json({ callControlId: call.call_control_id });
}
```

**`client_state`**: Pass session metadata through calls as base64-encoded string. Telnyx echoes it back on each webhook.

---

## Webhook Handler

```ts
// src/app/api/telnyx/webhook/route.ts
import Telnyx from 'telnyx';

export async function POST(request: Request) {
  const body = await request.json();
  const event = body.data;

  // Decode session metadata from client_state
  const state = event.payload?.client_state
    ? JSON.parse(Buffer.from(event.payload.client_state, 'base64').toString())
    : {};

  const callControlId: string = event.payload?.call_control_id;

  switch (event.event_type) {
    case 'call.initiated':
      // Call is ringing — nothing to do yet
      break;

    case 'call.answered':
      // Employee picked up — greet them with the AI customer
      await telnyx.calls.speak(callControlId, {
        payload: 'Hello, I am calling about my recent order...',
        voice: 'female',
        language: 'en-US',
      });
      break;

    case 'call.speak.ended':
      // AI finished speaking — start gathering employee response
      await telnyx.calls.gatherUsingAudio(callControlId, {
        // or use gather_using_speech for STT
      });
      break;

    case 'call.gather.ended':
      // Employee finished speaking — transcribe and generate AI reply
      const transcript = event.payload.transcription?.transcribed_text;
      // ... send to AI, get reply, speak again
      break;

    case 'call.hangup':
      // End the session, trigger scoring
      await endSession(state.sessionId);
      break;
  }

  // Always return 200 to acknowledge receipt
  return new Response('ok', { status: 200 });
}
```

---

## Text-to-Speech (AI → Employee)

```ts
// Make the AI customer "speak"
await telnyx.calls.speak(callControlId, {
  payload: aiGeneratedText,
  voice: 'female',        // 'male' | 'female'
  language: 'en-US',
  payload_type: 'text',   // 'text' | 'ssml'
});
```

### SSML for Natural Speech

```ts
// Add pauses and emphasis for more natural delivery
const ssml = `
<speak>
  I've been waiting <break time="300ms"/> three weeks for this refund.
  <emphasis level="strong">Three weeks!</emphasis>
  Can you tell me what's going on?
</speak>
`;

await telnyx.calls.speak(callControlId, {
  payload: ssml,
  payload_type: 'ssml',
  voice: 'female',
  language: 'en-US',
});
```

---

## Speech-to-Text (Employee → AI)

Telnyx supports real-time transcription via MediaStreaming or gather:

```ts
// Gather with speech recognition
await telnyx.calls.gatherUsingSpeech(callControlId, {
  minimum_silence_duration_millis: 1000,  // wait 1s after speech stops
});
// Result delivered via 'call.gather.ended' webhook with transcription
```

---

## Webhook Signature Verification

Always verify Telnyx webhooks to prevent spoofing:

```ts
import Telnyx from 'telnyx';

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('telnyx-signature-ed25519') ?? '';
  const timestamp = request.headers.get('telnyx-timestamp') ?? '';

  try {
    const event = telnyx.webhooks.constructEvent(
      body,
      signature,
      timestamp,
      process.env.TELNYX_PUBLIC_KEY!,  // from Telnyx portal → API Keys → Public Key
    );
    // process event...
  } catch (err) {
    return new Response('Invalid signature', { status: 400 });
  }
}
```

---

## Configuration in Telnyx Portal

1. **Create a Call Control Application**:
   - Portal → Voice → Call Control Applications → Create
   - Set **Webhook URL** to `https://xpelevator.com/api/telnyx/webhook`
   - Set **Webhook API Version** to V2
   - Copy the **Connection ID** → `TELNYX_CONNECTION_ID`

2. **Buy / Configure a Phone Number**:
   - Portal → Numbers → Buy a Number
   - Assign it to your Call Control Application

3. **API Key**:
   - Portal → API Keys → Create Key
   - Copy to `TELNYX_API_KEY` in `.env`

---

## Development / Testing

Telnyx cannot call `localhost`. Options for local testing:

```bash
# Option 1: ngrok tunnel
ngrok http 3000
# Use the ngrok HTTPS URL as your webhook URL in Telnyx portal

# Option 2: Telnyx dev environment
# Use the Telnyx debugger in the portal to replay webhook events

# Option 3: Mock the telnyx module in tests
```

---

## Phone Simulation Architecture (XPElevator)

```
Employee phone ← Telnyx PSTN ← [Call Control Session]
                                        ↕ webhooks/commands
                               /api/telnyx/webhook (Next.js)
                                        ↕
                               src/lib/ai.ts (Groq)
                                        ↕
                               Database (session, messages)
```

The `client_state` field threads the `sessionId` through the entire call lifecycle so every webhook handler can look up the correct session from the DB.
