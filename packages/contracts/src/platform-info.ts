import { z } from 'zod';

/**
 * `GET /api/v1/admin/platform-info` — which Endora Commerce release answers.
 *
 * The number is the version of the `@endora-commerce/platform` package the
 * serving process loaded, which under lockstep releases is the release the
 * instance runs. It is deliberately **not** the host application's own
 * `package.json` version: an instance's manifest says `0.0.0` from the day it is
 * scaffolded and nobody bumps it.
 *
 * `null` means the platform could not read a release number for itself. A
 * consumer renders nothing then — a placeholder that looks like a version is
 * worse than no version.
 */
export const PlatformInfoSchema = z.object({
  version: z.string().min(1).nullable(),
});
export type PlatformInfo = z.infer<typeof PlatformInfoSchema>;
