// ABOUTME: TRPC route wrapping deleteDirectoryMapping. Actor is taken from the admin session.
import { deleteDirectoryMapping } from '@documenso/lib/server-only/directory-sync/delete-directory-mapping';

import { adminProcedure } from '../trpc';
import {
  ZDeleteDirectoryMappingRequestSchema,
  ZDeleteDirectoryMappingResponseSchema,
} from './delete-directory-mapping.types';

export const deleteDirectoryMappingRoute = adminProcedure
  .input(ZDeleteDirectoryMappingRequestSchema)
  .output(ZDeleteDirectoryMappingResponseSchema)
  .mutation(async ({ input, ctx }) => {
    return await deleteDirectoryMapping({
      id: input.id,
      actor: { userId: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    });
  });
