// ABOUTME: Zod schema and inferred type for the `type` column of DirectorySyncAuditLog.
// ABOUTME: Rule mutations use the MAPPING_* values; the apply engine and sweep use the MEMBERSHIP_* and REVOKE_* values.
import { z } from 'zod';

export const ZDirectorySyncAuditLogTypeSchema = z.enum([
  'MAPPING_CREATED',
  'MAPPING_UPDATED',
  'MAPPING_DELETED',
  'MEMBERSHIP_GRANTED',
  'MEMBERSHIP_REVOKED',
  'MEMBERSHIP_REVOKE_DRY_RUN',
  'REVOKE_CIRCUIT_BREAKER',
]);

export type TDirectorySyncAuditLogType = z.infer<typeof ZDirectorySyncAuditLogTypeSchema>;
