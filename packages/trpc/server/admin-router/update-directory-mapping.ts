// ABOUTME: TRPC route wrapping updateDirectoryMapping. Actor is taken from the admin session.
import { updateDirectoryMapping } from '@documenso/lib/server-only/directory-sync/update-directory-mapping';

import { adminProcedure } from '../trpc';
import {
  ZUpdateDirectoryMappingRequestSchema,
  ZUpdateDirectoryMappingResponseSchema,
} from './update-directory-mapping.types';

export const updateDirectoryMappingRoute = adminProcedure
  .input(ZUpdateDirectoryMappingRequestSchema)
  .output(ZUpdateDirectoryMappingResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { id, ...data } = input;

    return await updateDirectoryMapping({
      id,
      data,
      actor: { userId: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
    });
  });
