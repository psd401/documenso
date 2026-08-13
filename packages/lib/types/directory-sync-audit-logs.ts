// ABOUTME: Zod schema and inferred type for the `type` column of DirectorySyncAuditLog.
// ABOUTME: Rule mutations use the MAPPING_* values; the apply engine uses MEMBERSHIP_GRANTED.
import { z } from 'zod';

export const ZDirectorySyncAuditLogTypeSchema = z.enum([
  'MAPPING_CREATED',
  'MAPPING_UPDATED',
  'MAPPING_DELETED',
  'MEMBERSHIP_GRANTED',
]);

export type TDirectorySyncAuditLogType = z.infer<typeof ZDirectorySyncAuditLogTypeSchema>;
