// ABOUTME: Dialog for editing an existing directory mapping rule, opened from the table row menu.
import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';

import { trpc } from '@documenso/trpc/react';
import type { TFindDirectoryMappingsResponse } from '@documenso/trpc/server/admin-router/find-directory-mappings.types';
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

import { DirectoryMappingForm } from '../forms/directory-mapping-form';

export type DirectoryMappingUpdateDialogProps = {
  mapping: TFindDirectoryMappingsResponse['data'][number];
  trigger: React.ReactNode;
};

export const DirectoryMappingUpdateDialog = ({
  mapping,
  trigger,
}: DirectoryMappingUpdateDialogProps) => {
  const { t } = useLingui();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  const { data: groups } = trpc.admin.directoryMappings.listGroups.useQuery(undefined, {
    enabled: open,
  });

  const { mutateAsync: updateMapping, isPending } = trpc.admin.directoryMappings.update.useMutation(
    {
      onSuccess: () => {
        toast({ title: t`Directory mapping updated successfully.` });
        setOpen(false);
      },
      onError: () => {
        toast({
          title: t`Failed to update directory mapping.`,
          variant: 'destructive',
        });
      },
    },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </DialogTrigger>

      <DialogContent className="scrollbar-hidden max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Update Directory Mapping</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Modify the details of this directory mapping.</Trans>
          </DialogDescription>
        </DialogHeader>

        <DirectoryMappingForm
          mapping={{
            sourceField: mapping.sourceField,
            sourceValue: mapping.sourceValue,
            organisationGroupId: mapping.organisationGroupId,
            active: mapping.active,
          }}
          groups={groups ?? []}
          onFormSubmit={async (data) => {
            await updateMapping({
              id: mapping.id,
              ...data,
            });
          }}
          formSubmitTrigger={
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                <Trans>Cancel</Trans>
              </Button>

              <Button type="submit" loading={isPending}>
                <Trans>Update Mapping</Trans>
              </Button>
            </DialogFooter>
          }
        />
      </DialogContent>
    </Dialog>
  );
};
