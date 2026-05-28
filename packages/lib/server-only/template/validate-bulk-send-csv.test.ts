import { describe, expect, it } from 'vitest';

import { BULK_SEND_MAX_ROWS, validateBulkSendCsv } from './validate-bulk-send-csv';

const buildCsv = (rows: string[][]) => rows.map((row) => row.join(',')).join('\n');

describe('validateBulkSendCsv', () => {
  it('accepts a well-formed single-recipient CSV', () => {
    const csv = buildCsv([
      ['recipient_1_email', 'recipient_1_name'],
      ['alice@example.com', 'Alice'],
      ['bob@example.com', 'Bob'],
    ]);

    const result = validateBulkSendCsv({ csvContent: csv, recipientCount: 1 });

    expect(result.errors).toHaveLength(0);
    expect(result.totalRows).toBe(2);
    expect(result.validRowCount).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it('validates every recipient column for multi-recipient templates', () => {
    const csv = buildCsv([
      ['recipient_1_email', 'recipient_1_name', 'recipient_2_email', 'recipient_2_name'],
      ['alice@example.com', 'Alice', 'bob@example.com', 'Bob'],
    ]);

    const result = validateBulkSendCsv({ csvContent: csv, recipientCount: 2 });

    expect(result.errors).toHaveLength(0);
    expect(result.validRowCount).toBe(1);
  });

  it('reports a file-level error when a required column is missing', () => {
    const csv = buildCsv([
      ['recipient_1_email', 'recipient_1_name'],
      ['alice@example.com', 'Alice'],
    ]);

    const result = validateBulkSendCsv({ csvContent: csv, recipientCount: 2 });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBeNull();
    expect(result.errors[0].message).toContain('recipient_2_email');
  });

  it('reports a row-level error for an invalid email with the correct row number', () => {
    const csv = buildCsv([
      ['recipient_1_email', 'recipient_1_name'],
      ['alice@example.com', 'Alice'],
      ['not-an-email', 'Bob'],
    ]);

    const result = validateBulkSendCsv({ csvContent: csv, recipientCount: 1 });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
    expect(result.errors[0].message).toContain('recipient_1_email');
    expect(result.validRowCount).toBe(1);
  });

  it('treats a blank email cell as valid (falls back to the template default)', () => {
    const csv = buildCsv([
      ['recipient_1_email', 'recipient_1_name'],
      ['', ''],
    ]);

    const result = validateBulkSendCsv({ csvContent: csv, recipientCount: 1 });

    expect(result.errors).toHaveLength(0);
    expect(result.validRowCount).toBe(1);
  });

  it('reports a file-level error when there are no data rows', () => {
    const csv = 'recipient_1_email,recipient_1_name';

    const result = validateBulkSendCsv({ csvContent: csv, recipientCount: 1 });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBeNull();
    expect(result.totalRows).toBe(0);
  });

  it('reports a file-level error when the row count exceeds the maximum', () => {
    const dataRows = Array.from({ length: BULK_SEND_MAX_ROWS + 1 }, (_, index) => [
      `user${index}@example.com`,
      `User ${index}`,
    ]);

    const csv = buildCsv([['recipient_1_email', 'recipient_1_name'], ...dataRows]);

    const result = validateBulkSendCsv({ csvContent: csv, recipientCount: 1 });

    expect(result.errors.some((error) => error.row === null)).toBe(true);
    expect(result.totalRows).toBe(BULK_SEND_MAX_ROWS + 1);
  });

  it('collects multiple row-level errors across rows', () => {
    const csv = buildCsv([
      ['recipient_1_email', 'recipient_1_name'],
      ['bad-1', 'A'],
      ['alice@example.com', 'Alice'],
      ['bad-2', 'C'],
    ]);

    const result = validateBulkSendCsv({ csvContent: csv, recipientCount: 1 });

    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((error) => error.row)).toEqual([1, 3]);
    expect(result.validRowCount).toBe(1);
  });
});
