// ABOUTME: Converts office documents (docx, doc) to PDF using LibreOffice soffice --headless.
// ABOUTME: Validates magic bytes and size before conversion, uses temp files, and cleans up.

import * as childProcess from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { AppError } from '../../errors/app-error';
import { findBinary } from './find-binary';

const CONVERSION_TIMEOUT_MS = 60_000;
const MAX_CONVERSION_SIZE = 25 * 1024 * 1024;

const DOCX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK ZIP header (OOXML)
const DOC_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]); // CFBF header (OLE2/legacy .doc)

const isValidDocumentContent = (buffer: Buffer): boolean => {
  if (buffer.length < 4) return false;
  const header = buffer.subarray(0, 4);
  return header.equals(DOCX_MAGIC) || header.equals(DOC_MAGIC);
};

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
  if (input.length > MAX_CONVERSION_SIZE) {
    throw new AppError('CONVERSION_FAILED', {
      message: `Document is too large for conversion (${Math.round(input.length / 1024 / 1024)}MB, limit is 25MB). Convert to PDF manually.`,
    });
  }

  if (!isValidDocumentContent(input)) {
    throw new AppError('INVALID_DOCUMENT_FILE', {
      message: "File content doesn't match its type. Please upload a valid Word document or PDF.",
    });
  }

  const sofficePath = await findBinary('soffice');

  const tmpDir = await mkdtemp(join(tmpdir(), 'documenso-convert-'));
  const inputPath = join(tmpDir, `input.${extension}`);
  const outputPath = join(tmpDir, 'input.pdf');

  try {
    await writeFile(inputPath, input);

    await execFileAsync(
      sofficePath,
      ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inputPath],
      { timeout: CONVERSION_TIMEOUT_MS },
    );

    return await readFile(outputPath);
  } catch (err: any) {
    if (err instanceof AppError) throw err;

    if (err?.killed) {
      throw new AppError('CONVERSION_TIMEOUT', {
        message: `LibreOffice timed out after ${CONVERSION_TIMEOUT_MS / 1000}s. Try a smaller file or convert to PDF manually.`,
      });
    }

    throw new AppError('CONVERSION_FAILED', {
      message: `LibreOffice failed to convert ${extension} to PDF: ${err?.message ?? String(err)}`,
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
};
