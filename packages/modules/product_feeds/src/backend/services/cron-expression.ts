/**
 * Cron validation and its plain-language echo — feature 067 / FR-031, T073.
 *
 * The implementation lives in `packages/contracts/src/product-feeds.ts`, next
 * to `cronExpressionSchema` whose grammar it enforces, and is re-exported here
 * so this module keeps a module-local import path for it.
 *
 * It is in the contract layer rather than in this module because **both sides
 * need exactly these functions**: the backend refuses an out-of-range
 * expression at save time, and the admin renders the live echo under the
 * *Custom* input (ux-design §2.2). A backend-only copy plus an admin-only copy
 * is two implementations of one grammar, and they would drift the first time
 * anyone touched either.
 *
 * ## What none of it does
 *
 * It does not evaluate cron. There is **no `cron-parser` import**: that package
 * is a transitive dependency of BullMQ and is not resolvable from `backend/`
 * under pnpm (`MODULE_NOT_FOUND`), and importing another package's transitive
 * dependency is not a dependency we are allowed to take (Principle IV).
 * Hand-rolling next-occurrence arithmetic is worse still — it is exactly the
 * sixty lines that have to be right about `Europe/Warsaw` in late March, and
 * BullMQ already owns that code path.
 *
 * So the split is: **the contract validates the grammar and renders the
 * sentence**; **BullMQ computes when it fires**, and `nextRunAt` is read back
 * from `queue.getJobSchedulers()` (research §R5, §R5.5).
 */

export {
  SCHEDULE_PRESETS,
  describeCronExpression,
  isValidCronExpression,
  isValidTimezone,
  presetForCron,
  type SchedulePreset,
} from '@endora-commerce/contracts';
