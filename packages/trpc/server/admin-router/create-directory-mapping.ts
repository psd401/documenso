// ABOUTME: TRPC route wrapping createDirectoryMapping. Actor is taken from the admin session.
import { createDirectoryMapping } from '@documenso/lib/server-only/directory-sync/create-directory-mapping';

import { adminProcedure } from '../trpc';
import {
  ZCreateDirectoryMappingRequestSchema,
  ZCreateDirectoryMappingResponseSchema,
} from './create-directory-mapping.types';

export const createDirectoryMappingRoute = adminProcedure
  .input(ZCreateDirectoryMappingRequestSchema)
  .output(ZCreateDirectoryMappingResponseSchema)
  .mutation(async ({ input, ctx }) => {
    return await createDirectoryMapping({
      ...input,
      actor: { userId: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    });
  });
