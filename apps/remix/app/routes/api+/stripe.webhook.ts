import { stripeWebhookHandler } from '@documenso/ee/server-only/stripe/webhook/handler';

import type { Route } from './+types/stripe.webhook';

export async function action({ request }: Route.ActionArgs) {
  return await stripeWebhookHandler(request);
}
