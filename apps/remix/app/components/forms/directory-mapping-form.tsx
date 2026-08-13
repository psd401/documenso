// ABOUTME: Form for creating and editing a directory mapping rule. Shared by the create and
// ABOUTME: update dialogs, following the pattern in subscription-claim-form.tsx.
import { zodResolver } from '@hookform/resolvers/zod';
import { Trans, useLingui } from '@lingui/react/macro';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { ZCreateDirectoryMappingRequestSchema } from '@documenso/trpc/server/admin-router/create-directory-mapping.types';
import type { TListDirectoryMappingGroupsResponse } from '@documenso/trpc/server/admin-router/list-directory-mapping-groups.types';
import { Badge } from '@documenso/ui/primitives/badge';
import { Checkbox } from '@documenso/ui/primitives/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@documenso/ui/primitives/select';

export type DirectoryMappingFormValues = z.infer<typeof ZCreateDirectoryMappingRequestSchema>;

type DirectoryMappingFormProps = {
  mapping: DirectoryMappingFormValues;
  groups: TListDirectoryMappingGroupsResponse;
  onFormSubmit: (data: DirectoryMappingFormValues) => Promise<void>;
  formSubmitTrigger?: React.ReactNode;
};

export const formatGroupLabel = (group: TListDirectoryMappingGroupsResponse[number]) => {
  const teamNames = group.teamGroups.map((teamGroup) => teamGroup.team.name);

  return group.name ?? (teamNames.length > 0 ? teamNames.join(', ') : group.id);
};

export const DirectoryMappingForm = ({
  mapping,
  groups,
  onFormSubmit,
  formSubmitTrigger,
}: DirectoryMappingFormProps) => {
  const { t } = useLingui();

  const form = useForm<DirectoryMappingFormValues>({
    resolver: zodResolver(ZCreateDirectoryMappingRequestSchema),
    defaultValues: mapping,
  });

  const sourceField = useWatch({ control: form.control, name: 'sourceField' });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onFormSubmit)}>
        <fieldset disabled={form.formState.isSubmitting} className="space-y-4">
          <FormField
            control={form.control}
            name="sourceField"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Source Field</Trans>
                </FormLabel>
                <FormControl>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GROUP">{t`Google Group`}</SelectItem>
                      <SelectItem value="DEPARTMENT">{t`Department`}</SelectItem>
                      <SelectItem value="ORG_UNIT">{t`Org Unit Path`}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="sourceValue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Source Value</Trans>
                </FormLabel>
                <FormControl>
                  <Input placeholder={t`e.g. tech-staff@psd401.net`} {...field} />
                </FormControl>
                <FormDescription>
                  {sourceField === 'ORG_UNIT' ? (
                    <Trans>a rule value of / matches every user with a non-null org unit</Trans>
                  ) : (
                    <Trans>
                      The Google group email, department name, or org unit path to match.
                    </Trans>
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="organisationGroupId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Target Group</Trans>
                </FormLabel>
                <FormControl>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue placeholder={t`Select a group`} />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          <div className="flex flex-col items-start gap-0.5">
                            <div className="flex items-center gap-2">
                              <span>{formatGroupLabel(group)}</span>
                              <Badge variant="neutral" size="small">
                                {group.type}
                              </Badge>
                            </div>
                            {group.teamGroups.length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {group.teamGroups
                                  .map(
                                    (teamGroup) => `${teamGroup.team.name} (${teamGroup.teamRole})`,
                                  )
                                  .join(', ')}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="active"
            render={({ field }) => (
              <FormItem className="flex items-center space-x-2">
                <FormControl>
                  <div className="flex items-center">
                    <Checkbox
                      id="mapping-active"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <label className="ml-2 text-sm text-muted-foreground" htmlFor="mapping-active">
                      <Trans>Active</Trans>
                    </label>
                  </div>
                </FormControl>
              </FormItem>
            )}
          />

          {formSubmitTrigger}
        </fieldset>
      </form>
    </Form>
  );
};
