---
'@endora-commerce/mod-customers': patch
---

Soft-deleted customer accounts are now anonymized once `customers.deletion_retention_days` has elapsed (issue #677). `AnonymizationSweepWorker.sweep()` had no caller, so a deleted account kept its personal data indefinitely and `customer_account.anonymized.v1` was never announced. The module now installs a daily BullMQ Job Scheduler (`customers.anonymization.sweep`, idempotent across restarts and replicas) and consumes it through `ctx.worker` in processes that run workers, so no run happens while `customers` is off.

**Behaviour change on upgrade.** The first worker boot after the upgrade installs the schedule, and its first run starts immediately: every soft-deleted account already older than `customers.deletion_retention_days` (default 365) is anonymized within minutes, irreversibly. To keep any of them, raise `customers.deletion_retention_days` before upgrading, for all channels or at least the default channel, and restore them; once the window has passed, restore is refused. See *Deleted customer accounts are anonymized on schedule* in the upgrade guide, which has a query to count the accounts due.
