// ABOUTME: Returns a loader request's browser-facing pathname. React Router 8 passes the raw
// ABOUTME: single-fetch request (`/path.data`) to loaders, so redirects must strip the suffix.

/**
 * Get the pathname of a loader request without the single-fetch `.data` suffix.
 *
 * Mirrors react-router's own normalization in `server-runtime/urls.js`.
 */
export const getRequestPathname = (request: Request) => {
  const { pathname } = new URL(request.url);

  if (pathname === '/_root.data') {
    return '/';
  }

  if (pathname.endsWith('/_.data')) {
    return pathname.replace(/_\.data$/, '');
  }

  return pathname.replace(/\.data$/, '');
};
