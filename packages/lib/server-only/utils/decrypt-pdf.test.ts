// ABOUTME: Tests for decrypt-pdf utility covering successful decryption, wrong password, and non-encrypted PDF handling.
// ABOUTME: Mocks find-binary and child_process to avoid real qpdf dependency in tests.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./find-binary', () => ({
  findBinary: vi.fn().mockResolvedValue('/usr/bin/qpdf'),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('decrypted pdf content')),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue('/tmp/decrypt-abc123'),
  constants: { X_OK: 1 },
}));

describe('decryptPdf', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should return decrypted PDF buffer on success', async () => {
    const childProcess = await import('child_process');
    const fsPromises = await import('fs/promises');

    vi.mocked(fsPromises.mkdtemp).mockResolvedValue('/tmp/decrypt-abc123');
    vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('decrypted content') as any);
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, '', '');
      return {} as any;
    });

    const { decryptPdf } = await import('./decrypt-pdf');
    const input = Buffer.from('encrypted pdf');
    const result = await decryptPdf(input, 'secret');

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe('decrypted content');
  });

  it('should throw ENCRYPTED_DOCUMENT_REQUIRES_PASSWORD when qpdf exits with bad password', async () => {
    const childProcess = await import('child_process');

    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      const err: any = new Error('bad password');
      err.code = 2;
      callback(err, '', 'invalid password');
      return {} as any;
    });

    const { decryptPdf } = await import('./decrypt-pdf');
    await expect(decryptPdf(Buffer.from('pdf'), 'wrong')).rejects.toMatchObject({
      code: 'ENCRYPTED_DOCUMENT_REQUIRES_PASSWORD',
    });
  });

  it('should throw DECRYPTION_FAILED when qpdf exits with a non-password error', async () => {
    const childProcess = await import('child_process');

    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      const err: any = new Error('damaged pdf');
      err.code = 3;
      callback(err, '', 'structural error');
      return {} as any;
    });

    const { decryptPdf } = await import('./decrypt-pdf');
    await expect(decryptPdf(Buffer.from('pdf'), 'pass')).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('should pass empty string password when none provided', async () => {
    const childProcess = await import('child_process');
    const fsPromises = await import('fs/promises');

    let capturedArgs: string[] = [];
    vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('output') as any);
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, args, _opts, callback: any) => {
      capturedArgs = args as string[];
      callback(null, '', '');
      return {} as any;
    });

    const { decryptPdf } = await import('./decrypt-pdf');
    await decryptPdf(Buffer.from('pdf'));

    expect(capturedArgs).toContain('--password=');
  });

  it('should clean up temp files after success', async () => {
    const childProcess = await import('child_process');
    const fsPromises = await import('fs/promises');

    vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('output') as any);
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, '', '');
      return {} as any;
    });

    const { decryptPdf } = await import('./decrypt-pdf');
    await decryptPdf(Buffer.from('pdf'), 'pass');

    expect(fsPromises.unlink).toHaveBeenCalledTimes(2);
  });

  it('should clean up temp files after failure', async () => {
    const childProcess = await import('child_process');
    const fsPromises = await import('fs/promises');

    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      const err: any = new Error('fail');
      err.code = 2;
      callback(err, '', '');
      return {} as any;
    });

    const { decryptPdf } = await import('./decrypt-pdf');

    await expect(decryptPdf(Buffer.from('pdf'), 'pass')).rejects.toBeDefined();
    expect(fsPromises.unlink).toHaveBeenCalledTimes(2);
  });
});
