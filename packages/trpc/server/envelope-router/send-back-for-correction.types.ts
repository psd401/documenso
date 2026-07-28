import { z } from 'zod';

import { ZSuccessResponseSchema } from '../schema';
import type { TrpcRouteMeta } from '../trpc';

export const sendBackForCorrectionMeta: TrpcRouteMeta = {
  openapi: {
    method: 'POST',
    path: '/envelope/send-back-for-correction',
    summary: 'Send envelope back for correction',
    description:
      'Send a pending envelope back to a recipient who has already completed their part, so they can correct their submission. The recipient is reset to pending and their fields are cleared; other recipients are unaffected.',
    tags: ['Envelope'],
  },
};

export const ZSendBackForCorrectionRequestSchema = z.object({
  envelopeId: z.string(),
  targetRecipientId: z
    .number()
    .describe('The ID of the recipient to send the envelope back to for correction.'),
  reason: z.string().min(1).max(500),
});

export const ZSendBackForCorrectionResponseSchema = ZSuccessResponseSchema.extend({
  id: z.string().describe('The ID of the envelope that was sent back for correction.'),
  targetRecipientId: z.number(),
});

export type TSendBackForCorrectionRequest = z.infer<typeof ZSendBackForCorrectionRequestSchema>;
export type TSendBackForCorrectionResponse = z.infer<typeof ZSendBackForCorrectionResponseSchema>;
