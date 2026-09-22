// ABOUTME: Lists every PSD401 org group eligible as a mapping target, with its linked teams,
// ABOUTME: for the admin UI's group picker. Includes INTERNAL_TEAM and INTERNAL_ORGANISATION
// ABOUTME: groups alongside CUSTOM groups: standard teams' member groups are the natural
// ABOUTME: mapping targets (spec section 2, "deliberate divergence from upstream").
import { prisma } from '@documenso/prisma';

import { PSD401_ORG_ID } from '../../constants/psd401';

export const findDirectoryMappingGroups = async () => {
  return await prisma.organisationGroup.findMany({
    where: { organisationId: PSD401_ORG_ID },
    include: {
      teamGroups: { include: { team: { select: { id: true, name: true } } } },
    },
    orderBy: { name: 'asc' },
  });
};
