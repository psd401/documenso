import { z } from 'zod';

import { type JobDefinition } from '../../client/_internal/job';

const SEND_SENT_BACK_FOR_CORRECTION_EMAILS_JOB_DEFINITION_ID =
  'send.document.sent-back-for-correction.emails';

const SEND_SENT_BACK_FOR_CORRECTION_EMAILS_JOB_DEFINITION_SCHEMA = z.object({
  documentId: z.number(),
  actorRecipientId: z.number().nullable(),
  targetRecipientId: z.number().nullable(),
  reason: z.string(),
});

export type TSendSentBackForCorrectionEmailsJobDefinition = z.infer<
  typeof SEND_SENT_BACK_FOR_CORRECTION_EMAILS_JOB_DEFINITION_SCHEMA
>;

export const SEND_SENT_BACK_FOR_CORRECTION_EMAILS_JOB_DEFINITION = {
  id: SEND_SENT_BACK_FOR_CORRECTION_EMAILS_JOB_DEFINITION_ID,
  name: 'Send Sent Back For Correction Emails',
  version: '1.0.0',
  trigger: {
    name: SEND_SENT_BACK_FOR_CORRECTION_EMAILS_JOB_DEFINITION_ID,
    schema: SEND_SENT_BACK_FOR_CORRECTION_EMAILS_JOB_DEFINITION_SCHEMA,
  },
  handler: async ({ payload, io }) => {
    const handler = await import('./send-sent-back-for-correction-emails.handler');

    await handler.run({ payload, io });
  },
} as const satisfies JobDefinition<
  typeof SEND_SENT_BACK_FOR_CORRECTION_EMAILS_JOB_DEFINITION_ID,
  TSendSentBackForCorrectionEmailsJobDefinition
>;
