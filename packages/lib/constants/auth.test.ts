// ABOUTME: Unit tests for the password-signup gating helper covering the blanket
// ABOUTME: disable-signup flag and the password-signup-specific flag.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.fn();

vi.mock('../utils/env', () => ({
  env: mockEnv,
}));

describe('isPasswordSignupDisabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns false when neither flag is set', async () => {
    mockEnv.mockReturnValue(undefined);

    const { isPasswordSignupDisabled } = await import('./auth');

    expect(isPasswordSignupDisabled()).toBe(false);
  });

  it('returns true when NEXT_PUBLIC_DISABLE_SIGNUP is true', async () => {
    mockEnv.mockImplementation((key: string) => (key === 'NEXT_PUBLIC_DISABLE_SIGNUP' ? 'true' : undefined));

    const { isPasswordSignupDisabled } = await import('./auth');

    expect(isPasswordSignupDisabled()).toBe(true);
  });

  it('returns true when NEXT_PUBLIC_DISABLE_PASSWORD_SIGNUP is true', async () => {
    mockEnv.mockImplementation((key: string) => (key === 'NEXT_PUBLIC_DISABLE_PASSWORD_SIGNUP' ? 'true' : undefined));

    const { isPasswordSignupDisabled } = await import('./auth');

    expect(isPasswordSignupDisabled()).toBe(true);
  });

  it('returns false when both flags are explicitly false', async () => {
    mockEnv.mockReturnValue('false');

    const { isPasswordSignupDisabled } = await import('./auth');

    expect(isPasswordSignupDisabled()).toBe(false);
  });
});

describe('isSignupEnabledForProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('disables email signup when NEXT_PUBLIC_DISABLE_PASSWORD_SIGNUP is true', async () => {
    mockEnv.mockImplementation((key: string) => (key === 'NEXT_PUBLIC_DISABLE_PASSWORD_SIGNUP' ? 'true' : undefined));

    const { isSignupEnabledForProvider } = await import('./auth');

    expect(isSignupEnabledForProvider('email')).toBe(false);
    expect(isSignupEnabledForProvider('google')).toBe(true);
  });

  it('disables email signup when NEXT_PUBLIC_DISABLE_EMAIL_PASSWORD_SIGNUP is true', async () => {
    mockEnv.mockImplementation((key: string) =>
      key === 'NEXT_PUBLIC_DISABLE_EMAIL_PASSWORD_SIGNUP' ? 'true' : undefined,
    );

    const { isSignupEnabledForProvider } = await import('./auth');

    expect(isSignupEnabledForProvider('email')).toBe(false);
  });

  it('enables email signup when no flag is set', async () => {
    mockEnv.mockReturnValue(undefined);

    const { isSignupEnabledForProvider } = await import('./auth');

    expect(isSignupEnabledForProvider('email')).toBe(true);
  });
});

describe('isSignupPageEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('is disabled when password signup is disabled even though Google signup is allowed', async () => {
    mockEnv.mockImplementation((key: string) => {
      if (key === 'NEXT_PUBLIC_DISABLE_PASSWORD_SIGNUP') {
        return 'true';
      }

      if (key === 'NEXT_PRIVATE_GOOGLE_CLIENT_ID' || key === 'NEXT_PRIVATE_GOOGLE_CLIENT_SECRET') {
        return 'configured';
      }

      return undefined;
    });

    const { isSignupPageEnabled, isSignupEnabledForProvider } = await import('./auth');

    expect(isSignupEnabledForProvider('google')).toBe(true);
    expect(isSignupPageEnabled()).toBe(false);
  });

  it('is enabled when email/password signup is allowed', async () => {
    mockEnv.mockReturnValue(undefined);

    const { isSignupPageEnabled } = await import('./auth');

    expect(isSignupPageEnabled()).toBe(true);
  });
});
