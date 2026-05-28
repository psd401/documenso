import { DocumentSigningOrder, EnvelopeType, TemplateType } from '@prisma/client';

import { AppError, AppErrorCode } from '../../errors/app-error';
import type { ApiRequestMetadata } from '../../universal/extract-request-metadata';
import { putNormalizedPdfFileServerSide } from '../../universal/upload/put-file.server';
import { createEnvelope } from '../envelope/create-envelope';
import { getStarterTemplateById } from './starter-templates';

export type CreateTemplateFromStarterOptions = {
  userId: number;
  teamId: number;
  starterId: string;
  folderId?: string;
  requestMetadata: ApiRequestMetadata;
};

/**
 * Creates a reusable template from a built-in starter definition.
 *
 * The starter ships its own PDF and a pre-configured set of recipients and
 * fields, so staff can begin a submission without rebuilding the document each
 * time. Recipients are routed sequentially in the order defined by the starter.
 */
export const createTemplateFromStarter = async ({
  userId,
  teamId,
  starterId,
  folderId,
  requestMetadata,
}: CreateTemplateFromStarterOptions) => {
  const starter = getStarterTemplateById(starterId);

  if (!starter) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: `Unknown starter template: ${starterId}`,
    });
  }

  const pdfBytes = await starter.buildPdf();
  const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });

  const documentData = await putNormalizedPdfFileServerSide(
    {
      name: `${starter.title}.pdf`,
      type: 'application/pdf',
      arrayBuffer: async () => pdfBlob.arrayBuffer(),
    },
    { flattenForm: false },
  );

  return await createEnvelope({
    userId,
    teamId,
    internalVersion: 1,
    data: {
      type: EnvelopeType.TEMPLATE,
      title: starter.title,
      templateType: TemplateType.ORGANISATION,
      publicTitle: starter.publicTitle,
      publicDescription: starter.publicDescription,
      folderId,
      envelopeItems: [
        {
          documentDataId: documentData.id,
        },
      ],
      recipients: starter.recipients.map((recipient) => ({
        name: recipient.name,
        email: recipient.email,
        role: recipient.role,
        signingOrder: recipient.signingOrder,
        fields: recipient.fields.map((field) => ({
          ...field,
          documentDataId: documentData.id,
        })),
      })),
    },
    // Route to recipients sequentially in the order defined by the starter.
    meta: {
      signingOrder: DocumentSigningOrder.SEQUENTIAL,
    },
    requestMetadata,
  });
};
