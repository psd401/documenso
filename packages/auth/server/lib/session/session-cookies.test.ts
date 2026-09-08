// ABOUTME: Regression test for the 30-day login loop: the session cookie's Expires
// ABOUTME: attribute must be computed per request, not once at module load.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_SESSION_LIFETIME } from '../../config';

vi.mock('@documenso/lib/utils/env', () => ({
  env: (key: string) => (key === 'NEXTAUTH_SECRET' ? 'test-secret' : undefined),
}));

const MODULE_LOAD_TIME = new Date('2026-08-05T16:08:45.000Z');

describe('getSessionCookieOptions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MODULE_LOAD_TIME);
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes expires relative to the current request time, not module load time', async () => {
    const { getSessionCookieOptions } = await import('./session-cookies');

    // Advance the clock 31 days past module load, as a long-running container would.
    const requestTime = new Date(MODULE_LOAD_TIME.getTime() + 31 * 24 * 60 * 60 * 1000);
    vi.setSystemTime(requestTime);

    const { expires } = getSessionCookieOptions();

    expect(expires.getTime()).toBe(requestTime.getTime() + AUTH_SESSION_LIFETIME);
    expect(expires.getTime()).toBeGreaterThan(requestTime.getTime());
  });

  it('sets the session cookie with an Expires in the future on a long-running process', async () => {
    const { setSessionCookie } = await import('./session-cookies');

    const requestTime = new Date(MODULE_LOAD_TIME.getTime() + 31 * 24 * 60 * 60 * 1000);
    vi.setSystemTime(requestTime);

    const headers = new Headers();
    const context = {
      header: (name: string, value: string, opts?: { append?: boolean }) => {
        if (opts?.append) {
          headers.append(name, value);
        } else {
          headers.set(name, value);
        }
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setSessionCookie(context as any, 'session-token');

    const setCookie = headers.get('set-cookie') ?? '';
    const match = /Expires=([^;]+)/i.exec(setCookie);

    expect(match).not.toBeNull();
    expect(new Date(match![1]).getTime()).toBeGreaterThan(requestTime.getTime());
  });
});
