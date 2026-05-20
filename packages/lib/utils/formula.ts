/**
 * A safe formula engine for calculation fields.
 *
 * Supports referencing other fields by label using `{Label}` syntax, the four
 * basic arithmetic operators (`+`, `-`, `*`, `/`), parentheses, and the
 * functions `SUM`, `ROUND`, `MIN` and `MAX`.
 *
 * The engine is a small recursive-descent parser — it intentionally does NOT
 * use `eval` or the `Function` constructor so that formulas authored by one
 * user can never execute arbitrary code in another user's browser or on the
 * server.
 */

const FUNCTIONS = ['SUM', 'ROUND', 'MIN', 'MAX'] as const;

type FunctionName = (typeof FUNCTIONS)[number];

type Token =
  | { type: 'number'; value: number }
  | { type: 'reference'; value: string }
  | { type: 'function'; value: FunctionName }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma' };

export type EvaluateFormulaResult = {
  /** The computed numeric value, or `null` when the formula cannot be evaluated. */
  value: number | null;
  /** A human-readable error when the formula is invalid, otherwise `null`. */
  error: string | null;
};

class FormulaError extends Error {}

/**
 * Extract the field labels referenced by a formula (the contents of each
 * `{...}` token). Duplicates are removed while preserving order.
 */
export const extractFormulaReferences = (formula: string): string[] => {
  const references: string[] = [];
  const matches = formula.matchAll(/\{([^}]*)\}/g);

  for (const match of matches) {
    const label = match[1].trim();

    if (label.length > 0 && !references.includes(label)) {
      references.push(label);
    }
  }

  return references;
};

const tokenize = (formula: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  while (index < formula.length) {
    const char = formula[index];

    // Whitespace.
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    // Field reference, e.g. {Total Miles}.
    if (char === '{') {
      const end = formula.indexOf('}', index);

      if (end === -1) {
        throw new FormulaError('Unclosed field reference. Did you forget a "}"?');
      }

      const label = formula.slice(index + 1, end).trim();

      if (label.length === 0) {
        throw new FormulaError('Empty field reference "{}".');
      }

      tokens.push({ type: 'reference', value: label });
      index = end + 1;
      continue;
    }

    // Numbers, including decimals.
    if (/[0-9.]/.test(char)) {
      let numberString = '';

      while (index < formula.length && /[0-9.]/.test(formula[index])) {
        numberString += formula[index];
        index += 1;
      }

      const value = Number(numberString);

      if (Number.isNaN(value)) {
        throw new FormulaError(`Invalid number "${numberString}".`);
      }

      tokens.push({ type: 'number', value });
      continue;
    }

    // Operators.
    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ type: 'operator', value: char });
      index += 1;
      continue;
    }

    // Parentheses.
    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      index += 1;
      continue;
    }

    // Argument separator.
    if (char === ',') {
      tokens.push({ type: 'comma' });
      index += 1;
      continue;
    }

    // Function names (letters only).
    if (/[a-zA-Z]/.test(char)) {
      let name = '';

      while (index < formula.length && /[a-zA-Z]/.test(formula[index])) {
        name += formula[index];
        index += 1;
      }

      const upperName = name.toUpperCase();

      const matchedFunction = FUNCTIONS.find((candidate) => candidate === upperName);

      if (!matchedFunction) {
        throw new FormulaError(`Unknown function "${name}".`);
      }

      tokens.push({ type: 'function', value: matchedFunction });
      continue;
    }

    throw new FormulaError(`Unexpected character "${char}".`);
  }

  return tokens;
};

/**
 * Parse and evaluate a token stream using recursive descent.
 *
 * Grammar:
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := '-' factor | primary
 *   primary    := number | reference | function '(' args ')' | '(' expression ')'
 */
const createParser = (tokens: Token[], resolveReference: (label: string) => number) => {
  let position = 0;

  const peek = (): Token | undefined => tokens[position];
  const next = (): Token | undefined => tokens[position++];

  const parseExpression = (): number => {
    let value = parseTerm();

    let token = peek();
    while (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
      next();
      const right = parseTerm();
      value = token.value === '+' ? value + right : value - right;
      token = peek();
    }

    return value;
  };

  const parseTerm = (): number => {
    let value = parseFactor();

    let token = peek();
    while (token?.type === 'operator' && (token.value === '*' || token.value === '/')) {
      next();
      const right = parseFactor();

      if (token.value === '*') {
        value = value * right;
      } else {
        if (right === 0) {
          throw new FormulaError('Division by zero.');
        }

        value = value / right;
      }

      token = peek();
    }

    return value;
  };

  const parseFactor = (): number => {
    const token = peek();

    // Unary minus / plus.
    if (token?.type === 'operator' && (token.value === '-' || token.value === '+')) {
      next();
      const value = parseFactor();
      return token.value === '-' ? -value : value;
    }

    return parsePrimary();
  };

  const parseArguments = (): number[] => {
    const args: number[] = [];

    const open = next();
    if (open?.type !== 'paren' || open.value !== '(') {
      throw new FormulaError('Expected "(" after function name.');
    }

    // Support zero-argument edge case defensively, though functions require args.
    const afterOpen = peek();
    if (afterOpen?.type === 'paren' && afterOpen.value === ')') {
      next();
      return args;
    }

    args.push(parseExpression());

    while (peek()?.type === 'comma') {
      next();
      args.push(parseExpression());
    }

    const close = next();
    if (close?.type !== 'paren' || close.value !== ')') {
      throw new FormulaError('Expected ")" to close function arguments.');
    }

    return args;
  };

  const applyFunction = (name: FunctionName, args: number[]): number => {
    if (args.length === 0) {
      throw new FormulaError(`${name} requires at least one argument.`);
    }

    switch (name) {
      case 'SUM':
        return args.reduce((total, current) => total + current, 0);
      case 'MIN':
        return Math.min(...args);
      case 'MAX':
        return Math.max(...args);
      case 'ROUND': {
        if (args.length > 2) {
          throw new FormulaError('ROUND takes at most two arguments.');
        }

        const [value, decimals = 0] = args;
        const factor = Math.pow(10, Math.trunc(decimals));

        return Math.round(value * factor) / factor;
      }
      default:
        throw new FormulaError(`Unknown function "${name}".`);
    }
  };

  const parsePrimary = (): number => {
    const token = next();

    if (!token) {
      throw new FormulaError('Unexpected end of formula.');
    }

    if (token.type === 'number') {
      return token.value;
    }

    if (token.type === 'reference') {
      return resolveReference(token.value);
    }

    if (token.type === 'function') {
      const args = parseArguments();
      return applyFunction(token.value, args);
    }

    if (token.type === 'paren' && token.value === '(') {
      const value = parseExpression();
      const close = next();

      if (close?.type !== 'paren' || close.value !== ')') {
        throw new FormulaError('Expected ")".');
      }

      return value;
    }

    throw new FormulaError('Unexpected token in formula.');
  };

  const parse = (): number => {
    if (tokens.length === 0) {
      throw new FormulaError('Formula is empty.');
    }

    const value = parseExpression();

    if (position < tokens.length) {
      throw new FormulaError('Unexpected trailing characters in formula.');
    }

    return value;
  };

  return { parse };
};

