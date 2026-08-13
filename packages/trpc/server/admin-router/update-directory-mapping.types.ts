// ABOUTME: Zod input/output types for admin.directoryMappings.update.
import { z } from 'zod';

import DirectoryGroupMappingSchema from '@documenso/prisma/generated/zod/modelSchema/DirectoryGroupMappingSchema';

export const ZUpdateDirectoryMappingRequestSchema = z.object({
  id: z.string().min(1),
  sourceField: z.enum(['GROUP', 'DEPARTMENT', 'ORG_UNIT']).optional(),
  sourceValue: z.string().trim().min(1).max(255).optional(),
  organisationGroupId: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export type TUpdateDirectoryMappingRequest = z.infer<typeof ZUpdateDirectoryMappingRequestSchema>;

export const ZUpdateDirectoryMappingResponseSchema = DirectoryGroupMappingSchema;

export type TUpdateDirectoryMappingResponse = z.infer<typeof ZUpdateDirectoryMappingResponseSchema>;
