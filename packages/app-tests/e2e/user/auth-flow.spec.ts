import { expect, test } from '@playwright/test';

import { prisma } from '@documenso/prisma';
import { seedUser } from '@documenso/prisma/seed/users';

import { apiSignin } from '../fixtures/authentication';

test.use({ storageState: { cookies: [], origins: [] } });

test('[USER] password sign-up redirects to the PSD sign-in page', async ({ page }) => {
  await page.goto('/signup');

  await expect(page).toHaveURL('/signin');
  await expect(page.getByRole('heading', { name: 'PSD Document Signing' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
});

test('[USER] sign-in directs users to PSD Google SSO and support', async ({ page }) => {
  await page.goto('/signin');

  await expect(
    page.getByText('Sign in with your Peninsula School District Google account.'),
  ).toBeVisible();
  await expect(page.getByText('Google sign-in is not configured')).toBeVisible();
  await expect(page.getByRole('link', { name: 'PSD401 IT Support' })).toHaveAttribute(
    'href',
    'https://support.psd401.net',
  );
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
});

test('[USER] teamless non-admin receives an actionable dashboard empty state', async ({ page }) => {
  const { user, organisation } = await seedUser();

  await prisma.organisation.delete({
    where: {
      id: organisation.id,
    },
  });

  await apiSignin({
    page,
    email: user.email,
  });

  await expect(page.getByText('No organisations found')).toBeVisible();
  await expect(
    page.getByText('Contact your administrator to request organisation access.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create organisation' })).toHaveCount(0);
});
