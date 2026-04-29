// ABOUTME: Decrypts password-protected PDF files using qpdf as an external process.
// ABOUTME: Writes to temp files, invokes qpdf, reads output, and cleans up regardless of outcome.

import * as childProcess from 'child_process';
import { constants, mkdtemp, readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { AppError } from '../../errors/app-error';
import { findBinary } from './find-binary';

// qpdf exit codes: 0 = success, 2 = bad password, 3+ = other errors
const QPDF_EXIT_BAD_PASSWORD = 2;

const execFileAsync = (
  cmd: string,
  args: string[],
  options: { timeout?: number },
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

  const cleanup = async () => {
    await unlink(inputPath).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
  };

  await writeFile(inputPath, pdf);

  try {
    await execFileAsync(
      qpdfPath,
      [`--password=${password}`, '--decrypt', inputPath, outputPath],
      { timeout: 30_000 },
    );
  } catch (err: any) {
    await cleanup();

    if (err?.code === QPDF_EXIT_BAD_PASSWORD) {
      throw new AppError('ENCRYPTED_DOCUMENT_REQUIRES_PASSWORD', {
        message: 'The PDF requires a valid password to decrypt.',
      });
    }

    throw new AppError('DECRYPTION_FAILED', {
      message: `qpdf decryption failed: ${err?.message ?? String(err)}`,
    });
  }

  const output = await readFile(outputPath);
  await cleanup();

  return output;
};
