// ABOUTME: Guards against reintroducing the unauthenticated-by-design /api/webhook/trigger route.
// ABOUTME: Its only check was a signature keyed on NEXT_PRIVATE_ENCRYPTION_KEY, and nothing in the app calls it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const fromRoot = (relativePath: string) => path.join(REPO_ROOT, relativePath);

describe('/api/webhook/trigger route', () => {
  it('has no route module', () => {
    expect(existsSync(fromRoot('apps/remix/app/routes/api+/webhook.trigger.ts'))).toBe(false);
  });

  it('has no request handler', () => {
    expect(existsSync(fromRoot('packages/lib/server-only/webhooks/trigger/handler.ts'))).toBe(false);
  });

  it('is not referenced by the stripe webhook route types', () => {
    const stripeRoute = readFileSync(fromRoot('apps/remix/app/routes/api+/stripe.webhook.ts'), 'utf8');

    expect(stripeRoute).not.toContain('webhook.trigger');
  });
});
