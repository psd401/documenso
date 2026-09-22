// ABOUTME: Admin table listing directory mappings, with an inline active toggle and a row
// ABOUTME: menu for update/delete, mirroring admin-claims-table.tsx.
import { useMemo } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import { EditIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { useSearchParams } from 'react-router';

import { useUpdateSearchParams } from '@documenso/lib/client-only/hooks/use-update-search-params';
import { ZUrlSearchParamsSchema } from '@documenso/lib/types/search-params';
import { trpc } from '@documenso/trpc/react';
import { Badge } from '@documenso/ui/primitives/badge';
import type { DataTableColumnDef } from '@documenso/ui/primitives/data-table';
import { DataTable } from '@documenso/ui/primitives/data-table';
import { DataTablePagination } from '@documenso/ui/primitives/data-table-pagination';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';
import { Skeleton } from '@documenso/ui/primitives/skeleton';
import { Switch } from '@documenso/ui/primitives/switch';
import { TableCell } from '@documenso/ui/primitives/table';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { DirectoryMappingDeleteDialog } from '../dialogs/directory-mapping-delete-dialog';
import { DirectoryMappingUpdateDialog } from '../dialogs/directory-mapping-update-dialog';
import { formatGroupLabel } from '../forms/directory-mapping-form';

export const AdminDirectoryMappingsTable = () => {
  const { t, i18n } = useLingui();
  const { toast } = useToast();

  const [searchParams] = useSearchParams();
  const updateSearchParams = useUpdateSearchParams();

  const parsedSearchParams = ZUrlSearchParamsSchema.parse(Object.fromEntries(searchParams ?? []));

  const { data, isLoading, isLoadingError } = trpc.admin.directoryMappings.find.useQuery({
    query: parsedSearchParams.query,
    page: parsedSearchParams.page,
    perPage: parsedSearchParams.perPage,
  });

  const { mutate: updateMapping } = trpc.admin.directoryMappings.update.useMutation({
    onError: () => {
      toast({
        title: t`Failed to update directory mapping.`,
        variant: 'destructive',
      });
    },
  });

  const onPaginationChange = (page: number, perPage: number) => {
    updateSearchParams({ page, perPage });
  };

  const results = data ?? {
    data: [],
    perPage: 10,
    currentPage: 1,
    totalPages: 1,
  };

  const columns = useMemo(() => {
    return [
      {
        header: t`Source Field`,
        accessorKey: 'sourceField',
        cell: ({ row }) => <Badge>{row.original.sourceField}</Badge>,
      },
      {
        header: t`Source Value`,
        accessorKey: 'sourceValue',
      },
      {
        header: t`Target Group`,
        cell: ({ row }) => {
          const group = row.original.organisationGroup;

          return (
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
                    .map((teamGroup) => `${teamGroup.team.name} (${teamGroup.teamRole})`)
                    .join(', ')}
                </span>
              )}
            </div>
          );
        },
      },
      {
        header: t`Updated`,
        accessorKey: 'updatedAt',
        cell: ({ row }) => i18n.date(row.original.updatedAt),
      },
      {
        header: t`Active`,
        cell: ({ row }) => (
          <Switch
            checked={row.original.active}
            onCheckedChange={(checked) => updateMapping({ id: row.original.id, active: checked })}
          />
        ),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <MoreHorizontalIcon className="h-5 w-5 text-muted-foreground" />
            </DropdownMenuTrigger>

            <DropdownMenuContent className="w-52" align="start" forceMount>
              <DropdownMenuLabel>
                <Trans>Actions</Trans>
              </DropdownMenuLabel>

              <DirectoryMappingUpdateDialog
                mapping={row.original}
                trigger={
                  <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                    <div>
                      <EditIcon className="mr-2 h-4 w-4" />
                      <Trans>Update</Trans>
                    </div>
                  </DropdownMenuItem>
                }
              />

              <DirectoryMappingDeleteDialog
                mappingId={row.original.id}
                mappingLabel={`${row.original.sourceField}: ${row.original.sourceValue}`}
                trigger={
                  <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                    <div>
                      <Trash2Icon className="mr-2 h-4 w-4" />
                      <Trans>Delete</Trans>
                    </div>
                  </DropdownMenuItem>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ] satisfies DataTableColumnDef<(typeof results)['data'][number]>[];
  }, []);

  return (
    <div>
      <DataTable
        columns={columns}
        data={results.data}
        perPage={results.perPage}
        currentPage={results.currentPage}
        totalPages={results.totalPages}
        onPaginationChange={onPaginationChange}
        error={{ enable: isLoadingError }}
        skeleton={{
          enable: isLoading,
          rows: 3,
          component: (
            <>
              <TableCell className="py-4 pr-4">
                <Skeleton className="h-4 w-20 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-8 rounded-full" />
              </TableCell>
              <TableCell>
                <div className="flex flex-row justify-end space-x-2">
                  <Skeleton className="h-2 w-6 rounded" />
                </div>
              </TableCell>
            </>
          ),
        }}
      >
        {(table) => <DataTablePagination additionalInformation="VisibleCount" table={table} />}
      </DataTable>
    </div>
  );
};
