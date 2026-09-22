import { downloadPDF } from '@documenso/lib/client-only/download-pdf';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { Skeleton } from '@documenso/ui/primitives/skeleton';
import { useToast } from '@documenso/ui/primitives/use-toast';
import { Trans, useLingui } from '@lingui/react/macro';
import { DocumentStatus, type EnvelopeItem } from '@prisma/client';
import { DownloadIcon, FileTextIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

type EnvelopeItemToDownload = Pick<EnvelopeItem, 'id' | 'envelopeId' | 'title' | 'order'>;

type DownloadVersion = 'original' | 'signed' | 'pending';

type EnvelopeDownloadDialogProps = {
  envelopeId: string;
  envelopeStatus: DocumentStatus;

  /**
   * Whether the envelope is a legacy (v1) envelope. Only consulted to gate the
   * partial-download variant: legacy envelopes use a different field-rendering
   * pipeline that the partial PDF helper does not implement, so the Partial
   * button is hidden for them.
   *
   * Optional: omit it on call sites where the status can never be PENDING (DRAFT,
   * COMPLETED, REJECTED) or when a recipient token is set, since the Partial button
   * is also gated on those. Pass it from team-side call sites that can render the
   * dialog for a PENDING envelope.
   */
  isLegacy?: boolean;
  envelopeItems?: EnvelopeItemToDownload[];

  /**
   * The recipient token to download the document.
   *
   * If not provided, it will be assumed that the current user can access the document.
   */
  token?: string;

  /**
   * Whether the current user is permitted to download the partial (in-progress) version.
   * Only the document owner or a managing team member should pass true.
   */
  canDownloadPartial?: boolean;

  trigger: React.ReactNode;
};

export const EnvelopeDownloadDialog = ({
  envelopeId,
  envelopeStatus,
  isLegacy,
  envelopeItems: initialEnvelopeItems,
  token,
  canDownloadPartial = false,
  trigger,
}: EnvelopeDownloadDialogProps) => {
  const { toast } = useToast();
  const { t } = useLingui();

  const [open, setOpen] = useState(false);

  const [isDownloadingState, setIsDownloadingState] = useState<{
    [envelopeItemIdAndVersion: string]: boolean;
  }>({});

  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  const generateDownloadKey = (envelopeItemId: string, version: DownloadVersion) => `${envelopeItemId}-${version}`;

  // The dialog shows the original document alongside one of:
  //   - "Signed" (when the envelope is COMPLETED)
  //   - "Partial" (when the envelope is PENDING, not legacy, the caller has granted
  //     canDownloadPartial, and we are on the team/owner side; recipients are
  //     intentionally not offered this since the partial PDF carries no PKI signature
  //     and would create a leak vector for half-executed contracts; legacy envelopes
  //     use a different rendering pipeline that the partial-download helper does not
  //     implement)
  //   - nothing (DRAFT, REJECTED, PENDING with recipient token, or legacy PENDING)
  const secondaryDownload = useMemo<{ version: 'signed' | 'pending'; label: string } | null>(() => {
    if (envelopeStatus === DocumentStatus.COMPLETED) {
      return {
        version: 'signed',
        label: t({ message: 'Signed', context: 'Signed document (adjective)' }),
      };
    }

    if (envelopeStatus === DocumentStatus.PENDING && canDownloadPartial && !token && !isLegacy) {
      return {
        version: 'pending',
        label: t({ message: 'Partial', context: 'Partially signed document (adjective)' }),
      };
    }

    return null;
  }, [envelopeStatus, isLegacy, canDownloadPartial, token, t]);

  // The version "Download all" grabs for each document: the final signed copy once
  // the envelope is completed, otherwise the original upload.
  const downloadAllVersion: DownloadVersion = envelopeStatus === DocumentStatus.COMPLETED ? 'signed' : 'original';

  const { data: envelopeItemsPayload, isLoading: isLoadingEnvelopeItems } = trpc.envelope.item.getManyByToken.useQuery(
    {
      envelopeId,
      access: token ? { type: 'recipient', token } : { type: 'user' },
    },
    {
      initialData: initialEnvelopeItems ? { data: initialEnvelopeItems } : undefined,
      enabled: open,
    },
  );

  const envelopeItems = envelopeItemsPayload?.data || [];

  const onDownload = async (envelopeItem: EnvelopeItemToDownload, version: DownloadVersion) => {
    const { id: envelopeItemId } = envelopeItem;

    if (isDownloadingState[generateDownloadKey(envelopeItemId, version)]) {
      return;
    }

    setIsDownloadingState((prev) => ({
      ...prev,
      [generateDownloadKey(envelopeItemId, version)]: true,
    }));

    try {
      await downloadPDF({
        envelopeItem,
        token,
        fileName: envelopeItem.title,
        version,
      });

      setIsDownloadingState((prev) => ({
        ...prev,
        [generateDownloadKey(envelopeItemId, version)]: false,
      }));
    } catch (error) {
      setIsDownloadingState((prev) => ({
        ...prev,
        [generateDownloadKey(envelopeItemId, version)]: false,
      }));

      console.error(error);

      toast({
        title: t`Something went wrong`,
        description: t`This document could not be downloaded at this time. Please try again.`,
        variant: 'destructive',
        duration: 7500,
      });
    }
  };

  const onDownloadAll = async () => {
    if (isDownloadingAll || envelopeItems.length === 0) {
      return;
    }

    setIsDownloadingAll(true);

    const failedTitles: string[] = [];

    // Download each document sequentially so the browser reliably triggers every
    // save instead of throttling a burst of simultaneous downloads.
    for (const envelopeItem of envelopeItems) {
      try {
        await downloadPDF({
          envelopeItem,
          token,
          fileName: envelopeItem.title,
          version: downloadAllVersion,
        });
      } catch (error) {
        console.error(error);
        failedTitles.push(envelopeItem.title);
      }
    }

    setIsDownloadingAll(false);

    if (failedTitles.length > 0) {
      toast({
        title: t`Some documents could not be downloaded`,
        description: t`${failedTitles.length} of ${envelopeItems.length} documents failed to download. Please try again.`,
        variant: 'destructive',
        duration: 7500,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => setOpen(value)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Download Files</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Select the files you would like to download.</Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 flex max-h-[60vh] w-full flex-col gap-4 overflow-y-auto pr-2">
          {isLoadingEnvelopeItems
            ? Array.from({ length: 1 }).map((_, index) => (
                <div key={index} className="flex items-center gap-2 rounded-lg border border-border bg-card p-4">
                  <Skeleton className="h-10 w-10 flex-shrink-0 rounded-lg" />

                  <div className="flex w-full flex-col gap-2">
                    <Skeleton className="h-4 w-28 rounded-lg" />
                    <Skeleton className="h-4 w-20 rounded-lg" />
                  </div>

                  <Skeleton className="h-10 w-20 flex-shrink-0 rounded-lg" />
                </div>
              ))
            : envelopeItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
                >
                  <div className="flex-shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <FileTextIcon className="h-5 w-5 text-primary" />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="truncate font-medium text-foreground text-sm" title={item.title}>
                      {item.title}
                    </h4>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      <Trans>PDF Document</Trans>
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={async () => onDownload(item, 'original')}
                      loading={isDownloadingState[generateDownloadKey(item.id, 'original')]}
                    >
                      {!isDownloadingState[generateDownloadKey(item.id, 'original')] && (
                        <DownloadIcon className="mr-2 h-4 w-4" />
                      )}
                      <Trans context="Original document (adjective)">Original</Trans>
                    </Button>

                    {secondaryDownload && (
                      <Button
                        variant={secondaryDownload.version === 'pending' ? 'secondary' : 'default'}
                        size="sm"
                        className="text-xs"
                        onClick={async () => onDownload(item, secondaryDownload.version)}
                        loading={isDownloadingState[generateDownloadKey(item.id, secondaryDownload.version)]}
                        title={
                          secondaryDownload.version === 'pending'
                            ? t`Includes signatures collected so far. Watermarked as a draft.`
                            : undefined
                        }
                      >
                        {!isDownloadingState[generateDownloadKey(item.id, secondaryDownload.version)] && (
                          <DownloadIcon className="mr-2 h-4 w-4" />
                        )}
                        {secondaryDownload.version === 'pending' ? (
                          <Trans context="Partially signed draft document">Partial (Draft)</Trans>
                        ) : (
                          secondaryDownload.label
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
        </div>

        <DialogFooter>
          <Button
            type="button"
            className="w-full"
            onClick={onDownloadAll}
            loading={isDownloadingAll}
            disabled={isLoadingEnvelopeItems || envelopeItems.length === 0}
          >
            {!isDownloadingAll && <DownloadIcon className="mr-2 h-4 w-4" />}
            {downloadAllVersion === 'signed' ? (
              <Trans>Download all (signed)</Trans>
            ) : (
              <Trans>Download all (original)</Trans>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
