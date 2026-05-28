import { PDF } from '@libpdf/core';
import sharp from 'sharp';

import { AppError } from '../../errors/app-error';

/** US Letter page dimensions in PDF points (1pt = 1/72"). */
const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;

/**
 * Returns true when the buffer is already a PDF.
 *
 * Detection is content based rather than relying on the client supplied mime
 * type, which is frequently wrong or missing. PDFs begin with the `%PDF-`
 * header; some generators emit a small amount of leading junk so we scan the
 * first kilobyte rather than only the first bytes.
 */
export const isPdfBuffer = (buffer: Buffer): boolean =>
  buffer.subarray(0, 1024).toString('latin1').includes('%PDF-');

/**
 * Converts a single raster image into a one page PDF.
 *
 * The image is scaled to fit a US Letter page (preserving aspect ratio) and
 * centred, so the source resolution doesn't dictate the physical page size. The
 * page orientation follows the image so portrait scans stay portrait.
 */
const convertImageToPdf = async (buffer: Buffer): Promise<Buffer> => {
  let png: Buffer;
  let width: number;
  let height: number;

  try {
    // Re-encode to PNG via sharp. This normalizes every input format sharp can
    // decode (JPEG, PNG, WebP, GIF, TIFF, AVIF, ...), applies the EXIF
    // orientation, and flattens any transparency onto a white background so the
    // embedded image renders predictably.
    const { data, info } = await sharp(buffer)
      .rotate()
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer({ resolveWithObject: true });

    png = data;
    width = info.width;
    height = info.height;
  } catch {
    throw new AppError('INVALID_DOCUMENT_FILE', {
      message: 'The file is not a PDF or a supported image format',
      statusCode: 400,
    });
  }

  if (!width || !height) {
    throw new AppError('INVALID_DOCUMENT_FILE', {
      message: 'The image could not be read',
      statusCode: 400,
    });
  }

  const landscape = width > height;
  const pageWidth = landscape ? LETTER_HEIGHT : LETTER_WIDTH;
  const pageHeight = landscape ? LETTER_WIDTH : LETTER_HEIGHT;

  const scale = Math.min(pageWidth / width, pageHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;

  const pdf = PDF.create();
  const page = pdf.addPage({ width: pageWidth, height: pageHeight });
  const image = pdf.embedPng(new Uint8Array(png));

  page.drawImage(image, {
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });

  return Buffer.from(await pdf.save());
};

/**
 * Ensures an uploaded file is a PDF, converting supported image formats on the
 * fly so signers can upload scans and photos directly.
 *
 * PDFs are returned untouched. Convertible images become a single page PDF.
 * Anything else throws `INVALID_DOCUMENT_FILE`.
 *
 * Safe to call more than once: an already converted PDF short circuits, so this
 * can be applied defensively at lower layers without re-processing.
 */
export const convertToPdf = async (buffer: Buffer): Promise<Buffer> => {
  if (isPdfBuffer(buffer)) {
    return buffer;
  }

  return await convertImageToPdf(buffer);
};
