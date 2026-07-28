import { Trans } from '@lingui/react/macro';

import { Button, Heading, Text } from '../components';

export interface TemplateDocumentSentBackForCorrectionProps {
  documentName: string;
  requestedByName: string;
  reason: string;
  documentUrl: string;
  isActionRequired: boolean;
}

export function TemplateDocumentSentBackForCorrection({
  documentName,
  requestedByName,
  reason,
  documentUrl,
  isActionRequired,
}: TemplateDocumentSentBackForCorrectionProps) {
  return (
    <div className="mt-4">
      <Heading className="mb-4 text-center text-2xl font-semibold text-slate-800">
        <Trans>Document Sent Back for Correction</Trans>
      </Heading>

      <Text className="mb-4 text-base">
        {isActionRequired ? (
          <Trans>
            {requestedByName} has sent the document "{documentName}" back to you for correction.
          </Trans>
        ) : (
          <Trans>
            {requestedByName} has sent the document "{documentName}" back for correction.
          </Trans>
        )}
      </Text>

      {reason && (
        <Text className="mb-4 text-base text-slate-400">
          <Trans>Reason: {reason}</Trans>
        </Text>
      )}

      {isActionRequired && (
        <Text className="mb-6 text-base">
          <Trans>Please review and update your information, then resubmit the document.</Trans>
        </Text>
      )}

      <Button
        href={documentUrl}
        className="bg-documenso-500 inline-flex items-center justify-center rounded-lg px-6 py-3 text-center text-sm font-medium text-black no-underline"
      >
        {isActionRequired ? <Trans>Review & Correct</Trans> : <Trans>View Document</Trans>}
      </Button>
    </div>
  );
}
