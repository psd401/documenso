// ABOUTME: Lists directory mappings with their target group and team, paginated and
// ABOUTME: optionally filtered by sourceValue substring. Mirrors find-subscription-claims.ts.
import { prisma } from '@documenso/prisma';

import type { FindResultResponse } from '../../types/search-params';

export type FindDirectoryMappingsOptions = {
  query?: string;
  page?: number;
  perPage?: number;
};

export const findDirectoryMappings = async (options: FindDirectoryMappingsOptions) => {
  const { query, page = 1, perPage = 20 } = options;

  const whereClause = query
    ? { sourceValue: { contains: query, mode: 'insensitive' as const } }
    : {};

  const [data, count] = await Promise.all([
    prisma.directoryGroupMapping.findMany({
      where: whereClause,
      include: {
        organisationGroup: {
          include: {
            teamGroups: { include: { team: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { sourceValue: 'asc' },
      skip: Math.max(page - 1, 0) * perPage,
      take: perPage,
    }),
    prisma.directoryGroupMapping.count({ where: whereClause }),
  ]);

  return {
    data,
    count,
    currentPage: Math.max(page, 1),
    perPage,
    totalPages: Math.ceil(count / perPage),
  } satisfies FindResultResponse<typeof data>;
};
