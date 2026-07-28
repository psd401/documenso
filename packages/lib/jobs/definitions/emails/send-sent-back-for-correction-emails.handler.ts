import { createElement } from 'react';

import { msg } from '@lingui/core/macro';
import { EnvelopeType, SendStatus } from '@prisma/client';

import { mailer } from '@documenso/email/mailer';
import { DocumentSentBackForCorrectionEmail } from '@documenso/email/templates/document-sent-back-for-correction';
import { formatSigningLink, isRecipientEmailValidForSending } from '@documenso/lib/utils/recipients';
import { prisma } from '@documenso/prisma';

import { getI18nInstance } from '../../../client-only/providers/i18n-server';
import { NEXT_PUBLIC_WEBAPP_URL } from '../../../constants/app';
import { getEmailContext } from '../../../server-only/email/get-email-context';
import { extractDerivedDocumentEmailSettings } from '../../../types/document-email';
import { unsafeBuildEnvelopeIdQuery } from '../../../utils/envelope';
import { renderEmailWithI18N } from '../../../utils/render-email-with-i18n';
import { formatDocumentsPath } from '../../../utils/teams';
import type { JobRunIO } from '../../client/_internal/job';
import type { TSendSentBackForCorrectionEmailsJobDefinition } from './send-sent-back-for-correction-emails';

export const run = async ({
  payload,
  io,
}: {
  payload: TSendSentBackForCorrectionEmailsJobDefinition;
  io: JobRunIO;
}) => {
  const { documentId, actorRecipientId, targetRecipientId, reason } = payload;

  const envelope = await prisma.envelope.findFirstOrThrow({
    where: unsafeBuildEnvelopeIdQuery(
      {
        type: 'documentId',
        id: documentId,
      },
      EnvelopeType.DOCUMENT,
    ),
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      documentMeta: true,
      team: {
        select: {
          teamEmail: true,
          name: true,
          url: true,
        },
      },
      recipients: true,
    },
  });

  const isEmailEnabled = extractDerivedDocumentEmailSettings(
    envelope.documentMeta,
  ).recipientSigningRequest;

  if (!isEmailEnabled) {
    return;
  }

  const { branding, emailLanguage, senderEmail, replyToEmail } = await getEmailContext({
    emailType: 'RECIPIENT',
    source: {
      type: 'team',
      teamId: envelope.teamId,
    },
    meta: envelope.documentMeta,
  });

  const i18n = await getI18nInstance(emailLanguage);

  const actor = actorRecipientId
    ? envelope.recipients.find((recipient) => recipient.id === actorRecipientId)
    : null;

  const requestedByName = actor
    ? actor.name || actor.email
    : envelope.user.name || envelope.user.email;

  const ownerDocumentUrl = `${NEXT_PUBLIC_WEBAPP_URL()}${formatDocumentsPath(envelope.team?.url)}/${envelope.id}`;

  const target = targetRecipientId
    ? envelope.recipients.find((recipient) => recipient.id === targetRecipientId)
    : null;

  const sendEmail = async (taskName: string, to: { name: string; address: string }, documentUrl: string, isActionRequired: boolean) => {
    await io.runTask(taskName, async () => {
      const template = createElement(DocumentSentBackForCorrectionEmail, {
        documentName: envelope.title,
        requestedByName,
        reason,
        documentUrl,
        isActionRequired,
        assetBaseUrl: NEXT_PUBLIC_WEBAPP_URL(),
      });

      const [html, text] = await Promise.all([
        renderEmailWithI18N(template, { lang: emailLanguage, branding }),
        renderEmailWithI18N(template, {
          lang: emailLanguage,
          branding,
          plainText: true,
        }),
      ]);

      await mailer.sendMail({
        to,
        from: senderEmail,
        replyTo: replyToEmail,
        subject: i18n._(msg`Document "${envelope.title}" - Sent Back for Correction`),
        html,
        text,
      });
    });
  };

  if (target) {
    // Notify the recipient the document was sent back to, so they can make their correction.
    if (isRecipientEmailValidForSending(target)) {
      await sendEmail(
        'send-correction-request-email',
        { name: target.name, address: target.email },
        formatSigningLink(target.token),
        true,
      );

      await io.runTask('update-target-recipient', async () => {
        await prisma.recipient.update({
          where: {
            id: target.id,
          },
          data: {
            sendStatus: SendStatus.SENT,
          },
        });
      });
    }

    // Let the document owner know their document was routed back, unless they initiated it themselves.
    if (actor) {
      await sendEmail(
        'send-owner-notification-email',
        { name: envelope.user.name || '', address: envelope.user.email },
        ownerDocumentUrl,
        false,
      );
    }
  } else {
    // Sent back to the sender: only the owner needs to act.
    await sendEmail(
      'send-sender-correction-request-email',
      { name: envelope.user.name || '', address: envelope.user.email },
      ownerDocumentUrl,
      true,
    );
  }
};
