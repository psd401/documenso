import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { redirect } from 'react-router';

import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { IS_GOOGLE_SSO_ENABLED } from '@documenso/lib/constants/auth';
import { isValidReturnTo, normalizeReturnTo } from '@documenso/lib/utils/is-valid-return-to';

import { SignInForm } from '~/components/forms/signin';
import { appMetaTags } from '~/utils/meta';

import type { Route } from './+types/signin';

export function meta() {
  return appMetaTags(msg`Sign In`);
}

export async function loader({ request }: Route.LoaderArgs) {
  const { isAuthenticated } = await getOptionalSession(request);

  let returnTo = new URL(request.url).searchParams.get('returnTo') ?? undefined;

  returnTo = isValidReturnTo(returnTo) ? normalizeReturnTo(returnTo) : undefined;

  if (isAuthenticated) {
    throw redirect(returnTo || '/');
  }

  return { returnTo, isGoogleSSOEnabled: IS_GOOGLE_SSO_ENABLED };
}

export default function SignIn({ loaderData }: Route.ComponentProps) {
  const { returnTo, isGoogleSSOEnabled } = loaderData;

  return (
    <div className="w-screen max-w-lg px-4">
      <div className="border-border dark:bg-background z-10 rounded-xl border bg-neutral-100 p-6">
        <h1 className="text-2xl font-semibold">
          <Trans>PSD Document Signing</Trans>
        </h1>

        <p className="text-muted-foreground mt-2 text-sm">
          <Trans>Sign in with your Peninsula School District Google account.</Trans>
        </p>
        <hr className="-mx-6 my-4" />

        <SignInForm isGoogleSSOEnabled={isGoogleSSOEnabled} returnTo={returnTo} />
      </div>
    </div>
  );
}
