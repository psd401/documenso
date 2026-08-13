// ABOUTME: TRPC route wrapping findDirectoryMappingGroups for the admin group picker.
import { findDirectoryMappingGroups } from '@documenso/lib/server-only/directory-sync/find-directory-mapping-groups';

import { adminProcedure } from '../trpc';
import { ZListDirectoryMappingGroupsResponseSchema } from './list-directory-mapping-groups.types';

export const listDirectoryMappingGroupsRoute = adminProcedure
  .output(ZListDirectoryMappingGroupsResponseSchema)
  .query(async () => {
    return await findDirectoryMappingGroups();
  });
