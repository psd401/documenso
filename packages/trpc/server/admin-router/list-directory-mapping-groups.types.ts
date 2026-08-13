// ABOUTME: Zod output type for admin.directoryMappings.listGroups, the group picker source.
import type { z } from 'zod';

import OrganisationGroupSchema from '@documenso/prisma/generated/zod/modelSchema/OrganisationGroupSchema';
import TeamGroupSchema from '@documenso/prisma/generated/zod/modelSchema/TeamGroupSchema';
import TeamSchema from '@documenso/prisma/generated/zod/modelSchema/TeamSchema';

export const ZListDirectoryMappingGroupsResponseSchema = OrganisationGroupSchema.pick({
  id: true,
  name: true,
  type: true,
  organisationRole: true,
})
  .extend({
    teamGroups: TeamGroupSchema.pick({ id: true, teamId: true, teamRole: true })
      .extend({
        team: TeamSchema.pick({ id: true, name: true }),
      })
      .array(),
  })
  .array();

export type TListDirectoryMappingGroupsResponse = z.infer<
  typeof ZListDirectoryMappingGroupsResponseSchema
>;
