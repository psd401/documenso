// ABOUTME: Unit tests for the editor recipients form validation helper.
// ABOUTME: Covers the schema gate used before persisting recipient changes, including CSC-mode constraints.
import { DocumentSigningOrder, RecipientRole } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateEditorRecipientsForm } from './use-editor-recipients';

const baseSigner = {
  formId: 'signer-1',
  id: 1,
  email: 'signer@example.com',
  name: 'Signer One',
  role: RecipientRole.SIGNER,
  signingOrder: 1,
  actionAuth: [],
};

describe('validateEditorRecipientsForm', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the parsed form when all signers are valid', () => {
    const result = validateEditorRecipientsForm({
      signers: [baseSigner],
      signingOrder: DocumentSigningOrder.PARALLEL,
      allowDictateNextSigner: false,
    });

    expect(result).not.toBeNull();
    expect(result?.signers).toEqual([baseSigner]);
  });

  it('returns null when a signer has an invalid email', () => {
    const result = validateEditorRecipientsForm({
      signers: [{ ...baseSigner, email: 'not-an-email' }],
      signingOrder: DocumentSigningOrder.PARALLEL,
      allowDictateNextSigner: false,
    });

    expect(result).toBeNull();
  });

  it('returns null when the form is otherwise malformed', () => {
    const result = validateEditorRecipientsForm({ signers: 'not-an-array' });

    expect(result).toBeNull();
  });

  it('returns null in CSC mode when a signer has the ASSISTANT role', () => {
    vi.stubEnv('NEXT_PRIVATE_SIGNING_TRANSPORT', 'csc');

    const result = validateEditorRecipientsForm({
      signers: [{ ...baseSigner, role: RecipientRole.ASSISTANT }],
      signingOrder: DocumentSigningOrder.SEQUENTIAL,
      allowDictateNextSigner: false,
    });

    expect(result).toBeNull();
  });

  it('accepts the ASSISTANT role outside CSC mode', () => {
    const result = validateEditorRecipientsForm({
      signers: [{ ...baseSigner, role: RecipientRole.ASSISTANT }],
      signingOrder: DocumentSigningOrder.SEQUENTIAL,
      allowDictateNextSigner: false,
    });

    expect(result).not.toBeNull();
  });
});
