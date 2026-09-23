import type { Context as HonoContext } from 'hono';

import { env } from '../../utils/env';
import type { JobDefinition, TriggerJobOptions } from './_internal/job';
import type { BaseJobProvider as JobClientProvider } from './base';
import { LocalJobProvider } from './local';

export class JobClient<T extends ReadonlyArray<JobDefinition> = []> {
  private _provider: Promise<JobClientProvider>;

  public constructor(definitions: T) {
    this._provider = this.initializeProvider(definitions);
  }

  public async triggerJob(options: TriggerJobOptions<T>) {
    const provider = await this._provider;

    return provider.triggerJob(options);
  }

  public getApiHandler() {
    return async (context: HonoContext) => {
      const provider = await this._provider;

      return provider.getApiHandler()(context);
    };
  }

  /**
   * Start the cron scheduler for any registered cron jobs.
   *
   * Call this once at application startup after the instance is ready to
   * process requests. No-op for providers that handle cron externally
   * (e.g. Inngest).
   *
   * A provider-initialization failure here must not be swallowed: this fork
   * relies on cron sweeps (e.g. the seal-document and directory-sync sweeps)
   * to correct state, so a server silently running without them is worse
   * than one that fails to start. Callers intentionally leave the returned
   * promise unawaited, so a rejection surfaces as an unhandled rejection and
   * crashes the process.
   */
  public startCron(): Promise<void> {
    return this._provider
      .then((provider) => {
        provider.startCron();
      })
      .catch((error: unknown) => {
        console.error('[jobs] cron startup failed', error);
        throw error;
      });
  }

  private async initializeProvider(definitions: T): Promise<JobClientProvider> {
    const providerName = env('NEXT_PRIVATE_JOBS_PROVIDER');
    let provider: JobClientProvider;

    if (providerName === 'inngest') {
      const { InngestJobProvider } = await import('./inngest');

      provider = InngestJobProvider.getInstance();
    } else if (providerName === 'bullmq') {
      const { BullMQJobProvider } = await import('./bullmq');

      provider = BullMQJobProvider.getInstance();
    } else {
      provider = LocalJobProvider.getInstance();
    }

    definitions.forEach((definition) => {
      provider.defineJob(definition);
    });

    return provider;
  }
}
