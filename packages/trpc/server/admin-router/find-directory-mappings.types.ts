// ABOUTME: Zod input/output types for admin.directoryMappings.find, mirroring
// ABOUTME: find-admin-organisations.types.ts for the nested-relation response shape.
import { z } from 'zod';

import { ZFindSearchParamsSchema } from '@documenso/lib/types/search-params';
import DirectoryGroupMappingSchema from '@documenso/prisma/generated/zod/modelSchema/DirectoryGroupMappingSchema';
import OrganisationGroupSchema from '@documenso/prisma/generated/zod/modelSchema/OrganisationGroupSchema';
import TeamGroupSchema from '@documenso/prisma/generated/zod/modelSchema/TeamGroupSchema';
import TeamSchema from '@documenso/prisma/generated/zod/modelSchema/TeamSchema';

export const ZFindDirectoryMappingsRequestSchema = ZFindSearchParamsSchema.extend({});

export type TFindDirectoryMappingsRequest = z.infer<typeof ZFindDirectoryMappingsRequestSchema>;

export const ZFindDirectoryMappingsResponseSchema = z.object({
  data: DirectoryGroupMappingSchema.extend({
    organisationGroup: OrganisationGroupSchema.pick({
      id: true,
      name: true,
      type: true,
      organisationRole: true,
    }).extend({
      teamGroups: TeamGroupSchema.pick({ id: true, teamId: true, teamRole: true })
        .extend({
          team: TeamSchema.pick({ id: true, name: true }),
        })
        .array(),
    }),
  }).array(),
  count: z.number(),
  currentPage: z.number(),
  perPage: z.number(),
  totalPages: z.number(),
});

export type TFindDirectoryMappingsResponse = z.infer<typeof ZFindDirectoryMappingsResponseSchema>;
