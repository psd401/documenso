// ABOUTME: Unit tests for field-meta Zod schema changes.
// ABOUTME: Covers offsetX/offsetY bounds, custom direction, groupId constraints, required defaults.
import { FieldType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  FIELD_META_DEFAULT_VALUES,
  ZBaseFieldMeta,
  ZCheckboxFieldMeta,
  ZDateFieldMeta,
  ZFieldMetaSchema,
  ZRadioFieldMeta,
  ZTextFieldMeta,
  resolveFieldMetaForCreate,
} from './field-meta';

describe('ZBaseFieldMeta groupId', () => {
  it('accepts a valid groupId', () => {
    const result = ZBaseFieldMeta.safeParse({ groupId: 'group-1_test' });
    expect(result.success).toBe(true);
  });

  it('rejects groupId longer than 64 characters', () => {
    const result = ZBaseFieldMeta.safeParse({ groupId: 'a'.repeat(65) });
    expect(result.success).toBe(false);
  });

  it('rejects groupId with invalid characters', () => {
    const result = ZBaseFieldMeta.safeParse({ groupId: 'group id with spaces!' });
    expect(result.success).toBe(false);
  });

  it('accepts missing groupId (backward compat)', () => {
    const result = ZBaseFieldMeta.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('ZCheckboxFieldMeta offsets', () => {
  const baseCheckbox = { type: 'checkbox' as const };

  it('accepts values with valid offsets', () => {
    const result = ZCheckboxFieldMeta.safeParse({
      ...baseCheckbox,
      values: [{ id: 1, checked: false, value: 'Option A', offsetX: 10, offsetY: -5 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts offsets at the ±2000 boundary', () => {
    const result = ZCheckboxFieldMeta.safeParse({
      ...baseCheckbox,
      values: [{ id: 1, checked: false, value: 'A', offsetX: 2000, offsetY: -2000 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects offsetX above 2000', () => {
    const result = ZCheckboxFieldMeta.safeParse({
      ...baseCheckbox,
      values: [{ id: 1, checked: false, value: 'A', offsetX: 2001 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects offsetY below -2000', () => {
    const result = ZCheckboxFieldMeta.safeParse({
      ...baseCheckbox,
      values: [{ id: 1, checked: false, value: 'A', offsetY: -2001 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts values without offsets (backward compat)', () => {
    const result = ZCheckboxFieldMeta.safeParse({
      ...baseCheckbox,
      values: [{ id: 1, checked: false, value: 'A' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts custom direction', () => {
    const result = ZCheckboxFieldMeta.safeParse({
      ...baseCheckbox,
      direction: 'custom',
    });
    expect(result.success).toBe(true);
  });

  it('defaults direction to vertical', () => {
    const result = ZCheckboxFieldMeta.parse(baseCheckbox);
    expect(result.direction).toBe('vertical');
  });
});

describe('ZRadioFieldMeta offsets', () => {
  const baseRadio = { type: 'radio' as const };

  it('accepts values with valid offsets', () => {
    const result = ZRadioFieldMeta.safeParse({
      ...baseRadio,
      values: [{ id: 1, checked: false, value: 'Option A', offsetX: 50, offsetY: 25 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects out-of-bounds offsets', () => {
    const result = ZRadioFieldMeta.safeParse({
      ...baseRadio,
      values: [{ id: 1, checked: false, value: 'A', offsetX: 2001 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts custom direction', () => {
    const result = ZRadioFieldMeta.safeParse({
      ...baseRadio,
      direction: 'custom',
    });
    expect(result.success).toBe(true);
  });
});

describe('FIELD_META_DEFAULT_VALUES required defaults', () => {
  const typesRequiredByDefault: FieldType[] = [
    FieldType.SIGNATURE,
    FieldType.INITIALS,
    FieldType.NAME,
    FieldType.EMAIL,
    FieldType.DATE,
    FieldType.TEXT,
    FieldType.NUMBER,
    FieldType.RADIO,
    FieldType.CHECKBOX,
    FieldType.DROPDOWN,
  ];

  it.each(typesRequiredByDefault)('defaults newly placed %s fields to required true', (type) => {
    expect(FIELD_META_DEFAULT_VALUES[type]?.required).toBe(true);
  });

  it('defaults CALCULATED fields to required false (never required of the signer)', () => {
    expect(FIELD_META_DEFAULT_VALUES[FieldType.CALCULATED]?.required).toBe(false);
  });

  it('has no fieldMeta default for FREE_SIGNATURE', () => {
    expect(FIELD_META_DEFAULT_VALUES[FieldType.FREE_SIGNATURE]).toBeUndefined();
  });
});

describe('explicit required: false is preserved through schema parsing', () => {
  it('ZTextFieldMeta parse preserves an explicit required false', () => {
    const result = ZTextFieldMeta.parse({ type: 'text', required: false });
    expect(result.required).toBe(false);
  });

  it('ZDateFieldMeta parse preserves an explicit required false', () => {
    const result = ZDateFieldMeta.parse({ type: 'date', required: false });
    expect(result.required).toBe(false);
  });

  it('ZCheckboxFieldMeta parse preserves an explicit required false', () => {
    const result = ZCheckboxFieldMeta.parse({ type: 'checkbox', required: false });
    expect(result.required).toBe(false);
  });

  it('ZRadioFieldMeta parse preserves an explicit required false', () => {
    const result = ZRadioFieldMeta.parse({ type: 'radio', required: false });
    expect(result.required).toBe(false);
  });
});

describe('fieldMeta missing the required key is not reinterpreted as required', () => {
  it('ZFieldMetaSchema leaves required undefined when absent, it is not schema-defaulted to true', () => {
    const result = ZFieldMetaSchema.safeParse({ type: 'text', label: 'Existing field' });

    expect(result.success).toBe(true);
    expect(result.success && result.data?.required).toBeUndefined();
  });

  it('ZBaseFieldMeta leaves required undefined when absent', () => {
    const result = ZBaseFieldMeta.safeParse({});

    expect(result.success).toBe(true);
    expect(result.success && result.data.required).toBeUndefined();
  });
});

describe('resolveFieldMetaForCreate', () => {
  it('returns the provided fieldMeta unchanged, including an explicit required false', () => {
    const provided = { type: 'text' as const, required: false };

    expect(resolveFieldMetaForCreate(FieldType.TEXT, provided)).toEqual(provided);
  });

  it('falls back to the type default (required true) when fieldMeta is absent', () => {
    const result = resolveFieldMetaForCreate(FieldType.TEXT, undefined);

    expect(result).toEqual(FIELD_META_DEFAULT_VALUES[FieldType.TEXT]);
    expect(result?.required).toBe(true);
  });

  it('falls back to required false for CALCULATED when fieldMeta is absent', () => {
    const result = resolveFieldMetaForCreate(FieldType.CALCULATED, undefined);

    expect(result?.required).toBe(false);
  });

  it('returns undefined for FREE_SIGNATURE when fieldMeta is absent', () => {
    expect(resolveFieldMetaForCreate(FieldType.FREE_SIGNATURE, undefined)).toBeUndefined();
  });
});
