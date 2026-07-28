import { sendDocumentBackForCorrection } from '@documenso/lib/server-only/document/send-document-back-for-correction';

import { authenticatedProcedure } from '../trpc';
import {
  ZSendBackForCorrectionRequestSchema,
  ZSendBackForCorrectionResponseSchema,
  sendBackForCorrectionMeta,
} from './send-back-for-correction.types';

export const sendBackForCorrectionRoute = authenticatedProcedure
  .meta(sendBackForCorrectionMeta)
  .input(ZSendBackForCorrectionRequestSchema)
  .output(ZSendBackForCorrectionResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { teamId } = ctx;
    const { envelopeId, targetRecipientId, reason } = input;

    ctx.logger.info({
      input: {
        envelopeId,
        targetRecipientId,
      },
    });

    const { targetRecipientId: sentBackTo } = await sendDocumentBackForCorrection({
      userId: ctx.user.id,
      teamId,
      id: {
        type: 'envelopeId',
        id: envelopeId,
      },
      targetRecipientId,
      reason,
      requestMetadata: ctx.metadata,
    });

    return {
      success: true,
      id: envelopeId,
      targetRecipientId: sentBackTo,
    };
  });
