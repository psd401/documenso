// ABOUTME: Unit tests for upload toast error mapping, ensuring every upload pipeline
// ABOUTME: error code (conversion, decryption, limits) maps to actionable, non-generic text.
import { AppErrorCode } from '@documenso/lib/errors/app-error';
import { describe, expect, it } from 'vitest';

import { getUploadErrorMessage } from './toast-error-messages';

const UPLOAD_ERROR_CODES = [
  AppErrorCode.ENCRYPTED_DOCUMENT_REQUIRES_PASSWORD,
  AppErrorCode.DECRYPTION_FAILED,
  AppErrorCode.DECRYPTION_TIMEOUT,
  AppErrorCode.CONVERSION_FAILED,
  AppErrorCode.CONVERSION_TIMEOUT,
  AppErrorCode.DEPENDENCY_MISSING,
  'INVALID_DOCUMENT_FILE',
  AppErrorCode.TOO_MANY_REQUESTS,
  AppErrorCode.LIMIT_EXCEEDED,
  'ENVELOPE_ITEM_LIMIT_EXCEEDED',
  'UNSUPPORTED_FILE_TYPE',
  'CONVERSION_SERVICE_UNAVAILABLE',
];

describe('getUploadErrorMessage', () => {
  const fallback = getUploadErrorMessage('__UNMAPPED_CODE__');

  it.each(UPLOAD_ERROR_CODES)('maps %s to a specific message', (code) => {
    const result = getUploadErrorMessage(code);

    expect(result.description.message).toBeTruthy();
    expect(result.description.id).not.toEqual(fallback.description.id);
  });

  it('does not tell users encrypted PDFs cannot be uploaded', () => {
    const result = getUploadErrorMessage('INVALID_DOCUMENT_FILE');

    expect(result.description.message).not.toMatch(/encrypted/i);
  });
});
