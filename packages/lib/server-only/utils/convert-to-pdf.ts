// ABOUTME: Converts office documents (docx, xlsx, pptx, etc.) to PDF using LibreOffice soffice.
// ABOUTME: Writes input to a temp file, invokes soffice --headless, reads output, and cleans up.

import * as childProcess from 'child_process';
import { mkdtemp, readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { AppError } from '../../errors/app-error';
import { findBinary } from './find-binary';

const CONVERSION_TIMEOUT_MS = 120_000;

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

export const convertToPdf = async (input: Buffer, extension: string): Promise<Buffer> => {
  const sofficePath = await findBinary('soffice');

  const tmpDir = await mkdtemp(join(tmpdir(), 'documenso-convert-'));
  const inputPath = join(tmpDir, `input.${extension}`);
  const outputPath = join(tmpDir, 'input.pdf');

  const cleanup = async () => {
    await unlink(inputPath).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
  };

  await writeFile(inputPath, input);

  try {
    await execFileAsync(
      sofficePath,
      ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inputPath],
      { timeout: CONVERSION_TIMEOUT_MS },
    );
  } catch (err: any) {
    await cleanup();

    if (err?.killed) {
      throw new AppError('CONVERSION_TIMEOUT', {
        message: `LibreOffice timed out after ${CONVERSION_TIMEOUT_MS / 1000}s converting ${extension} to PDF.`,
      });
    }

    throw new AppError('CONVERSION_FAILED', {
      message: `LibreOffice failed to convert ${extension} to PDF: ${err?.message ?? String(err)}`,
    });
  }

  const output = await readFile(outputPath);
  await cleanup();

  return output;
};
