import {
  type DocumentDataType,
  DocumentStatus,
  type EnvelopeType,
  type TemplateType,
} from '@prisma/client';
import { EnvelopeType as EnvelopeTypeEnum, TemplateType as TemplateTypeEnum } from '@prisma/client';
import contentDisposition from 'content-disposition';
import { type Context } from 'hono';

import { generatePartialDocumentPdf } from '@documenso/lib/server-only/pdf/generate-partial-document-pdf';
import { getTeamById } from '@documenso/lib/server-only/team/get-team';
import { sha256 } from '@documenso/lib/universal/crypto';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { type ZipFile, createZip } from '@documenso/lib/universal/zip';
import { prisma } from '@documenso/prisma';

import type { HonoEnv } from '../../router';

type HandleEnvelopeItemFileRequestOptions = {
  title: string;
  status: DocumentStatus;
  envelopeId: string;
  envelopeItemId: string;
  documentData: {
    type: DocumentDataType;
    data: string;
    initialData: string;
  };
  version: 'signed' | 'original' | 'partial';
  isDownload: boolean;
  context: Context<HonoEnv>;
};

/**
 * Helper function to handle envelope item file requests (both view and download)
 */
export const handleEnvelopeItemFileRequest = async ({
  title,
  status,
  envelopeId,
  envelopeItemId,
  documentData,
  version,
  isDownload,
  context: c,
}: HandleEnvelopeItemFileRequestOptions) => {
  if (version === 'partial') {
    if (!isDownload) {
      return c.json({ error: 'Partial version is only available for downloads' }, 400);
    }

    if (status !== DocumentStatus.PENDING) {
      return c.json(
        { error: 'Partial download is only available for documents that are pending signatures' },
        400,
      );
    }

    const partialPdf = await generatePartialDocumentPdf({
      envelopeId,
      envelopeItemId,
    }).catch((error) => {
      console.error(error);

      return null;
    });

    if (!partialPdf) {
      return c.json({ error: 'Failed to generate partial document' }, 500);
    }

    const baseTitle = title.replace(/\.pdf$/, '');
    const filename = `${baseTitle}_partial.pdf`;

    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', contentDisposition(filename));
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');

    return c.body(partialPdf);
  }

  const documentDataToUse = version === 'signed' ? documentData.data : documentData.initialData;

  const etag = Buffer.from(sha256(documentDataToUse)).toString('hex');

  if (c.req.header('If-None-Match') === etag && !isDownload) {
    return c.body(null, 304);
  }

  const file = await getFileServerSide({
    type: documentData.type,
    data: documentDataToUse,
  }).catch((error) => {
    console.error(error);

    return null;
  });

  if (!file) {
    return c.json({ error: 'File not found' }, 404);
  }

  c.header('Content-Type', 'application/pdf');
  c.header('ETag', etag);

  if (!isDownload) {
    if (status === DocumentStatus.COMPLETED) {
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      c.header('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }

  if (isDownload) {
    // Generate filename following the pattern from envelope-download-dialog.tsx
    const baseTitle = title.replace(/\.pdf$/, '');
    const suffix = version === 'signed' ? '_signed.pdf' : '.pdf';
    const filename = `${baseTitle}${suffix}`;

    c.header('Content-Disposition', contentDisposition(filename));

    // For downloads, prevent caching to ensure fresh data
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');
  }

  return c.body(file);
};

type EnvelopeZipItem = {
  title: string;
  documentData: {
    type: DocumentDataType;
    data: string;
    initialData: string;
  } | null;
};

type BuildEnvelopeZipResponseOptions = {
  envelopeTitle: string;
  items: EnvelopeZipItem[];
  version: 'signed' | 'original';
  context: Context<HonoEnv>;
};

/**
 * Ensures every entry in the archive has a unique name. PDF titles within an
 * envelope are not guaranteed to be unique, so colliding names get a numeric
 * suffix (e.g. "report (2).pdf") to avoid silently overwriting an entry.
 */
const dedupeFileName = (name: string, usedNames: Set<string>): string => {
  if (!usedNames.has(name)) {
    usedNames.add(name);

    return name;
  }

  const extensionMatch = /\.[^.]+$/.exec(name);
  const extension = extensionMatch ? extensionMatch[0] : '';
  const base = extension ? name.slice(0, -extension.length) : name;

  let counter = 2;
  let candidate = `${base} (${counter})${extension}`;

  while (usedNames.has(candidate)) {
    counter += 1;
    candidate = `${base} (${counter})${extension}`;
  }

  usedNames.add(candidate);

  return candidate;
};

/**
 * Bundles every document in an envelope into a single ZIP archive and returns
 * it as a download. Used by the "Download all" action so a user does not have
 * to download each document in a multi-document envelope individually.
 */
export const buildEnvelopeZipResponse = async ({
  envelopeTitle,
  items,
  version,
  context: c,
}: BuildEnvelopeZipResponseOptions) => {
  const usedNames = new Set<string>();
  const suffix = version === 'signed' ? '_signed.pdf' : '.pdf';

  const files: ZipFile[] = [];

  for (const item of items) {
    if (!item.documentData) {
      continue;
    }

    const documentDataToUse =
      version === 'signed' ? item.documentData.data : item.documentData.initialData;

    const file = await getFileServerSide({
      type: item.documentData.type,
      data: documentDataToUse,
    }).catch((error) => {
      console.error(error);

      return null;
    });

    if (!file) {
      continue;
    }

    const baseTitle = item.title.replace(/\.pdf$/, '');
    const name = dedupeFileName(`${baseTitle}${suffix}`, usedNames);

    files.push({ name, data: file });
  }

  if (files.length === 0) {
    return c.json({ error: 'No files available to download' }, 404);
  }

  const zip = createZip(files);

  const baseZipTitle = envelopeTitle.replace(/\.pdf$/, '') || 'documents';
  const zipFilename = `${baseZipTitle}.zip`;

  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', contentDisposition(zipFilename));
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');

  return c.body(zip);
};

type CheckEnvelopeFileAccessOptions = {
  userId: number;
  teamId: number;
  envelopeType: EnvelopeType;
  templateType: TemplateType;
};

/**
 * Check whether a user has access to an envelope's file.
 *
 * First checks team membership. If that fails and the envelope is an
 * ORGANISATION template (not a document), falls back to checking whether
 * the user belongs to any team in the same organisation.
 */
export const checkEnvelopeFileAccess = async ({
  userId,
  teamId,
  envelopeType,
  templateType,
}: CheckEnvelopeFileAccessOptions): Promise<boolean> => {
  const team = await getTeamById({ userId, teamId }).catch(() => null);

  if (team) {
    return true;
  }

  if (
    envelopeType === EnvelopeTypeEnum.TEMPLATE &&
    templateType === TemplateTypeEnum.ORGANISATION
  ) {
    const orgAccess = await prisma.team.findFirst({
      where: {
        id: teamId,
        organisation: {
          teams: {
            some: {
              teamGroups: {
                some: {
                  organisationGroup: {
                    organisationGroupMembers: {
                      some: {
                        organisationMember: { userId },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });

    return orgAccess !== null;
  }

  return false;
};
