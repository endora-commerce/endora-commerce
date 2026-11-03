import { z } from 'zod';
import { uuidSchema } from '@endora-commerce/contracts';

/**
 * Feature 170 (owner decision 2026-11-03) — one channel an import profile mapping row may target:
 * `GET /api/v1/admin/import-export/channel-targets`, gated `catalog:write`.
 *
 * Module-local until the contracts package carries it: `packages/contracts/` is stream S1's, so
 * the schema is handed to S1 to add to `import-export.ts` as `importChannelTargetSchema` /
 * `importChannelTargetListResponseSchema`, after which this file re-exports those and goes.
 */
export const importChannelTargetSchema = z
  .object({
    id: uuidSchema,
    code: z.string().min(1).max(32),
    languages: z.array(z.string().min(2).max(16)).min(1),
  })
  .strict();
export type ImportChannelTarget = z.infer<typeof importChannelTargetSchema>;

export const importChannelTargetListResponseSchema = z.object({ data: z.array(importChannelTargetSchema) });
export type ImportChannelTargetListResponse = z.infer<typeof importChannelTargetListResponseSchema>;
