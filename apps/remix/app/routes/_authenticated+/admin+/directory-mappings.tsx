// ABOUTME: Admin page listing and managing directory sync mapping rules.
import { useEffect, useState } from 'react';

import { useLingui } from '@lingui/react/macro';
import { useLocation, useSearchParams } from 'react-router';

import { useDebouncedValue } from '@documenso/lib/client-only/hooks/use-debounced-value';
import { Input } from '@documenso/ui/primitives/input';

import { DirectoryMappingCreateDialog } from '~/components/dialogs/directory-mapping-create-dialog';
import { SettingsHeader } from '~/components/general/settings-header';
import { AdminDirectoryMappingsTable } from '~/components/tables/admin-directory-mappings-table';

export default function DirectoryMappings() {
  const { t } = useLingui();

  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();

  const [searchQuery, setSearchQuery] = useState(() => searchParams?.get('query') ?? '');

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 500);

  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString());

    params.set('query', debouncedSearchQuery);

    if (debouncedSearchQuery === '') {
      params.delete('query');
    }

    if (params.toString() === searchParams?.toString()) {
      return;
    }

    setSearchParams(params);
  }, [debouncedSearchQuery, pathname, searchParams]);

  return (
    <div>
      <SettingsHeader
        title={t`Directory Mappings`}
        subtitle={t`Map Google directory groups, departments, and org units to Documenso groups`}
        hideDivider
      >
        <DirectoryMappingCreateDialog />
      </SettingsHeader>

      <div className="mt-4">
        <Input
          defaultValue={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t`Search by source value`}
          className="mb-4"
        />

        <AdminDirectoryMappingsTable />
      </div>
    </div>
  );
}
