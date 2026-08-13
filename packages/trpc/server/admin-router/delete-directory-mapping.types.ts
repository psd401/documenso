// ABOUTME: Zod input/output types for admin.directoryMappings.delete.
import { z } from 'zod';

export const ZDeleteDirectoryMappingRequestSchema = z.object({
  id: z.string().min(1),
});

export type TDeleteDirectoryMappingRequest = z.infer<typeof ZDeleteDirectoryMappingRequestSchema>;

export const ZDeleteDirectoryMappingResponseSchema = z.object({ id: z.string() });

export type TDeleteDirectoryMappingResponse = z.infer<typeof ZDeleteDirectoryMappingResponseSchema>;
