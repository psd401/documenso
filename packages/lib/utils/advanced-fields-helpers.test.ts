import { type Field, FieldType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  fieldsContainUnsignedRequiredField,
  isFieldUnsignedAndRequired,
  isRequiredField,
} from './advanced-fields-helpers';

const makeField = (overrides: Partial<Field>): Field =>
  ({
    id: 1,
    secondaryId: 'field-1',
    envelopeId: 'envelope-1',
    envelopeItemId: 'item-1',
    recipientId: 1,
    type: FieldType.SIGNATURE,
    page: 1,
    positionX: 0,
    positionY: 0,
    width: 10,
    height: 10,
    customText: '',
    inserted: false,
    fieldMeta: null,
    ...overrides,
  }) as unknown as Field;

describe('isRequiredField', () => {
  it('treats signature fields as required by default', () => {
    expect(isRequiredField(makeField({ type: FieldType.SIGNATURE }))).toBe(true);
    expect(isRequiredField(makeField({ type: FieldType.FREE_SIGNATURE }))).toBe(true);
  });

  it('treats signature fields as optional when the recipient is not required to sign', () => {
    expect(
      isRequiredField(makeField({ type: FieldType.SIGNATURE }), { signatureRequired: false }),
    ).toBe(false);
    expect(
      isRequiredField(makeField({ type: FieldType.FREE_SIGNATURE }), { signatureRequired: false }),
    ).toBe(false);
  });

  it('keeps non-signature required fields required even when the recipient is not required to sign', () => {
    expect(
      isRequiredField(makeField({ type: FieldType.NAME }), { signatureRequired: false }),
    ).toBe(true);
  });

  it('does not affect optional advanced fields', () => {
    expect(
      isRequiredField(makeField({ type: FieldType.TEXT, fieldMeta: null }), {
        signatureRequired: false,
      }),
    ).toBe(false);
  });
});

describe('fieldsContainUnsignedRequiredField', () => {
  it('blocks completion when a required signature field is unsigned', () => {
    const fields = [makeField({ type: FieldType.SIGNATURE, inserted: false })];

    expect(fieldsContainUnsignedRequiredField(fields)).toBe(true);
    expect(fieldsContainUnsignedRequiredField(fields, { signatureRequired: true })).toBe(true);
  });

  it('allows completion when the only unsigned field is an optional signature', () => {
    const fields = [makeField({ type: FieldType.SIGNATURE, inserted: false })];

    expect(fieldsContainUnsignedRequiredField(fields, { signatureRequired: false })).toBe(false);
  });

  it('still blocks completion when a non-signature required field is unsigned for an optional signer', () => {
    const fields = [
      makeField({ id: 1, type: FieldType.SIGNATURE, inserted: false }),
      makeField({ id: 2, type: FieldType.NAME, inserted: false }),
    ];

    expect(fieldsContainUnsignedRequiredField(fields, { signatureRequired: false })).toBe(true);
  });

  it('resolves the signature requirement per recipient when fields span recipients', () => {
    const fields = [
      makeField({ id: 1, recipientId: 10, type: FieldType.SIGNATURE, inserted: false }),
      makeField({ id: 2, recipientId: 20, type: FieldType.SIGNATURE, inserted: false }),
    ];

    // Recipient 10 is required to sign, recipient 20 is not.
    const requiredRecipientIds = new Set([10]);

    expect(
      fieldsContainUnsignedRequiredField(fields, {
        isSignatureRequiredForRecipientId: (recipientId) => requiredRecipientIds.has(recipientId),
      }),
    ).toBe(true);

    // Now nobody is required to sign — the unsigned signatures no longer block.
    expect(
      fieldsContainUnsignedRequiredField(fields, {
        isSignatureRequiredForRecipientId: () => false,
      }),
    ).toBe(false);
  });
});

describe('isFieldUnsignedAndRequired', () => {
  it('returns false for an inserted required signature field', () => {
    expect(isFieldUnsignedAndRequired(makeField({ type: FieldType.SIGNATURE, inserted: true }))).toBe(
      false,
    );
  });

  it('returns false for an unsigned optional signature field', () => {
    expect(
      isFieldUnsignedAndRequired(makeField({ type: FieldType.SIGNATURE, inserted: false }), {
        signatureRequired: false,
      }),
    ).toBe(false);
  });
});
