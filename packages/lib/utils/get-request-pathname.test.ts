// ABOUTME: Tests that loader redirects built from request.url never keep React Router's
// ABOUTME: single-fetch `.data` suffix (RR8 passes the raw data request to loaders).
import { describe, expect, it } from 'vitest';

import { getRequestPathname } from './get-request-pathname';

describe('getRequestPathname', () => {
  it('returns a document request pathname unchanged', () => {
    const request = new Request('https://documenso.psd401.net/t/tsd/documents/3585');

    expect(getRequestPathname(request)).toBe('/t/tsd/documents/3585');
  });

  it('strips the single-fetch .data suffix from client navigation requests', () => {
    const request = new Request('https://documenso.psd401.net/t/tsd/documents/3585.data');

    expect(getRequestPathname(request)).toBe('/t/tsd/documents/3585');
  });

  it('strips the .data suffix from nested paths', () => {
    const request = new Request('https://documenso.psd401.net/t/tsd/documents/3585/edit.data');

    expect(getRequestPathname(request)).toBe('/t/tsd/documents/3585/edit');
  });

  it('maps the root single-fetch path back to /', () => {
    const request = new Request('https://documenso.psd401.net/_root.data');

    expect(getRequestPathname(request)).toBe('/');
  });

  it('maps the index single-fetch path back to its trailing slash', () => {
    const request = new Request('https://documenso.psd401.net/t/tsd/_.data');

    expect(getRequestPathname(request)).toBe('/t/tsd/');
  });
});
