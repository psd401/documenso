// ABOUTME: Tests for parseBrandingLogoFile covering valid logo references, empty values,
// ABOUTME: invalid JSON (including the corrupt single-quote value), and wrong-shape JSON.
import { DocumentDataType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { parseBrandingLogoFile } from './branding';

describe('parseBrandingLogoFile', () => {
  it('parses a valid uploaded logo reference', () => {
    const value = JSON.stringify({ type: DocumentDataType.BYTES_64, data: 'iVBORw0KGgo=' });

    expect(parseBrandingLogoFile(value)).toEqual({
      type: DocumentDataType.BYTES_64,
      data: 'iVBORw0KGgo=',
    });
  });

  it('returns null for empty or missing values', () => {
    expect(parseBrandingLogoFile('')).toBeNull();
    expect(parseBrandingLogoFile(null)).toBeNull();
    expect(parseBrandingLogoFile(undefined)).toBeNull();
  });

  it('returns null for invalid JSON instead of throwing', () => {
    expect(parseBrandingLogoFile("'")).toBeNull();
    expect(parseBrandingLogoFile('not json')).toBeNull();
    expect(parseBrandingLogoFile('{"type":')).toBeNull();
  });

  it('returns null for JSON that is not a logo file reference', () => {
    expect(parseBrandingLogoFile('"a string"')).toBeNull();
    expect(parseBrandingLogoFile('{"foo":1}')).toBeNull();
    expect(parseBrandingLogoFile('{"type":"NOT_A_TYPE","data":"abc"}')).toBeNull();
    expect(parseBrandingLogoFile('{"type":"BYTES_64"}')).toBeNull();
  });
});
