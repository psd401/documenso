// ABOUTME: Confirmation dialog for deleting a directory mapping rule. Deleting a mapping does
// ABOUTME: not remove any group memberships it already granted; the invariant is additive-only.
import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';

import { trpc } from '@documenso/trpc/react';
import { Alert, AlertDescription } from '@documenso/ui/primitives/alert';
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
import { useToast } from '@documenso/ui/primitives/use-toast';

export type DirectoryMappingDeleteDialogProps = {
  mappingId: string;
  mappingLabel: string;
  trigger: React.ReactNode;
};

export const DirectoryMappingDeleteDialog = ({
  mappingId,
  mappingLabel,
  trigger,
}: DirectoryMappingDeleteDialogProps) => {
  const { t } = useLingui();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  const { mutateAsync: deleteMapping, isPending } = trpc.admin.directoryMappings.delete.useMutation(
    {
      onSuccess: () => {
        toast({ title: t`Directory mapping deleted successfully.` });
        setOpen(false);
      },
      onError: (err) => {
        console.error(err);

        toast({
          title: t`Failed to delete directory mapping.`,
          variant: 'destructive',
        });
      },
    },
  );

  return (
    <Dialog open={open} onOpenChange={(value) => !isPending && setOpen(value)}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Delete Directory Mapping</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Are you sure you want to delete the following mapping?</Trans>
          </DialogDescription>
        </DialogHeader>

        <Alert variant="neutral">
          <AlertDescription className="text-center font-semibold">{mappingLabel}</AlertDescription>
        </Alert>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            <Trans>Cancel</Trans>
          </Button>

          <Button
            type="submit"
            variant="destructive"
            loading={isPending}
            onClick={async () => deleteMapping({ id: mappingId })}
          >
            <Trans>Delete</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
