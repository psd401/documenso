// ABOUTME: Tests for find-binary utility covering which lookup, known paths fallback, caching, and error handling.
// ABOUTME: Uses vi.mock to control child_process.execFile and fs/promises.access behavior.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  constants: { X_OK: 1 },
}));

describe('findBinary', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should resolve a binary found via which', async () => {
    const childProcess = await import('child_process');
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, '/usr/bin/qpdf\n', '');
      return {} as any;
    });

    const { findBinary } = await import('./find-binary');
    const path = await findBinary('qpdf');
    expect(path).toBe('/usr/bin/qpdf');
  });

  it('should take only first line from multi-line which output', async () => {
    const childProcess = await import('child_process');
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, '/usr/bin/qpdf\n/usr/local/bin/qpdf\n', '');
      return {} as any;
    });

    const { findBinary } = await import('./find-binary');
    const path = await findBinary('qpdf');
    expect(path).toBe('/usr/bin/qpdf');
  });

  it('should fall back to known paths when which fails', async () => {
    const childProcess = await import('child_process');
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(new Error('not found'), '', '');
      return {} as any;
    });

    const { findBinary } = await import('./find-binary');
    try {
      const path = await findBinary('qpdf');
      expect(path).toMatch(/qpdf$/);
    } catch (e: any) {
      expect(e.code).toBe('DEPENDENCY_MISSING');
    }
  });

  it('should throw DEPENDENCY_MISSING for unknown binary', async () => {
    const childProcess = await import('child_process');
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(new Error('not found'), '', '');
      return {} as any;
    });

    const { findBinary } = await import('./find-binary');
    await expect(findBinary('nonexistent_binary_xyz')).rejects.toMatchObject({
      code: 'DEPENDENCY_MISSING',
    });
  });

  it('should cache resolved paths', async () => {
    let callCount = 0;
    const childProcess = await import('child_process');
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callCount++;
      callback(null, '/usr/bin/qpdf\n', '');
      return {} as any;
    });

    const { findBinary } = await import('./find-binary');
    await findBinary('qpdf');
    await findBinary('qpdf');
    expect(callCount).toBe(1);
  });

  it('should clear cache when clearBinaryCache is called', async () => {
    let callCount = 0;
    const childProcess = await import('child_process');
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callCount++;
      callback(null, '/usr/bin/qpdf\n', '');
      return {} as any;
    });

    const { findBinary, clearBinaryCache } = await import('./find-binary');
    await findBinary('qpdf');
    clearBinaryCache();
    await findBinary('qpdf');
    expect(callCount).toBe(2);
  });
});
