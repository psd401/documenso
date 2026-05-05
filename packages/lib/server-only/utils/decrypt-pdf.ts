// ABOUTME: Decrypts password-protected PDF files using qpdf as an external process.
// ABOUTME: Writes to a private temp directory, invokes qpdf --decrypt, reads output, and cleans up the whole directory.

import * as childProcess from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { AppError } from '../../errors/app-error';
import { findBinary } from './find-binary';

const QPDF_TIMEOUT_MS = 30_000;
const QPDF_EXIT_BAD_PASSWORD = 2;

const execFileAsync = (
  cmd: string,
  args: string[],
  options: { timeout?: number; killSignal?: NodeJS.Signals },
): Promise<void> =>
  new Promise((resolve, reject) => {
    childProcess.execFile(cmd, args, options, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

export const decryptPdf = async (pdf: Buffer, password = ''): Promise<Buffer> => {
  const qpdfPath = await findBinary('qpdf');

  const tmpDir = await mkdtemp(join(tmpdir(), 'documenso-decrypt-'));
  const inputPath = join(tmpDir, 'input.pdf');
  const outputPath = join(tmpDir, 'output.pdf');

  try {
    await writeFile(inputPath, pdf, { mode: 0o600 });

    await execFileAsync(
      qpdfPath,
      [`--password=${password}`, '--decrypt', inputPath, outputPath],
      { timeout: QPDF_TIMEOUT_MS, killSignal: 'SIGKILL' },
    );

    return await readFile(outputPath);
  } catch (err: any) {
    if (err instanceof AppError) throw err;

    if (err?.killed) {
      throw new AppError('DECRYPTION_FAILED', {
        message: 'PDF decryption timed out',
      });
    }

    if (Number(err?.code) === QPDF_EXIT_BAD_PASSWORD) {
      throw new AppError('ENCRYPTED_DOCUMENT_REQUIRES_PASSWORD', {
        message: 'This PDF is password-protected. Please remove the password or export an unencrypted version.',
      });
    }

    throw new AppError('DECRYPTION_FAILED', {
      message: `qpdf decryption failed: ${err?.message ?? String(err)}`,
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
};
