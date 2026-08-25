import type { CustomerDeletionService } from '../services/customer-deletion-service.js';

/**
 * AnonymizationSweepWorker — repeatable job that permanently anonymizes
 * soft-deleted customer accounts once their retention window has elapsed
 * (feature 040, US7 / FR-040). Mirrors the carts abandonment-sweep pattern:
 * a thin class exposing `sweep()` so it can be driven by a scheduler or a CLI
 * entry point. Returns the number of accounts anonymized.
 */
export class AnonymizationSweepWorker {
  constructor(
    private readonly deletion: CustomerDeletionService,
    private readonly resolveRetentionDays: () => Promise<number>,
  ) {}

  async sweep(now: Date = new Date()): Promise<number> {
    const retentionDays = await this.resolveRetentionDays();
    return this.deletion.sweep(retentionDays, now);
  }
}
