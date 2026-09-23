// ABOUTME: Unit tests for JobClient cron startup failure handling.
// ABOUTME: Covers that a provider-initialization failure during startCron surfaces loudly instead of being swallowed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetInstance = vi.fn();

vi.mock('./local', () => ({
  LocalJobProvider: { getInstance: mockGetInstance },
}));

vi.mock('../../utils/env', () => ({
  env: vi.fn(() => undefined),
}));

describe('JobClient.startCron', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mockGetInstance.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('logs and rethrows when provider initialization fails, instead of swallowing the error', async () => {
    const initError = new Error('boom');
    mockGetInstance.mockImplementation(() => {
      throw initError;
    });

    const { JobClient } = await import('./client');
    const client = new JobClient([]);

    await expect(client.startCron()).rejects.toThrow('boom');

    expect(consoleErrorSpy).toHaveBeenCalledWith('[jobs] cron startup failed', initError);
  });

  it('starts the provider cron scheduler when initialization succeeds', async () => {
    const providerStartCron = vi.fn();
    mockGetInstance.mockReturnValue({ startCron: providerStartCron, defineJob: vi.fn() });

    const { JobClient } = await import('./client');
    const client = new JobClient([]);

    await client.startCron();

    expect(providerStartCron).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
