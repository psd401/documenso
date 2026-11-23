// ABOUTME: Verifies envelope.bulk.move lets a folder's creator move documents into it regardless of the
// ABOUTME: folder's visibility tier, matching update-envelope (PR #82), while other folders stay role-gated.

import { DocumentVisibility, EnvelopeType, TeamMemberRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FolderRow = { id: string; userId: number; visibility: DocumentVisibility };

const folders: FolderRow[] = [];

const mockUpdateMany = vi.fn();

const matchesWhere = (folder: FolderRow, where: Record<string, unknown>): boolean => {
  if (where.id !== undefined && where.id !== folder.id) {
    return false;
  }

  const visibility = where.visibility as { in: DocumentVisibility[] } | undefined;

  if (visibility && !visibility.in.includes(folder.visibility)) {
    return false;
  }

  if (where.userId !== undefined && where.userId !== folder.userId) {
    return false;
  }

  const or = where.OR as Record<string, unknown>[] | undefined;

  if (or && !or.some((clause) => matchesWhere(folder, clause))) {
    return false;
  }

  return true;
};

vi.mock('@documenso/prisma', () => ({
  prisma: {
    folder: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return folders.find((folder) => matchesWhere(folder, where)) ?? null;
      }),
    },
    envelope: { updateMany: mockUpdateMany },
  },
}));

vi.mock('@documenso/lib/server-only/envelope/get-envelopes-by-ids', () => ({
  getMultipleEnvelopeWhereInput: vi.fn(async () => ({
    envelopeWhereInput: { id: { in: ['envelope_1'] } },
    team: { currentTeamRole: TeamMemberRole.MEMBER },
  })),
}));

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => noopLogger,
};

const MEMBER_USER_ID = 7;

const createCtx = () => ({
  req: new Request('http://localhost/api/trpc'),
  session: { id: 'session_1' },
  user: { id: MEMBER_USER_ID, name: 'Member', email: 'member@psd401.net', disabled: false },
  teamId: 5,
  logger: noopLogger,
  metadata: { source: 'app', auth: null, requestMetadata: {} },
});

const move = async (folderId: string) => {
  const { router } = await import('../trpc');
  const { bulkMoveEnvelopesRoute } = await import('./bulk-move-envelopes');

  const caller = router({ move: bulkMoveEnvelopesRoute }).createCaller(createCtx() as never);

  return caller.move({ envelopeIds: ['envelope_1'], envelopeType: EnvelopeType.DOCUMENT, folderId } as never);
};

describe('envelope.bulk.move folder access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    folders.length = 0;
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('lets a MEMBER move documents into their own ADMIN-visibility folder', async () => {
    folders.push({ id: 'folder_own', userId: MEMBER_USER_ID, visibility: DocumentVisibility.ADMIN });

    await expect(move('folder_own')).resolves.toEqual({ movedCount: 1 });
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { folderId: 'folder_own' } }));
  });

  it("rejects a MEMBER moving documents into someone else's ADMIN-visibility folder", async () => {
    folders.push({ id: 'folder_other', userId: 99, visibility: DocumentVisibility.ADMIN });

    await expect(move('folder_other')).rejects.toThrow('Folder not found or access denied');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("lets a MEMBER move documents into someone else's EVERYONE folder", async () => {
    folders.push({ id: 'folder_shared', userId: 99, visibility: DocumentVisibility.EVERYONE });

    await expect(move('folder_shared')).resolves.toEqual({ movedCount: 1 });
  });
});
