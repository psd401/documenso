// ABOUTME: Guards the root lockfile against transitive dependencies with known advisories.
// ABOUTME: Each entry is the first patched version from the matching Dependabot alert.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCKFILE_PATH = path.resolve(__dirname, '../../../package-lock.json');

// Vulnerable when introducedIn <= version < patched.
const ADVISORY_RANGES: Record<string, { introducedIn: string; patched: string }> = {
  fflate: { introducedIn: '0.7.0', patched: '0.7.5' },
  'adm-zip': { introducedIn: '0.0.0', patched: '0.6.1' },
  '@opentelemetry/core': { introducedIn: '0.0.0', patched: '2.8.0' },
  '@opentelemetry/propagator-jaeger': { introducedIn: '0.0.0', patched: '2.9.0' },
  'deepmerge-ts': { introducedIn: '0.0.0', patched: '8.0.0' },
  'ts-deepmerge': { introducedIn: '0.0.0', patched: '8.0.0' },
};

const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  for (let index = 0; index < 3; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
};

describe('patched transitive dependencies', () => {
  const lockfile = JSON.parse(readFileSync(LOCKFILE_PATH, 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };

  for (const [name, { introducedIn, patched }] of Object.entries(ADVISORY_RANGES)) {
    it(`installs no ${name} in [${introducedIn}, ${patched})`, () => {
      const vulnerable = Object.entries(lockfile.packages)
        .filter(([installPath]) => installPath.endsWith(`node_modules/${name}`))
        .filter(
          ([, entry]) =>
            entry.version &&
            compareVersions(entry.version, introducedIn) >= 0 &&
            compareVersions(entry.version, patched) < 0,
        )
        .map(([installPath, entry]) => `${installPath}@${entry.version}`);

      expect(vulnerable).toEqual([]);
    });
  }
});
