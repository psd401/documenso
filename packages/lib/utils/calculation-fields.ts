import { FieldType } from '@prisma/client';

import { ZFieldMetaSchema } from '../types/field-meta';
import { evaluateFormula, formatFormulaResult } from './formula';

export type CalculationFieldInput = {
  id: number;
  type: FieldType;
  customText: string | null;
  fieldMeta: unknown;
};

export type CalculationFieldUpdate = {
  id: number;
  customText: string;
  inserted: boolean;
};

/**
 * Parse a field's stored value into a number, tolerating common formatting such
 * as thousands separators. Returns `null` when the value is not numeric.
 */
const toNumber = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  const parsed = Number(trimmed.replace(/,/g, ''));

  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Compute the values of every calculation field given the current state of all
 * fields in the document.
 *
 * Fields are referenced from formulas by their (trimmed) label. Calculation
 * fields may reference other calculation fields; the computation iterates until
 * the values stabilise, which is guaranteed to terminate because circular
 * references are rejected at authoring time.
 *
 * Returns the set of calculation fields whose value changed.
 */
export const computeCalculationFieldValues = (
  fields: CalculationFieldInput[],
): CalculationFieldUpdate[] => {
  const parsed = fields.map((field) => {
    const meta = ZFieldMetaSchema.safeParse(field.fieldMeta);

    return { ...field, meta: meta.success ? meta.data : undefined };
  });

  // Build the label → value map from non-calculation numeric fields.
  const values: Record<string, number> = {};

  for (const field of parsed) {
    if (field.type === FieldType.CALCULATION) {
      continue;
    }

    const label = field.meta?.label?.trim();

    if (!label) {
      continue;
    }

    const numericValue = toNumber(field.customText);

    if (numericValue !== null) {
      values[label] = numericValue;
    }
  }

  const calculationFields = parsed.filter(
    (field) => field.type === FieldType.CALCULATION && field.meta?.type === 'calculation',
  );

  // Seed calculation labels with their current stored value so formulas that
  // reference other formulas have a starting point.
  for (const field of calculationFields) {
    const label = field.meta?.label?.trim();

    if (!label) {
      continue;
    }

    const numericValue = toNumber(field.customText);

    if (numericValue !== null) {
      values[label] = numericValue;
    }
  }

  const computed = new Map<number, string>();

  const maxIterations = calculationFields.length + 1;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false;

    for (const field of calculationFields) {
      if (field.meta?.type !== 'calculation') {
        continue;
      }

      const { value } = evaluateFormula(field.meta.formula ?? '', values);
      const text = formatFormulaResult(value, field.meta.precision ?? undefined);

      if (computed.get(field.id) !== text) {
        computed.set(field.id, text);
        changed = true;
      }

      const label = field.meta.label?.trim();

      if (label && value !== null && Number.isFinite(value)) {
        values[label] = value;
      }
    }

    if (!changed) {
      break;
    }
  }

  const updates: CalculationFieldUpdate[] = [];

  for (const field of calculationFields) {
    const text = computed.get(field.id) ?? '';

    if ((field.customText ?? '') !== text) {
      updates.push({ id: field.id, customText: text, inserted: text.length > 0 });
    }
  }

  return updates;
};
