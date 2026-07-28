import type { Prisma } from '@prisma/client';
import { DocumentStatus, EnvelopeType, RecipientRole, SigningStatus } from '@prisma/client';

import { jobs } from '@documenso/lib/jobs/client';
import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
import type { ApiRequestMetadata, RequestMetadata } from '../../universal/extract-request-metadata';
import { createDocumentAuditLogData } from '../../utils/document-audit-logs';
import type { EnvelopeIdOptions } from '../../utils/envelope';
import { mapSecondaryIdToDocumentId, unsafeBuildEnvelopeIdQuery } from '../../utils/envelope';
import { assertRecipientNotExpired } from '../../utils/recipients';
import { getEnvelopeWhereInput } from '../envelope/get-envelope-by-id';

/**
 * Roles that fill out fields on a document, and can therefore be sent back to for correction.
 */
const CORRECTABLE_RECIPIENT_ROLES: RecipientRole[] = [
  RecipientRole.SIGNER,
  RecipientRole.APPROVER,
  RecipientRole.ASSISTANT,
];

const findCorrectableTarget = (
  recipients: {
    id: number;
    name: string;
    email: string;
    role: RecipientRole;
    signingStatus: SigningStatus;
  }[],
  targetRecipientId: number,
  actorRecipientId: number | null,
) => {
  const target = recipients.find((recipient) => recipient.id === targetRecipientId);

  if (!target) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Target recipient not found on this document',
    });
  }

  if (target.id === actorRecipientId) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Cannot send the document back to yourself',
    });
  }

  if (!CORRECTABLE_RECIPIENT_ROLES.includes(target.role)) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Target recipient cannot be sent a correction, they do not fill out fields',
    });
  }

  if (target.signingStatus !== SigningStatus.SIGNED) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Can only send the document back to a recipient who has already completed it',
    });
  }

  return target;
};

/**
 * Resets a recipient back to NOT_SIGNED and clears the fields/signatures they had inserted,
 * so they can redo their part of the document. Every other recipient's data is left untouched.
 */
const resetRecipientForCorrection = async (
  tx: Prisma.TransactionClient,
  targetRecipientId: number,
) => {
  await tx.recipient.update({
    where: {
      id: targetRecipientId,
    },
    data: {
      signingStatus: SigningStatus.NOT_SIGNED,
      signedAt: null,
    },
  });

  await tx.field.updateMany({
    where: {
      recipientId: targetRecipientId,
    },
    data: {
      customText: '',
      inserted: false,
    },
  });

  await tx.signature.deleteMany({
    where: {
      recipientId: targetRecipientId,
    },
  });
};

export type SendDocumentBackForCorrectionWithTokenOptions = {
  token: string;
  id: EnvelopeIdOptions;
  /**
   * The recipient to send the document back to, or null to send it back to the sender.
   */
  targetRecipientId: number | null;
  reason: string;
  requestMetadata?: RequestMetadata;
};

export const sendDocumentBackForCorrectionWithToken = async ({
  token,
  id,
  targetRecipientId,
  reason,
  requestMetadata,
}: SendDocumentBackForCorrectionWithTokenOptions) => {
  const actor = await prisma.recipient.findFirst({
    where: {
      token,
      envelope: unsafeBuildEnvelopeIdQuery(id, EnvelopeType.DOCUMENT),
    },
    include: {
      envelope: {
        include: {
          recipients: true,
        },
      },
    },
  });

  const envelope = actor?.envelope;

  if (!actor || !envelope) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Document or recipient not found',
    });
  }

  if (envelope.status !== DocumentStatus.PENDING) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Document ${envelope.id} must be pending to send back for correction`,
    });
  }

  assertRecipientNotExpired(actor);

  const target =
    targetRecipientId === null
      ? null
      : findCorrectableTarget(envelope.recipients, targetRecipientId, actor.id);

  await prisma.$transaction(async (tx) => {
    if (target) {
      await resetRecipientForCorrection(tx, target.id);
    }

    await tx.documentAuditLog.create({
      data: createDocumentAuditLogData({
        envelopeId: envelope.id,
        type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_SENT_BACK_FOR_CORRECTION,
        user: {
          name: actor.name,
          email: actor.email,
        },
        data: {
          reason,
          targetRecipientId: target?.id ?? null,
          targetRecipientName: target?.name ?? null,
          targetRecipientEmail: target?.email ?? null,
        },
        requestMetadata,
      }),
    });
  });

  const legacyDocumentId = mapSecondaryIdToDocumentId(envelope.secondaryId);

  await jobs.triggerJob({
    name: 'send.document.sent-back-for-correction.emails',
    payload: {
      documentId: legacyDocumentId,
      actorRecipientId: actor.id,
      targetRecipientId: target?.id ?? null,
      reason,
    },
  });

  return { targetRecipientId: target?.id ?? null };
};

export type SendDocumentBackForCorrectionOptions = {
  id: EnvelopeIdOptions;
  userId: number;
  teamId: number;
  targetRecipientId: number;
  reason: string;
  requestMetadata?: ApiRequestMetadata;
};

export const sendDocumentBackForCorrection = async ({
  id,
  userId,
  teamId,
  targetRecipientId,
  reason,
  requestMetadata,
}: SendDocumentBackForCorrectionOptions) => {
  const user = await prisma.user.findFirstOrThrow({
    where: {
      id: userId,
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });

  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id,
    type: EnvelopeType.DOCUMENT,
    userId,
    teamId,
  });

  const envelope = await prisma.envelope.findUnique({
    where: envelopeWhereInput,
    include: {
      recipients: true,
    },
  });

  if (!envelope) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Document not found',
    });
  }

  if (envelope.status !== DocumentStatus.PENDING) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `Document ${envelope.id} must be pending to send back for correction`,
    });
  }

  const target = findCorrectableTarget(envelope.recipients, targetRecipientId, null);

  await prisma.$transaction(async (tx) => {
    await resetRecipientForCorrection(tx, target.id);

    await tx.documentAuditLog.create({
      data: createDocumentAuditLogData({
        envelopeId: envelope.id,
        type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_SENT_BACK_FOR_CORRECTION,
        user: {
          name: user.name,
          email: user.email,
        },
        data: {
          reason,
          targetRecipientId: target.id,
          targetRecipientName: target.name,
          targetRecipientEmail: target.email,
        },
        metadata: requestMetadata,
      }),
    });
  });

  const legacyDocumentId = mapSecondaryIdToDocumentId(envelope.secondaryId);

  await jobs.triggerJob({
    name: 'send.document.sent-back-for-correction.emails',
    payload: {
      documentId: legacyDocumentId,
      actorRecipientId: null,
      targetRecipientId: target.id,
      reason,
    },
  });

  return { targetRecipientId: target.id };
};
