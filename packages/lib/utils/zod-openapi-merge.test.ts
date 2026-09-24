// ABOUTME: Guards the patches/ fix that points @anatine/zod-openapi at ts-deepmerge's named `merge` export.
// ABOUTME: ts-deepmerge 8 has no default export, so an unpatched zod-openapi throws while building the v1 API spec.
import { generateSchema } from '@anatine/zod-openapi';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('zod-openapi schema merging', () => {
  it('merges a field description into the generated schema', () => {
    expect(generateSchema(z.string().describe('Recipient email'))).toEqual({
      type: 'string',
      description: 'Recipient email',
    });
  });

  it('merges nested object properties and required keys', () => {
    const schema = generateSchema(
      z.object({ title: z.string(), meta: z.object({ subject: z.string().optional() }) }),
    );

    expect(schema).toEqual({
      type: 'object',
      required: ['title', 'meta'],
      properties: {
        title: { type: 'string' },
        meta: { type: 'object', properties: { subject: { type: 'string' } } },
      },
    });
  });
});