/**
 * Evaluate a formula against a map of field-label → numeric value.
 *
 * Referenced labels that are missing from `variables` (e.g. a field the signer
 * has not filled yet) are treated as `0` so that partial results can be shown
 * in real time as fields are completed.
 */
export const evaluateFormula = (
  formula: string,
  variables: Record<string, number>,
): EvaluateFormulaResult => {
  if (!formula || formula.trim().length === 0) {
    return { value: null, error: null };
  }

  try {
    const tokens = tokenize(formula);

    const resolveReference = (label: string): number => {
      const value = variables[label];
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };

    const { parse } = createParser(tokens, resolveReference);
    const value = parse();

    if (!Number.isFinite(value)) {
      return { value: null, error: 'Formula did not produce a finite number.' };
    }

    return { value, error: null };
  } catch (error) {
    if (error instanceof FormulaError) {
      return { value: null, error: error.message };
    }

    return { value: null, error: 'Invalid formula.' };
  }
};

/**
 * Validate that a formula is syntactically correct and, optionally, that every
 * field it references exists. Returns a list of human-readable errors (empty
 * when the formula is valid).
 */
export const validateFormulaSyntax = (
  formula: string,
  availableLabels?: string[],
): string[] => {
  const errors: string[] = [];

  if (!formula || formula.trim().length === 0) {
    errors.push('Formula is required.');
    return errors;
  }

  const references = extractFormulaReferences(formula);

  if (availableLabels) {
    for (const reference of references) {
      if (!availableLabels.includes(reference)) {
        errors.push(`Unknown field reference: "${reference}".`);
      }
    }
  }

  // Evaluate with all references set to a safe non-zero placeholder so that the
  // syntax (and division-by-zero on literals) is validated independently of any
  // particular field values.
  const placeholderVariables: Record<string, number> = {};
  for (const reference of references) {
    placeholderVariables[reference] = 1;
  }

  const { error } = evaluateFormula(formula, placeholderVariables);

  if (error) {
    errors.push(error);
  }

  return errors;
};

/**
 * Detect circular references among a set of calculation fields.
 *
 * Each entry maps a field's own label to the formula it evaluates. Returns the
 * set of labels that participate in a cycle (empty when there are none).
 */
export const detectCircularReferences = (
  fields: { label: string; formula: string }[],
): string[] => {
  const dependencies = new Map<string, string[]>();

  for (const field of fields) {
    if (!field.label) {
      continue;
    }

    dependencies.set(field.label, extractFormulaReferences(field.formula));
  }

  const cyclic = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (label: string, stack: string[]): void => {
    if (visited.has(label)) {
      return;
    }

    if (visiting.has(label)) {
      // Mark every label in the current cycle.
      const cycleStart = stack.indexOf(label);
      for (const member of stack.slice(cycleStart)) {
        cyclic.add(member);
      }
      return;
    }

    visiting.add(label);

    for (const dependency of dependencies.get(label) ?? []) {
      if (dependencies.has(dependency)) {
        visit(dependency, [...stack, label]);
      }
    }

    visiting.delete(label);
    visited.add(label);
  };

  for (const label of dependencies.keys()) {
    visit(label, []);
  }

  return [...cyclic];
};

/**
 * Format a computed numeric value into a display string.
 *
 * When `precision` is provided the value is rendered with exactly that many
 * decimal places; otherwise trailing zeroes are trimmed (rounded to a sane
 * number of decimals to avoid floating point noise).
 */
export const formatFormulaResult = (
  value: number | null,
  precision?: number | null,
): string => {
  if (value === null || !Number.isFinite(value)) {
    return '';
  }

  if (typeof precision === 'number' && precision >= 0) {
    return value.toFixed(Math.trunc(precision));
  }

  // Trim floating point noise without forcing a fixed number of decimals.
  return String(Math.round(value * 1e10) / 1e10);
};
