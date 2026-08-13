// ABOUTME: E2E tests for checkbox/radio field transparency and per-item offset positioning.
// ABOUTME: Tests signing view rendering, editor offset inputs, and backward compatibility.
import { expect, test } from '@playwright/test';
import { FieldType } from '@prisma/client';

import { seedPendingDocumentWithFullFields } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';

import {
  clickAddMyselfButton,
  clickEnvelopeEditorStep,
  openDocumentEnvelopeEditor,
} from '../fixtures/envelope-editor';

const seedSigningEnvelope = async (fields: FieldType[]) => {
  const { user, team } = await seedUser();
  const { recipients } = await seedPendingDocumentWithFullFields({
    owner: user,
    recipients: [`field-positioning-${user.id}@example.com`],
    fields,
    teamId: team.id,
  });

  const recipient = recipients[0];

  if (!recipient) {
    throw new Error('Expected the field-positioning envelope to have a recipient');
  }

  return recipient;
};

const openCheckboxEditor = async (page: Parameters<typeof openDocumentEnvelopeEditor>[0]) => {
  const surface = await openDocumentEnvelopeEditor(page);

  await clickAddMyselfButton(surface.root);
  await clickEnvelopeEditorStep(surface.root, 'addFields');
  await surface.root.getByRole('button', { name: 'Checkbox', exact: true }).click();

  const canvas = surface.root.locator('.konva-container canvas').first();
  await expect(canvas).toBeVisible();
  await canvas.click({ position: { x: 150, y: 150 } });

  return surface.root;
};

const assertFieldHasNoOffsets = (fieldMeta: unknown) => {
  expect(fieldMeta).toEqual(
    expect.objectContaining({
      values: expect.arrayContaining([
        expect.not.objectContaining({
          offsetX: expect.anything(),
          offsetY: expect.anything(),
        }),
      ]),
    }),
  );
};

test.describe('Field Transparency', () => {
  test('checkbox fields in signing view have transparent background', async ({ page }) => {
    const recipient = await seedSigningEnvelope([FieldType.CHECKBOX]);

    await page.goto(`/sign/${recipient.token}`);

    const checkboxField = page.locator('[data-field-type="CHECKBOX"]').first();
    await expect(checkboxField).toBeVisible();

    const backgroundColor = await checkboxField.evaluate(
      (element) => window.getComputedStyle(element).backgroundColor,
    );

    expect(backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });

  test('signature fields still have opaque background', async ({ page }) => {
    const recipient = await seedSigningEnvelope([FieldType.SIGNATURE]);

    await page.goto(`/sign/${recipient.token}`);

    const signatureField = page.locator('[data-field-type="SIGNATURE"]').first();
    await expect(signatureField).toBeVisible();

    const backgroundColor = await signatureField.evaluate(
      (element) => window.getComputedStyle(element).backgroundColor,
    );

    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('Checkbox Editor Offset Inputs', () => {
  test('offset inputs appear in checkbox editor form', async ({ page }) => {
    const root = await openCheckboxEditor(page);

    await expect(root.getByTestId('field-form-values-0-offsetX')).toBeVisible();
    await expect(root.getByTestId('field-form-values-0-offsetY')).toBeVisible();
  });

  test('editing offset switches direction to custom', async ({ page }) => {
    const root = await openCheckboxEditor(page);

    await root.getByTestId('field-form-values-0-offsetX').fill('10');

    await expect(root.getByTestId('field-form-direction')).toContainText('Custom');
  });
});

test.describe('Schema Backward Compatibility', () => {
  test('existing checkbox fields without offsets render normally', async ({ page }) => {
    const recipient = await seedSigningEnvelope([FieldType.CHECKBOX]);
    const checkboxField = recipient.fields.find((field) => field.type === FieldType.CHECKBOX);

    if (!checkboxField) {
      throw new Error('Expected the field-positioning envelope to have a checkbox field');
    }

    assertFieldHasNoOffsets(checkboxField.fieldMeta);
    await page.goto(`/sign/${recipient.token}`);

    const field = page.locator(`#field-${checkboxField.id}`);
    await expect(field).toBeVisible();
    await expect(field.locator('input[type="checkbox"], [role="checkbox"]')).not.toHaveCount(0);
  });

  test('existing radio fields without offsets render normally', async ({ page }) => {
    const recipient = await seedSigningEnvelope([FieldType.RADIO]);
    const radioField = recipient.fields.find((field) => field.type === FieldType.RADIO);

    if (!radioField) {
      throw new Error('Expected the field-positioning envelope to have a radio field');
    }

    assertFieldHasNoOffsets(radioField.fieldMeta);
    await page.goto(`/sign/${recipient.token}`);

    const field = page.locator(`#field-${radioField.id}`);
    await expect(field).toBeVisible();
    await expect(field.locator('input[type="radio"], [role="radio"]')).not.toHaveCount(0);
  });
});
