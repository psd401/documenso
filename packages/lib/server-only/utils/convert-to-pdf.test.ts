// ABOUTME: Tests for convert-to-pdf utility covering successful conversion, timeout, failure, and temp file cleanup.
// ABOUTME: Mocks find-binary and child_process to avoid real LibreOffice dependency in tests.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./find-binary', () => ({
  findBinary: vi.fn().mockResolvedValue('/usr/bin/soffice'),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('pdf output')),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue('/tmp/convert-abc123'),
  constants: { X_OK: 1 },
}));

describe('convertToPdf', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should return a PDF buffer on successful conversion', async () => {
    const childProcess = await import('child_process');
    const fsPromises = await import('fs/promises');

    vi.mocked(fsPromises.mkdtemp).mockResolvedValue('/tmp/convert-abc123');
    vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('converted pdf') as any);
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, '', '');
      return {} as any;
    });

    const { convertToPdf } = await import('./convert-to-pdf');
    const result = await convertToPdf(Buffer.from('docx content'), 'docx');

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe('converted pdf');
  });

  it('should invoke soffice with --convert-to pdf and --outdir flags', async () => {
    const childProcess = await import('child_process');
    const fsPromises = await import('fs/promises');

    let capturedArgs: string[] = [];
    vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('pdf') as any);
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, args, _opts, callback: any) => {
      capturedArgs = args as string[];
      callback(null, '', '');
      return {} as any;
    });

    const { convertToPdf } = await import('./convert-to-pdf');
    await convertToPdf(Buffer.from('content'), 'docx');

    expect(capturedArgs).toContain('--convert-to');
    expect(capturedArgs).toContain('pdf');
    expect(capturedArgs).toContain('--outdir');
    expect(capturedArgs).toContain('--headless');
  });

  it('should throw CONVERSION_FAILED when soffice exits with error', async () => {
    const childProcess = await import('child_process');

    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      const err: any = new Error('soffice crashed');
      err.code = 1;
      callback(err, '', 'crashed');
      return {} as any;
    });

    const { convertToPdf } = await import('./convert-to-pdf');
    await expect(convertToPdf(Buffer.from('content'), 'docx')).rejects.toMatchObject({
      code: 'CONVERSION_FAILED',
    });
  });

  it('should throw CONVERSION_TIMEOUT when soffice times out', async () => {
    const childProcess = await import('child_process');

    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      const err: any = new Error('timed out');
      err.killed = true;
      callback(err, '', '');
      return {} as any;
    });

    const { convertToPdf } = await import('./convert-to-pdf');
    await expect(convertToPdf(Buffer.from('content'), 'docx')).rejects.toMatchObject({
      code: 'CONVERSION_TIMEOUT',
    });
  });

  it('should clean up temp files after success', async () => {
    const childProcess = await import('child_process');
    const fsPromises = await import('fs/promises');

    vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('pdf') as any);
    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, '', '');
      return {} as any;
    });

    const { convertToPdf } = await import('./convert-to-pdf');
    await convertToPdf(Buffer.from('content'), 'docx');

    expect(fsPromises.unlink).toHaveBeenCalledTimes(2);
  });

  it('should clean up temp files after failure', async () => {
    const childProcess = await import('child_process');
    const fsPromises = await import('fs/promises');

    vi.mocked(childProcess.execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      const err: any = new Error('fail');
      err.code = 1;
      callback(err, '', '');
      return {} as any;
    });

    const { convertToPdf } = await import('./convert-to-pdf');
    await expect(convertToPdf(Buffer.from('content'), 'docx')).rejects.toBeDefined();

    expect(fsPromises.unlink).toHaveBeenCalledTimes(2);
  });
});
