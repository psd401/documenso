// ABOUTME: Normalizes a PDF buffer by flattening layers, form fields, and annotations.
// ABOUTME: Handles encrypted PDFs by decrypting them first via qpdf before normalization.

import { PDF } from '@libpdf/core';

import { AppError } from '../../errors/app-error';
import { decryptPdf } from '../utils/decrypt-pdf';

export const normalizePdf = async (pdf: Buffer, options: { flattenForm?: boolean } = {}) => {
  const shouldFlattenForm = options.flattenForm ?? true;

  let pdfBuffer = pdf;

  const pdfDoc = await PDF.load(pdfBuffer).catch((e) => {
    console.error(`PDF normalization error: ${e.message}`);

    throw new AppError('INVALID_DOCUMENT_FILE', {
      message: 'The document is not a valid PDF',
    });
  });

  if (pdfDoc.isEncrypted) {
    pdfBuffer = await decryptPdf(pdfBuffer);

    const decryptedDoc = await PDF.load(pdfBuffer).catch((e) => {
      console.error(`PDF normalization error after decryption: ${e.message}`);
      throw new AppError('INVALID_DOCUMENT_FILE', {
        message: 'The document is not a valid PDF after decryption',
      });
    });

    decryptedDoc.flattenLayers();

    const form = decryptedDoc.getForm();

    if (shouldFlattenForm && form) {
      form.flatten();
      decryptedDoc.flattenAnnotations();
    }

    const normalizedPdfBytes = await decryptedDoc.save();

    return Buffer.from(normalizedPdfBytes);
  }

  pdfDoc.flattenLayers();

  const form = pdfDoc.getForm();

  if (shouldFlattenForm && form) {
    form.flatten();
    pdfDoc.flattenAnnotations();
  }

  const normalizedPdfBytes = await pdfDoc.save();

  return Buffer.from(normalizedPdfBytes);
};
