import { type Field, FieldType } from '@prisma/client';

import { isSignatureFieldType } from '@documenso/prisma/guards/is-signature-field';

import { ZFieldMetaSchema } from '../types/field-meta';

// Currently it seems that the majority of fields have advanced fields for font reasons.
// This array should only contain fields that have an optional setting in the fieldMeta.
export const ADVANCED_FIELD_TYPES_WITH_OPTIONAL_SETTING: FieldType[] = [
  FieldType.NUMBER,
  FieldType.TEXT,
  FieldType.DROPDOWN,
  FieldType.RADIO,
  FieldType.CHECKBOX,
  FieldType.CALCULATED,
];

type RequiredFieldOptions = {
  /**
   * Whether the recipient that owns the field is required to sign. When `false`, the
   * recipient's signature fields are treated as optional and will not block completion.
   *
   * Defaults to `true` to preserve the previous behaviour where every signature field
   * is required.
   */
  signatureRequired?: boolean;
};

/**
 * Whether a field is required to be inserted.
 */
export const isRequiredField = (
  field: Pick<Field, 'type' | 'fieldMeta'>,
  options: RequiredFieldOptions = {},
) => {
  // Calculated fields are computed automatically — a signer never fills them in,
  // so they must never be treated as a required field that blocks completion.
  if (field.type === FieldType.CALCULATED) {
    return false;
  }

  // Signature fields are required by default, but the sender can mark a recipient as
  // not required to sign. In that case the recipient's signature fields are optional.
  if (options.signatureRequired === false && isSignatureFieldType(field.type)) {
    return false;
  }

  // All fields without the optional metadata are assumed to be required.
  if (!ADVANCED_FIELD_TYPES_WITH_OPTIONAL_SETTING.includes(field.type)) {
    return true;
  }

  // Not sure why fieldMeta can be optional for advanced fields, but it is.
  // Therefore we must assume if there is no fieldMeta, then the field is optional.
  if (!field.fieldMeta) {
    return false;
  }

  const parsedData = ZFieldMetaSchema.safeParse(field.fieldMeta);

  // If it fails, assume the field is optional.
  // This needs to be logged somewhere.
  if (!parsedData.success) {
    return false;
  }

  return parsedData.data?.required === true;
};

/**
 * Whether the provided field is required and not inserted.
 */
export const isFieldUnsignedAndRequired = (
  field: Pick<Field, 'type' | 'fieldMeta' | 'inserted'>,
  options: RequiredFieldOptions = {},
) => isRequiredField(field, options) && !field.inserted;

/**
 * Whether the provided fields contains a field that is required to be inserted.
 *
 * When the fields belong to a single recipient, pass that recipient's `signatureRequired`
 * flag via `options`. When the fields span multiple recipients, pass
 * `isSignatureRequiredForRecipientId` to resolve the flag per field.
 */
export const fieldsContainUnsignedRequiredField = (
  fields: Pick<Field, 'type' | 'fieldMeta' | 'inserted' | 'recipientId'>[],
  options: RequiredFieldOptions & {
    isSignatureRequiredForRecipientId?: (recipientId: number) => boolean;
  } = {},
) =>
  fields.some((field) =>
    isFieldUnsignedAndRequired(field, {
      signatureRequired: options.isSignatureRequiredForRecipientId
        ? options.isSignatureRequiredForRecipientId(field.recipientId)
        : options.signatureRequired,
    }),
  );
