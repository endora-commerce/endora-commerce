---
title: Storefront process supervisor
sidebar_label: Storefront supervisor
description: How the storefront image restarts a server that is alive but no longer answering, and the variables that tune it.
---

# Storefront process supervisor

The storefront image does not run the Next.js server directly. Its command is a small supervising
process, `storefront/scripts/supervise.mjs`, which starts the server as its child and watches it.
This page explains why, what it does, and how to tune or switch it off.

## Why it exists

Docker's `restart: unless-stopped` restarts a container whose main process has **exited**. It
does nothing for a container that is only `unhealthy`. A storefront whose process is alive but no
longer answering — its event loop blocked, or every request stuck — is marked `unhealthy` and
stays down until somebody notices.

The server cannot watch itself: a timer in a blocked process never fires, and a process that is
PID 1 of its container cannot kill itself with `SIGKILL`. A separate parent process has its own
event loop and can always kill a child.

## What it does

1. Starts `storefront/server.js` as a child process. The server's output goes to the container log
   as before.
2. After the start grace, sends an HTTP `GET` to the probe address at a fixed interval, one probe
   at a time.
3. Treats **any HTTP response** as an answer, whatever its status. A `503` because the backend is
   down, or a `500` from a defect, means the process is alive, and a restart would fix neither.
   Only a refused connection, a reset, or no response within the timeout counts as a failure.
4. After the configured number of **consecutive** failures, sends `SIGTERM` to the server, then
   `SIGKILL` if it is still running after the kill grace, and exits with code `1`. The restart
   policy then starts a fresh container.
5. Forwards `SIGTERM`, `SIGINT` and `SIGHUP` to the server and exits with the server's own exit
   code, so `docker stop` behaves as before. A server that does not stop within the kill grace is
   killed. No probe runs during a shutdown.

Every decision is logged as one line starting with `storefront-supervisor:`, for example:

```text
storefront-supervisor: probe failed (3/3): no answer within 5000 ms
storefront-supervisor: the server did not answer 3 consecutive probes of http://127.0.0.1:3000/robots.txt; sending SIGTERM
storefront-supervisor: the server was ended by SIGKILL after it stopped answering; exiting with 1
```

Successful probes are not logged, except for the first one and the first one after a failure.

## Configuration

Every variable is optional; the defaults need no configuration. Set them in the `environment`
block of the `storefront` service. A value the supervisor cannot read stops the container at
start with a message that names the variable — it is never guessed.

| Variable | Default | Meaning |
| --- | --- | --- |
| `STOREFRONT_SUPERVISOR_PROBE` | `on` | `off` (or `false`, `0`, `no`) switches the probe off. The supervisor still forwards signals and the exit code. |
| `STOREFRONT_SUPERVISOR_PROBE_URL` | `http://127.0.0.1:${PORT}/robots.txt` | The address probed. Must be an absolute `http` or `https` URL. |
| `STOREFRONT_SUPERVISOR_INTERVAL_SECONDS` | `10` | Pause between the end of one probe and the start of the next. |
| `STOREFRONT_SUPERVISOR_TIMEOUT_SECONDS` | `5` | How long one probe waits for a response. |
| `STOREFRONT_SUPERVISOR_FAILURES` | `3` | Consecutive failures that end the server. Any answer resets the count. |
| `STOREFRONT_SUPERVISOR_START_GRACE_SECONDS` | `30` | Failures in this window after start are not counted. The window also ends at the first answer. |
| `STOREFRONT_SUPERVISOR_KILL_GRACE_SECONDS` | `5` | How long after `SIGTERM` the server is killed with `SIGKILL`. Keep it below Docker's stop timeout (10 seconds by default). |

Fractional seconds are accepted. `PORT` is the same variable the server listens on.

### Why `/robots.txt`

It is a route every storefront serves and it is rendered per request, so it exercises the running
server. Its only backend read is bounded by a timeout and cached, so a slow backend does not look
like a hung storefront. The compose healthcheck still asks `/` and is what `docker ps` reports as
the health state; the supervisor does not read it.

If your storefront no longer serves `/robots.txt`, or binds a specific interface through
`HOSTNAME`, set `STOREFRONT_SUPERVISOR_PROBE_URL` to an address the server answers inside the
container.

### How long recovery takes

With the defaults, a server that stops answering is ended within about
`FAILURES × (INTERVAL + TIMEOUT) + KILL_GRACE` = 3 × (10 + 5) + 5 = **50 seconds**, plus the time
the container takes to start again.

## Run it with an init

Without an init process the supervisor is PID 1 of the container. It handles the signals it
forwards, so `docker stop` works. What it does not do is reap processes the server leaves behind,
which an init does. The shipped compose examples therefore set `init: true` on the storefront
service. For a container started by hand, use `docker run --init`.

## Backend and admin

The backend image runs `node dist/index.js` directly and has the same weakness: a backend that is
alive but not answering is not restarted. This is tracked in [issue #596](https://github.com/endora-commerce/endora-commerce/issues/596). The admin image is
static files served by nginx, whose master process restarts its own workers; it needs no
supervisor.
