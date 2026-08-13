// ABOUTME: TRPC route wrapping findDirectoryMappings for the admin directory mappings table.
import { findDirectoryMappings } from '@documenso/lib/server-only/directory-sync/find-directory-mappings';

import { adminProcedure } from '../trpc';
import {
  ZFindDirectoryMappingsRequestSchema,
  ZFindDirectoryMappingsResponseSchema,
} from './find-directory-mappings.types';

export const findDirectoryMappingsRoute = adminProcedure
  .input(ZFindDirectoryMappingsRequestSchema)
  .output(ZFindDirectoryMappingsResponseSchema)
  .query(async ({ input }) => {
    return await findDirectoryMappings(input);
  });
