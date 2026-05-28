import { PDF, StandardFonts } from '@libpdf/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { convertToPdf, isPdfBuffer } from './convert-to-pdf';

/** Build a minimal one-page PDF. */
const buildPdf = async (): Promise<Buffer> => {
  const pdf = await PDF.create();
  const page = pdf.addPage();
  page.drawText('HELLO', { x: 50, y: 700, size: 14, font: StandardFonts.Helvetica });

  return Buffer.from(await pdf.save());
};

/** Build a raster image of the given format and dimensions. */
const buildImage = async (
  format: 'png' | 'jpeg',
  width: number,
  height: number,
): Promise<Buffer> => {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  });

  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
};

describe('isPdfBuffer', () => {
  it('detects a PDF buffer', async () => {
    expect(isPdfBuffer(await buildPdf())).toBe(true);
  });

  it('rejects a non-PDF buffer', async () => {
    expect(isPdfBuffer(await buildImage('png', 10, 10))).toBe(false);
  });
});

describe('convertToPdf', () => {
  it('returns PDFs untouched', async () => {
    const pdf = await buildPdf();
    const result = await convertToPdf(pdf);

    expect(result).toBe(pdf);
  });

  it('converts a PNG image into a single-page PDF', async () => {
    const result = await convertToPdf(await buildImage('png', 800, 600));

    expect(isPdfBuffer(result)).toBe(true);

    const doc = await PDF.load(new Uint8Array(result));
    expect(doc.getPageCount()).toBe(1);
  });

  it('converts a JPEG image into a single-page PDF', async () => {
    const result = await convertToPdf(await buildImage('jpeg', 400, 400));

    const doc = await PDF.load(new Uint8Array(result));
    expect(doc.getPageCount()).toBe(1);
  });

  it('orients the page to match a landscape image', async () => {
    const result = await convertToPdf(await buildImage('png', 1200, 400));

    const doc = await PDF.load(new Uint8Array(result));
    const page = doc.getPages()[0];

    // Landscape source -> landscape page (US Letter rotated).
    expect(page.width).toBeGreaterThan(page.height);
  });

  it('throws for an unsupported file', async () => {
    await expect(convertToPdf(Buffer.from('not a pdf or image'))).rejects.toThrow();
  });
});
