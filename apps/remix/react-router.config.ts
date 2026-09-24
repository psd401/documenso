import type { Config } from '@react-router/dev/config';

export default {
  appDirectory: 'app',
  ssr: true,
  // Must never be undefined and must start with the raw Vite `base` value,
  // otherwise @react-router/dev crashes / exits on `react-router dev`. Both are
  // kept without a trailing slash so they match exactly, and so the bare
  // sub-path URL (e.g. "/ESign") still matches the basename at runtime.
  basename: process.env.NEXT_PUBLIC_BASE_PATH ? process.env.NEXT_PUBLIC_BASE_PATH.replace(/\/$/, '') : '/',
  // React Router 8 defaults this to `true`. With it on, the production build
  // fails: "The macro you imported from '@lingui/core/macro' is being
  // executed outside the context of compilation." Route module splitting
  // moves route code into chunks that vite-plugin-babel-macros doesn't
  // process, so the raw `@lingui/core/macro` import reaches Rollup unexpanded.
  splitRouteModules: false,
} satisfies Config;
