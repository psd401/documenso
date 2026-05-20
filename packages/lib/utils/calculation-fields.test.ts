import { FieldType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { computeCalculationFieldValues } from './calculation-fields';

const numberField = (id: number, label: string, value: string) => ({
  id,
  type: FieldType.NUMBER,
  customText: value,
  fieldMeta: { type: 'number', label },
});

const calculationField = (
  id: number,
  label: string,
  formula: string,
  customText = '',
  precision?: number,
) => ({
  id,
  type: FieldType.CALCULATION,
  customText,
  fieldMeta: { type: 'calculation', label, formula, precision },
});

describe('computeCalculationFieldValues', () => {
  it('computes a simple product of two number fields', () => {
    const updates = computeCalculationFieldValues([
      numberField(1, 'Miles', '100'),
      numberField(2, 'Rate', '0.5'),
      calculationField(3, 'Total', '{Miles} * {Rate}', '', 2),
    ]);

    expect(updates).toEqual([{ id: 3, customText: '50.00', inserted: true }]);
  });

  it('treats unfilled number fields as zero', () => {
    const updates = computeCalculationFieldValues([
      numberField(1, 'Miles', ''),
      numberField(2, 'Rate', '0.5'),
      calculationField(3, 'Total', '{Miles} * {Rate}', '', 2),
    ]);

    expect(updates).toEqual([{ id: 3, customText: '0.00', inserted: true }]);
  });

  it('does not emit an update when the value is unchanged', () => {
    const updates = computeCalculationFieldValues([
      numberField(1, 'Miles', '100'),
      numberField(2, 'Rate', '0.5'),
      calculationField(3, 'Total', '{Miles} * {Rate}', '50.00', 2),
    ]);

    expect(updates).toEqual([]);
  });

  it('resolves formulas that reference other formulas', () => {
    const updates = computeCalculationFieldValues([
      numberField(1, 'A', '2'),
      numberField(2, 'B', '3'),
      calculationField(3, 'Sum', '{A} + {B}', '', 0),
      calculationField(4, 'Doubled', '{Sum} * 2', '', 0),
    ]);

    expect(updates).toContainEqual({ id: 3, customText: '5', inserted: true });
    expect(updates).toContainEqual({ id: 4, customText: '10', inserted: true });
  });

  it('supports SUM and ROUND across fields', () => {
    const updates = computeCalculationFieldValues([
      numberField(1, 'Q1', '10.456'),
      numberField(2, 'Q2', '20.544'),
      calculationField(3, 'Total', 'ROUND(SUM({Q1}, {Q2}), 1)', '', 1),
    ]);

    expect(updates).toEqual([{ id: 3, customText: '31.0', inserted: true }]);
  });
});
