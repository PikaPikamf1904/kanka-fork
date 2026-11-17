// The DM screen passcode, checked by /api/dm-gate on the server. The browser only sends what was
// typed and learns whether this browser has passed the screen (an HttpOnly cookie it cannot read).
import { useCallback, useEffect, useState } from 'react';

export type GateStatus = 'loading' | 'locked' | 'open' | 'unconfigured' | 'error';

export async function readGate(): Promise<GateStatus> {
  try {
    const res = await fetch('/api/dm-gate', { cache: 'no-store' });
    if (!res.ok) return 'error';
    const body = (await res.json()) as { configured?: boolean; open?: boolean };
    return !body.configured ? 'unconfigured' : body.open ? 'open' : 'locked';
  } catch {
    return 'error';
  }
}

export function useDmGate() {
  const [status, setStatus] = useState<GateStatus>('loading');
  const check = useCallback(async () => setStatus(await readGate()), []);
  useEffect(() => {
    // check() only sets state after awaiting the server, and this effect reads an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check();
  }, [check]);
  return { status, check };
}

export async function unlockDmGate(passcode: string): Promise<void> {
  const res = await fetch('/api/dm-gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? 'That passcode was not accepted.');
}

/** Close the DM screen on this browser. Best effort; the DM's own sign-in is separate. */
export async function lockDmGate(): Promise<void> {
  try {
    await fetch('/api/dm-gate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lock: true }),
    });
  } catch {
    // Offline: the cookie ends by itself after twelve hours.
  }
}
