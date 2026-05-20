import { describe, expect, it } from 'vitest';

import {
  detectCircularReferences,
  evaluateFormula,
  extractFormulaReferences,
  formatFormulaResult,
  validateFormulaSyntax,
} from './formula';

describe('extractFormulaReferences', () => {
  it('extracts unique field labels in order', () => {
    expect(extractFormulaReferences('{Miles} * {Rate} + {Miles}')).toEqual(['Miles', 'Rate']);
  });

  it('trims whitespace inside references', () => {
    expect(extractFormulaReferences('{ Total Hours } + { Rate }')).toEqual([
      'Total Hours',
      'Rate',
    ]);
  });

  it('returns an empty array when there are no references', () => {
    expect(extractFormulaReferences('1 + 2 * 3')).toEqual([]);
  });
});

describe('evaluateFormula', () => {
  it('evaluates basic arithmetic with operator precedence', () => {
    expect(evaluateFormula('1 + 2 * 3', {}).value).toBe(7);
    expect(evaluateFormula('(1 + 2) * 3', {}).value).toBe(9);
    expect(evaluateFormula('10 - 4 - 2', {}).value).toBe(4);
  });

  it('resolves field references', () => {
    expect(evaluateFormula('{Miles} * {Rate}', { Miles: 100, Rate: 0.5 }).value).toBe(50);
  });

  it('treats missing references as zero for partial results', () => {
    expect(evaluateFormula('{Miles} + {Rate}', { Miles: 10 }).value).toBe(10);
  });

  it('supports unary minus', () => {
    expect(evaluateFormula('-{Value} + 5', { Value: 3 }).value).toBe(2);
  });

  it('supports SUM, MIN, MAX and ROUND', () => {
    expect(evaluateFormula('SUM(1, 2, 3, {x})', { x: 4 }).value).toBe(10);
    expect(evaluateFormula('MIN(4, 2, 9)', {}).value).toBe(2);
    expect(evaluateFormula('MAX(4, 2, 9)', {}).value).toBe(9);
    expect(evaluateFormula('ROUND(3.14159, 2)', {}).value).toBe(3.14);
    expect(evaluateFormula('ROUND(3.7)', {}).value).toBe(4);
  });

  it('is case-insensitive for function names', () => {
    expect(evaluateFormula('sum(1, 2)', {}).value).toBe(3);
  });

  it('returns an error on division by zero', () => {
    const result = evaluateFormula('{a} / {b}', { a: 5, b: 0 });
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/division by zero/i);
  });

  it('returns null without error for an empty formula', () => {
    expect(evaluateFormula('', {})).toEqual({ value: null, error: null });
  });

  it('returns an error for malformed formulas', () => {
    expect(evaluateFormula('1 +', {}).error).toBeTruthy();
    expect(evaluateFormula('{Unclosed', {}).error).toBeTruthy();
    expect(evaluateFormula('1 2', {}).error).toBeTruthy();
    expect(evaluateFormula('foo(1)', {}).error).toBeTruthy();
  });

  it('does not execute arbitrary code', () => {
    // Anything that is not a number/reference/function/operator must error.
    expect(evaluateFormula('process', {}).error).toBeTruthy();
  });
});

describe('validateFormulaSyntax', () => {
  it('returns no errors for a valid formula', () => {
    expect(validateFormulaSyntax('{Miles} * {Rate}', ['Miles', 'Rate'])).toEqual([]);
  });

  it('flags unknown references when labels are provided', () => {
    const errors = validateFormulaSyntax('{Miles} * {Unknown}', ['Miles']);
    expect(errors.some((error) => error.includes('Unknown'))).toBe(true);
  });

  it('requires a non-empty formula', () => {
    expect(validateFormulaSyntax('   ')).toEqual(['Formula is required.']);
  });

  it('flags syntax errors', () => {
    expect(validateFormulaSyntax('{a} +').length).toBeGreaterThan(0);
  });
});

describe('detectCircularReferences', () => {
  it('returns an empty array when there is no cycle', () => {
    expect(
      detectCircularReferences([
        { label: 'Total', formula: '{A} + {B}' },
        { label: 'A', formula: '1' },
        { label: 'B', formula: '2' },
      ]),
    ).toEqual([]);
  });

  it('detects a direct self-reference', () => {
    const cyclic = detectCircularReferences([{ label: 'A', formula: '{A} + 1' }]);
    expect(cyclic).toContain('A');
  });

  it('detects an indirect cycle', () => {
    const cyclic = detectCircularReferences([
      { label: 'A', formula: '{B}' },
      { label: 'B', formula: '{C}' },
      { label: 'C', formula: '{A}' },
    ]);
    expect(cyclic.sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('formatFormulaResult', () => {
  it('returns an empty string for null', () => {
    expect(formatFormulaResult(null)).toBe('');
  });

  it('respects a fixed precision', () => {
    expect(formatFormulaResult(3.14159, 2)).toBe('3.14');
    expect(formatFormulaResult(5, 2)).toBe('5.00');
  });

  it('trims floating point noise without a precision', () => {
    expect(formatFormulaResult(0.1 + 0.2)).toBe('0.3');
  });
});
