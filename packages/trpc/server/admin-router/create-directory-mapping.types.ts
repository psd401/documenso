// ABOUTME: Zod input/output types for admin.directoryMappings.create.
import { z } from 'zod';

import DirectoryGroupMappingSchema from '@documenso/prisma/generated/zod/modelSchema/DirectoryGroupMappingSchema';

export const ZCreateDirectoryMappingRequestSchema = z.object({
  sourceField: z.enum(['GROUP', 'DEPARTMENT', 'ORG_UNIT']),
  sourceValue: z.string().trim().min(1).max(255),
  organisationGroupId: z.string().min(1),
  active: z.boolean().optional(),
});

export type TCreateDirectoryMappingRequest = z.infer<typeof ZCreateDirectoryMappingRequestSchema>;

export const ZCreateDirectoryMappingResponseSchema = DirectoryGroupMappingSchema;

export type TCreateDirectoryMappingResponse = z.infer<typeof ZCreateDirectoryMappingResponseSchema>;
