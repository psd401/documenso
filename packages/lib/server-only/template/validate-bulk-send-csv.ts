import { parse } from 'csv-parse/sync';
import { z } from 'zod';

import { zEmail } from '../../utils/zod';

/**
 * The maximum number of data rows allowed in a single bulk send CSV upload.
 */
export const BULK_SEND_MAX_ROWS = 100;

/**
 * The maximum size (in bytes) of a bulk send CSV upload.
 */
export const BULK_SEND_MAX_CSV_SIZE = 4 * 1024 * 1024;

/**
 * A recipient email cell must either be a valid email or left blank (in which
 * case the template's default recipient is used).
 */
const ZRecipientEmailCellSchema = z.union([
  zEmail('Value must be a valid email or empty string'),
  z.string().max(0, { message: 'Value must be a valid email or empty string' }),
]);

export type BulkSendCsvError = {
  /**
   * The 1-based data row the error relates to, or `null` for file-level errors
   * (e.g. missing columns, too many rows) that are not specific to a single row.
   */
  row: number | null;
  message: string;
};

export type ValidateBulkSendCsvResult = {
  /**
   * The parsed CSV rows keyed by header. Empty when the file could not be parsed.
   */
  rows: Array<Record<string, string>>;
  totalRows: number;
  validRowCount: number;
  errors: BulkSendCsvError[];
};

/**
 * Validate a bulk send CSV against a template's recipients without performing
 * any side effects, so row-level errors can be surfaced to the user before any
 * documents are generated or sent.
 *
 * This is the single source of truth for bulk send CSV validation and is shared
 * by both the `validateBulkSend` tRPC endpoint (pre-send) and the bulk send
 * background job (as a safety net).
 */
export const validateBulkSendCsv = ({
  csvContent,
  recipientCount,
}: {
  csvContent: string;
  recipientCount: number;
}): ValidateBulkSendCsvResult => {
  const errors: BulkSendCsvError[] = [];

  let rows: Array<Record<string, string>> = [];

  try {
    rows = parse(csvContent, { columns: true, skip_empty_lines: true });
  } catch {
    return {
      rows: [],
      totalRows: 0,
      validRowCount: 0,
      errors: [
        {
          row: null,
          message: 'The CSV file could not be parsed. Please check that it is a valid CSV.',
        },
      ],
    };
  }

  if (rows.length === 0) {
    return {
      rows: [],
      totalRows: 0,
      validRowCount: 0,
      errors: [{ row: null, message: 'The CSV file does not contain any data rows.' }],
    };
  }

  if (rows.length > BULK_SEND_MAX_ROWS) {
    errors.push({
      row: null,
      message: `Maximum ${BULK_SEND_MAX_ROWS} rows allowed per upload (found ${rows.length}).`,
    });
  }

  const requiredHeaders = Array.from(
    { length: recipientCount },
    (_, index) => `recipient_${index + 1}_email`,
  );

  const csvHeaders = Object.keys(rows[0]);
  const missingHeaders = requiredHeaders.filter((header) => !csvHeaders.includes(header));

  if (missingHeaders.length > 0) {
    errors.push({
      row: null,
      message: `Missing required column(s): ${missingHeaders.join(', ')}.`,
    });

    // Without the required columns we cannot meaningfully validate individual
    // rows, so report the structural error and stop here.
    return { rows, totalRows: rows.length, validRowCount: 0, errors };
  }

  let validRowCount = 0;

  for (const [rowIndex, row] of rows.entries()) {
    let rowValid = true;

    for (let index = 0; index < recipientCount; index++) {
      const emailKey = `recipient_${index + 1}_email`;

      const parsed = ZRecipientEmailCellSchema.safeParse(row[emailKey] ?? '');

      if (!parsed.success) {
        rowValid = false;

        errors.push({
          row: rowIndex + 1,
          message: `${emailKey}: ${parsed.error.issues?.[0]?.message ?? 'Invalid value'}`,
        });
      }
    }

    if (rowValid) {
      validRowCount += 1;
    }
  }

  return { rows, totalRows: rows.length, validRowCount, errors };
};
