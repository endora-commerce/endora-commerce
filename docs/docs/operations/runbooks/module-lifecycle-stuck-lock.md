---
title: Stuck Module-Lifecycle Lock
---

# Stuck Module-Lifecycle Lock

The module-lifecycle CLI (`pnpm module:install`, `pnpm module:uninstall`, `pnpm module:enable`, `pnpm module:disable`) serialises every state-changing operation through a single Redis key. A crashed process can leave that key (or the underlying registry row) in a state that blocks subsequent commands. This runbook covers detection and recovery.

## Symptoms

- A lifecycle command exits with code **75** and the message *"lifecycle lock is held by another process"*.
- Retrying the command (after a few minutes) keeps producing the same exit-75 error even though no other operator should be running anything.
- `pnpm module:status --json | jq '.modules[] | select(.state == "installing")'` lists one or more modules stuck in `installing`.

## Detection

```bash
# Inspect the lock directly.
redis-cli get b2b:module:lifecycle:lock
redis-cli ttl b2b:module:lifecycle:lock
```

Possible outcomes:

| Output | Diagnosis |
| --- | --- |
| `(nil)` | Lock is free. Exit-75 must come from a stale `installing` registry row — see "Stuck registry row" below. |
| Non-empty value, TTL > 0 (e.g. `283`) | Another process legitimately holds the lock. Wait for the TTL to elapse or for the holder to finish. |
| Non-empty value, TTL `-1` (no TTL) | Anomaly — the lock was set without expiry. Manual delete is safe. |
| Non-empty value, TTL > 300 seconds | Anomaly — the lease was extended past the configured ceiling. Treat as stuck. |

The configured TTL is **5 minutes**, refreshed every 60 seconds while a command runs. A value present for more than ~6 minutes indicates a crashed holder.

## Recovery — stuck Redis lock

**Prerequisite**: confirm no operator is currently running a lifecycle command.

```bash
# 1. Check active sessions on the box that runs the backend.
ps -ef | grep -E "tsx.*_lifecycle/scripts" | grep -v grep

# 2. If no live process, delete the stale key.
redis-cli del b2b:module:lifecycle:lock
```

After deleting, retry the original lifecycle command.

## Recovery — stuck `installing` registry row

A row in `module_registrations` with `state='installing'` indicates a command that started but never reached `installed` or `uninstalled`. The lifecycle commands refuse to operate on a module in this state (exit 75 with "stale `installing` record").

```bash
# Identify the offending row(s).
psql "$DATABASE_URL" -c \
  "select module_id, state, last_install_failed_at, last_install_error
   from module_registrations
   where state = 'installing';"
```

If the row's `last_install_failed_at` is recent (within minutes), give the orchestrator a chance to roll back its own transaction first — re-check after a few seconds.

If the row stays `installing` indefinitely:

```bash
# 1. Audit-log the cause if possible.
psql "$DATABASE_URL" -c \
  "select created_at, action, object_id, state_after
   from audit_log_entries
   where object_id = '<module-id>'
     and action like 'module.%'
   order by created_at desc
   limit 5;"

# 2. Either re-attempt install (the orchestrator's rollback will
#    cover the partial state on its own) ...
pnpm --filter backend run module:install <module-id>

# 3. ... OR, if the rollback never runs, manually flip the row to
#    'uninstalled' so a fresh install can take it from there.
psql "$DATABASE_URL" -c \
  "update module_registrations
      set state = 'uninstalled',
          last_state_change_at = now()
    where module_id = '<module-id>'
      and state = 'installing';"
```

Then re-run `pnpm --filter backend run module:install <module-id>`. The install path is idempotent — already-applied migrations are skipped, settings reconcile to the manifest, and the registry row flips to `installed`.

## Prevention

The orchestrator already covers the well-known crash modes (transactional install with migration revert on failure, uninstall hook errors, dependency violations). The remaining risk is process-level termination during a hook (e.g. SIGKILL, OOM). To reduce exposure:

- Run lifecycle commands on a host with at least the documented memory budget (`README.md` § Hardware & system requirements).
- Avoid running `module:install` for a module whose install hook does heavy work concurrently with other heavy operations.
- For modules with hooks longer than ~30 seconds, prefer enqueueing the heavy work as a BullMQ job rather than running it in the install hook directly.

## Escalation

If the steps above don't recover the system, capture:

- Output of `redis-cli get b2b:module:lifecycle:lock` and `redis-cli ttl b2b:module:lifecycle:lock`.
- The full `module_registrations` row for the affected module.
- The last 20 audit-log entries for that module (`object_id = '<module-id>'`).
- Backend application logs around the timestamp of the stuck command.

Open a ticket against the platform team with that bundle.
