import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function GET() {
  let cfConnectionId: string | undefined;
  let cfError: string | undefined;

  try {
    const { env } = getCloudflareContext();
    const cfEnv = env as Record<string, string | undefined>;
    cfConnectionId = cfEnv.TELNYX_CONNECTION_ID;
  } catch (e) {
    cfError = String(e);
  }

  const processConnectionId = process.env.TELNYX_CONNECTION_ID;

  const mask = (v: string | undefined) =>
    v ? `${v.slice(0, 6)}...${v.slice(-4)} (len ${v.length})` : '(undefined)';

  return NextResponse.json({
    cfContext: {
      connectionId: mask(cfConnectionId),
      error: cfError ?? null,
    },
    processEnv: {
      connectionId: mask(processConnectionId),
    },
    resolved: mask(cfConnectionId ?? processConnectionId),
  });
}
