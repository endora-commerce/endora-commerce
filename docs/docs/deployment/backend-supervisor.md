---
title: Backend process supervisor
sidebar_label: Backend supervisor
description: How the backend image restarts an API that is alive but no longer answering, how it stops cleanly, and the variables that tune it.
---

# Backend process supervisor

The backend image does not run the API directly. Its command is a small supervising process,
`backend/scripts/supervise.mjs`, which starts `dist/index.js` as its child and watches it. It is
the same supervisor the storefront image runs — see
[Storefront process supervisor](./storefront-supervisor.md) — with the backend's own address,
port, variables and stop timeout.

## Why it exists

Docker's `restart: unless-stopped` restarts a container whose main process has **exited**. It
does nothing for a container that is only `unhealthy`. A backend whose process is alive but no
longer answering — its event loop blocked, or every request stuck — is marked `unhealthy` and
stays down until somebody notices. In the default `BACKEND_ROLE=all` the queue consumers run in
the same process, so a hung API also stops every background job.

The server cannot watch itself: a timer in a blocked process never fires, and a process that is
PID 1 of its container cannot kill itself with `SIGKILL`. A separate parent process has its own
event loop and can always kill a child.

## What it does

1. Starts `dist/index.js` as a child process. The API's output goes to the container log as
   before.
2. After the start grace, sends an HTTP `GET` to `/api/v1/_health` at a fixed interval, one probe
   at a time.
3. Treats **any HTTP response** as an answer, whatever its status. The health route answers `503`
   when the database, Redis or Meilisearch is down; that means the API is alive, and a restart
   would not bring the dependency back. Only a refused connection, a reset, or no response within
   the timeout counts as a failure.
4. After the configured number of **consecutive** failures, sends `SIGTERM` to the API, then
   `SIGKILL` if it is still running after the kill grace, and exits with code `1`. The restart
   policy then starts a fresh container.
5. Forwards `SIGTERM`, `SIGINT` and `SIGHUP` to the API and exits with the API's own exit code,
   so `docker stop` behaves as before. No probe runs during a shutdown.

Every decision is logged as one line starting with `backend-supervisor:`, for example:

```text
backend-supervisor: probe failed (3/3): no answer within 5000 ms
backend-supervisor: the server did not answer 3 consecutive probes of http://127.0.0.1:3001/api/v1/_health; sending SIGTERM
backend-supervisor: the server was ended by SIGKILL after it stopped answering; exiting with 1
```

Successful probes are not logged, except for the first one and the first one after a failure.

## Stopping cleanly

On `SIGTERM` the backend closes its HTTP server and lets the queue consumers finish the jobs they
are running. The supervisor waits up to **25 seconds** for that before it sends `SIGKILL`, and
gives up 5 seconds after that. Docker's own stop timeout is 10 seconds unless the service says
otherwise, so the shipped compose examples set `stop_grace_period: 30s` on the backend service. If
you raise `BACKEND_SUPERVISOR_KILL_GRACE_SECONDS`, raise `stop_grace_period` to at least that
value plus 5 seconds, or Docker kills the container before the drain ends.

## Configuration

Every variable is optional; the defaults need no configuration. Set them in the `environment`
block of the `backend` service. A value the supervisor cannot read stops the container at start
with a message that names the variable — it is never guessed.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKEND_SUPERVISOR_PROBE` | `on` | `off` (or `false`, `0`, `no`) switches the probe off. The supervisor still forwards signals and the exit code. |
| `BACKEND_SUPERVISOR_PROBE_URL` | `http://127.0.0.1:${PORT}/api/v1/_health` | The address probed. Must be an absolute `http` or `https` URL. |
| `BACKEND_SUPERVISOR_INTERVAL_SECONDS` | `10` | Pause between the end of one probe and the start of the next. |
| `BACKEND_SUPERVISOR_TIMEOUT_SECONDS` | `5` | How long one probe waits for a response. |
| `BACKEND_SUPERVISOR_FAILURES` | `3` | Consecutive failures that end the API. Any answer resets the count. |
| `BACKEND_SUPERVISOR_START_GRACE_SECONDS` | `30` | Failures in this window after start are not counted. The window also ends at the first answer. |
| `BACKEND_SUPERVISOR_KILL_GRACE_SECONDS` | `25` | How long after `SIGTERM` the API is killed with `SIGKILL`. Keep it at least 5 seconds below the service's `stop_grace_period`. |

Fractional seconds are accepted. `PORT` is the same variable the API listens on (`3001` in the
image).

### What the probe does not cover

`/api/v1/_health` checks the database without a timeout of its own. A database that accepts the
connection but does not answer a query for longer than the probe timeout therefore reads as a
hung API, and three such probes in a row restart the backend. If that happens on your host,
raise `BACKEND_SUPERVISOR_TIMEOUT_SECONDS` rather than switching the probe off.

### How long recovery takes

With the defaults, an API that stops answering is ended within about
`FAILURES × (INTERVAL + TIMEOUT) + KILL_GRACE` = 3 × (10 + 5) + 25 = **70 seconds**, plus the
time the container takes to start again.

## Run it with an init

Without an init process the supervisor is PID 1 of the container. It handles the signals it
forwards, so `docker stop` works. What it does not do is reap processes the API leaves behind,
which an init does. The shipped compose examples therefore set `init: true` on the backend
service. For a container started by hand, use `docker run --init`.

## What is not supervised

- **The one-shot jobs.** `backend-migrate` and `backend-install` override the command with their
  own (`node dist/db/migrate.js up`, `node dist/lifecycle/scripts/install.js --all`). Their exit
  is their result, and they run without the supervisor.
- **A separate worker tier.** When the API runs with `BACKEND_ROLE=api`, the queue consumers run
  in a service of their own with `command: ['node', 'dist/worker.js']`. That process never
  listens, so a probe could only fail; it runs without the supervisor, and its restart policy
  covers it when it exits. See [Queue consumers](../operations/queue-consumers.md).
