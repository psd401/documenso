// ABOUTME: Dialog for creating a directory mapping rule. Fetches the group picker options
// ABOUTME: itself so the create button works standalone from the page header.
import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';

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
import { useToast } from '@documenso/ui/primitives/use-toast';

import { DirectoryMappingForm } from '../forms/directory-mapping-form';

export const DirectoryMappingCreateDialog = () => {
  const { t } = useLingui();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  const { data: groups } = trpc.admin.directoryMappings.listGroups.useQuery(undefined, {
    enabled: open,
  });

  const { mutateAsync: createMapping, isPending } = trpc.admin.directoryMappings.create.useMutation(
    {
      onSuccess: () => {
        toast({ title: t`Directory mapping created successfully.` });
        setOpen(false);
      },
      onError: () => {
        toast({
          title: t`Failed to create directory mapping.`,
          variant: 'destructive',
        });
      },
    },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger onClick={(e) => e.stopPropagation()} asChild={true}>
        <Button className="flex-shrink-0" variant="secondary">
          <Trans>Create mapping</Trans>
        </Button>
      </DialogTrigger>

      <DialogContent className="scrollbar-hidden max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Create Directory Mapping</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Map a Google directory value to a target group.</Trans>
          </DialogDescription>
        </DialogHeader>

        <DirectoryMappingForm
          mapping={{
            sourceField: 'GROUP',
            sourceValue: '',
            organisationGroupId: groups?.[0]?.id ?? '',
            active: true,
          }}
          groups={groups ?? []}
          onFormSubmit={async (data) => {
            await createMapping(data);
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
                <Trans>Create Mapping</Trans>
              </Button>
            </DialogFooter>
          }
        />
      </DialogContent>
    </Dialog>
  );
};
