// ABOUTME: Guards the root lockfile against installing more than one copy of react-router.
// ABOUTME: A second copy gives libraries like nuqs a separate Router context, so SSR throws in useNavigate().
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCKFILE_PATH = path.resolve(__dirname, '../../../package-lock.json');

describe('react-router lockfile resolution', () => {
  it('installs exactly one copy of react-router', () => {
    const lockfile = JSON.parse(readFileSync(LOCKFILE_PATH, 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };

    const installs = Object.entries(lockfile.packages)
      .filter(([installPath]) => installPath.endsWith('node_modules/react-router'))
      .map(([installPath, entry]) => `${installPath}@${entry.version}`);

    expect(installs).toHaveLength(1);
  });
});
