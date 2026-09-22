import { RecipientRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  isAssistantLastSigner,
  normalizeRecipientSigningOrders,
  normalizeRecipientSigningSlots,
  sortRecipientsForSigningOrder,
} from './recipients';

describe('recipient signing order helpers', () => {
  it('sorts CC recipients after ordered active recipients', () => {
    const recipients = [
      { id: 1, role: RecipientRole.CC, signingOrder: 1 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 2 },
      { id: 3, role: RecipientRole.APPROVER, signingOrder: 1 },
    ];

    expect(sortRecipientsForSigningOrder(recipients).map((recipient) => recipient.id)).toEqual([3, 2, 1]);
  });

  it('keeps original order when recipients have the same signing order', () => {
    const recipients = [
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 1, role: RecipientRole.APPROVER, signingOrder: 1 },
    ];

    expect(sortRecipientsForSigningOrder(recipients).map((recipient) => recipient.id)).toEqual([2, 1]);
  });

  it('sorts and normalizes active recipient signing order and removes it from CC recipients', () => {
    const recipients = [
      { id: 1, role: RecipientRole.CC, signingOrder: 1 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 4 },
      { id: 3, role: RecipientRole.APPROVER, signingOrder: 2 },
    ];

    expect(normalizeRecipientSigningOrders(sortRecipientsForSigningOrder(recipients))).toEqual([
      { id: 3, role: RecipientRole.APPROVER, signingOrder: 1 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 2 },
      { id: 1, role: RecipientRole.CC, signingOrder: undefined },
    ]);
  });

  it('preserves caller order while normalizing signing order', () => {
    const recipients = [
      { id: 2, role: RecipientRole.ASSISTANT, signingOrder: 2 },
      { id: 1, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 3, role: RecipientRole.CC, signingOrder: 1 },
    ];

    expect(normalizeRecipientSigningOrders(recipients)).toEqual([
      { id: 2, role: RecipientRole.ASSISTANT, signingOrder: 1 },
      { id: 1, role: RecipientRole.SIGNER, signingOrder: 2 },
      { id: 3, role: RecipientRole.CC, signingOrder: undefined },
    ]);
  });

  it('checks whether the last non-CC recipient is an assistant', () => {
    expect(
      isAssistantLastSigner([
        { role: RecipientRole.SIGNER },
        { role: RecipientRole.ASSISTANT },
        { role: RecipientRole.CC },
      ]),
    ).toBe(true);

    expect(
      isAssistantLastSigner([
        { role: RecipientRole.ASSISTANT },
        { role: RecipientRole.SIGNER },
        { role: RecipientRole.CC },
      ]),
    ).toBe(false);
  });
});

describe('normalizeRecipientSigningSlots', () => {
  it('keeps recipients that share a signing order in the same slot', () => {
    const recipients = [
      { id: 1, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 3, role: RecipientRole.APPROVER, signingOrder: 2 },
    ];

    expect(normalizeRecipientSigningSlots(recipients)).toEqual([
      { id: 1, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 3, role: RecipientRole.APPROVER, signingOrder: 2 },
    ]);
  });

  it('sorts by signing order and collapses gaps into contiguous slots', () => {
    const recipients = [
      { id: 1, role: RecipientRole.SIGNER, signingOrder: 5 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 2 },
      { id: 3, role: RecipientRole.APPROVER, signingOrder: 5 },
      { id: 4, role: RecipientRole.SIGNER, signingOrder: 9 },
    ];

    expect(normalizeRecipientSigningSlots(recipients)).toEqual([
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 1, role: RecipientRole.SIGNER, signingOrder: 2 },
      { id: 3, role: RecipientRole.APPROVER, signingOrder: 2 },
      { id: 4, role: RecipientRole.SIGNER, signingOrder: 3 },
    ]);
  });

  it('removes signing order from CC recipients and places them last', () => {
    const recipients = [
      { id: 1, role: RecipientRole.CC, signingOrder: 1 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 3 },
      { id: 3, role: RecipientRole.SIGNER, signingOrder: 3 },
    ];

    expect(normalizeRecipientSigningSlots(recipients)).toEqual([
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 3, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 1, role: RecipientRole.CC, signingOrder: undefined },
    ]);
  });

  it('keeps the existing signing order of recipients that cannot be updated', () => {
    const recipients = [
      { id: 1, role: RecipientRole.SIGNER, signingOrder: 2 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 4 },
      { id: 3, role: RecipientRole.SIGNER, signingOrder: 6 },
    ];

    expect(normalizeRecipientSigningSlots(recipients, (recipient) => recipient.id !== 3)).toEqual([
      { id: 1, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 2 },
      { id: 3, role: RecipientRole.SIGNER, signingOrder: 6 },
    ]);
  });

  it('sorts recipients without a signing order last, each in its own slot', () => {
    const recipients = [
      { id: 1, role: RecipientRole.SIGNER },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 3 },
      { id: 3, role: RecipientRole.SIGNER },
      { id: 4, role: RecipientRole.SIGNER, signingOrder: 1 },
    ];

    expect(normalizeRecipientSigningSlots(recipients)).toEqual([
      { id: 4, role: RecipientRole.SIGNER, signingOrder: 1 },
      { id: 2, role: RecipientRole.SIGNER, signingOrder: 2 },
      { id: 1, role: RecipientRole.SIGNER, signingOrder: 3 },
      { id: 3, role: RecipientRole.SIGNER, signingOrder: 4 },
    ]);
  });
});
