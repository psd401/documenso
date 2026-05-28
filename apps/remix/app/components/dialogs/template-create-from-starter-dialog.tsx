import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import type * as DialogPrimitive from '@radix-ui/react-dialog';
import { FilePlus2Icon, SparklesIcon } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';

import { AppError } from '@documenso/lib/errors/app-error';
import { formatTemplatesPath } from '@documenso/lib/utils/teams';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { useCurrentTeam } from '~/providers/team';

export type TemplateCreateFromStarterDialogProps = {
  trigger?: React.ReactNode;
} & Omit<DialogPrimitive.DialogProps, 'children'>;

export const TemplateCreateFromStarterDialog = ({
  trigger,
  ...props
}: TemplateCreateFromStarterDialogProps) => {
  const { t } = useLingui();
  const { toast } = useToast();
  const navigate = useNavigate();
  const team = useCurrentTeam();
  const { folderId } = useParams();

  const [open, setOpen] = useState(false);
  const [pendingStarterId, setPendingStarterId] = useState<string | null>(null);

  const { data, isLoading } = trpc.template.getStarterTemplates.useQuery(undefined, {
    enabled: open,
  });

  const { mutateAsync: createTemplateFromStarter } =
    trpc.template.createTemplateFromStarter.useMutation();

  const onCreate = async (starterId: string) => {
    setPendingStarterId(starterId);

    try {
      const { envelopeId } = await createTemplateFromStarter({ starterId, folderId });

      toast({
        description: t`Template created successfully`,
      });

      setOpen(false);

      await navigate(`${formatTemplatesPath(team.url)}/${envelopeId}/edit`);
    } catch (err) {
      const error = AppError.parseError(err);

      toast({
        title: t`Failed to create template`,
        description: error.message ?? t`An unknown error occurred while creating the template.`,
        variant: 'destructive',
      });
    } finally {
      setPendingStarterId(null);
    }
  };

  return (
    <Dialog {...props} open={open} onOpenChange={(value) => !pendingStarterId && setOpen(value)}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            className="flex items-center"
            data-testid="starter-template-button"
          >
            <SparklesIcon className="mr-2 h-4 w-4" />
            <Trans>Starter templates</Trans>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Start from a template</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Create a ready-to-use template in one click. You can adjust the document, recipients
              and fields afterwards.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading && (
            <p className="text-sm text-muted-foreground">
              <Trans>Loading starter templates...</Trans>
            </p>
          )}

          {data?.templates.map((starter) => (
            <div
              key={starter.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{starter.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{starter.description}</p>
              </div>

              <Button
                size="sm"
                className="shrink-0"
                loading={pendingStarterId === starter.id}
                disabled={pendingStarterId !== null}
                onClick={() => void onCreate(starter.id)}
                data-testid={`starter-template-create-${starter.id}`}
              >
                <FilePlus2Icon className="mr-2 h-4 w-4" />
                <Trans>Create</Trans>
              </Button>
            </div>
          ))}

          {data && data.templates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              <Trans>No starter templates are available.</Trans>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
