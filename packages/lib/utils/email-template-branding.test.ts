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

describe('email template branding', () => {
  it('contains no user-visible "Documenso" text', () => {
    expect(findBrandedLines()).toEqual([]);
  });
});
