// ABOUTME: Scans every email template source for user-visible "Documenso" text so
// ABOUTME: new upstream templates cannot ship the upstream brand to district staff.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const EMAIL_ROOT = path.resolve(__dirname, '../../email');
const TEMPLATE_DIRS = ['templates', 'template-components'];

const isCommentLine = (line: string) => /^\s*(\/\/|\/?\*)/.test(line);

const findBrandedLines = () => {
  const hits: string[] = [];

  for (const dir of TEMPLATE_DIRS) {
    const absoluteDir = path.join(EMAIL_ROOT, dir);

    for (const file of readdirSync(absoluteDir)) {
      if (!file.endsWith('.tsx')) {
        continue;
      }

      const lines = readFileSync(path.join(absoluteDir, file), 'utf8').split('\n');

      lines.forEach((line, index) => {
        if (line.includes('Documenso') && !isCommentLine(line)) {
          hits.push(`${dir}/${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }

  return hits;
};

const findBrandedLinesInFiles = (files: string[]) => {
  const hits: string[] = [];

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      if (line.includes('Documenso') && !isCommentLine(line)) {
        hits.push(`${path.basename(file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  return hits;
};

describe('email template branding', () => {
  it('contains no user-visible "Documenso" text', () => {
    expect(findBrandedLines()).toEqual([]);
  });

  it('email job subjects contain no user-visible "Documenso" text', () => {
    const jobsDir = path.resolve(__dirname, '../jobs/definitions/emails');
    const files = readdirSync(jobsDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => path.join(jobsDir, file));

    expect(findBrandedLinesInFiles(files)).toEqual([]);
  });

  it('recipient signing page title contains no "Documenso" text', () => {
    const layout = path.resolve(__dirname, '../../../apps/remix/app/routes/_recipient+/_layout.tsx');

    expect(findBrandedLinesInFiles([layout])).toEqual([]);
  });
});
