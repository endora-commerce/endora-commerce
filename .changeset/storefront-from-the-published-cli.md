---
'@endora-commerce/cli': minor
'@endora-commerce/platform': patch
'@endora-commerce/mod-admin-users': patch
---

`npx create-endora-commerce <dir>` (`endora install`) and `endora new storefront <dir>` now write the storefront **outside a checkout of the platform repository**. The CLI's build runs the same `planStorefront` over the reference storefront and ships the finished plan in `dist/storefront-reference/`; where no checkout is above the working directory the commands write that. Inside a checkout nothing changes: the storefront is still copied from the checkout.

What a consumer sees:

- `--no-storefront` is no longer needed anywhere. `endora install <dir>` writes `<dir>-storefront` beside the instance and installs it; the wizard's parts checklist shows the storefront as a toggleable, pre-checked row.
- The packaged reference leaves out the reference storefront's Playwright screenshot baselines (8.4 MB of the 10.8 MB tree) and reports that as an omission, with `pnpm exec playwright test --update-snapshots` as the way to record your own. A checkout's scaffold still copies them.
- `--registry <url>` is applied at run time to the packaged plan, through the same code a checkout's plan goes through.
- `pnpm pack` / `pnpm publish` of this package refuses a `dist` with no packaged reference (`prepack`). A build made without git or without the storefront tree — a container image — still succeeds and writes none.

`endora install` also changed in four ways:

- **Ports.** Before anything is written, it probes the host ports the development stack publishes. A default that is taken is moved to a free one (`POSTGRES_PORT=15432`, …), written into the instance's `.env`, and the derived `DATABASE_URL` / `REDIS_URL` / `MEILISEARCH_URL` / `SMTP_URL` follow it — they used to be composed from the defaults regardless, so the run died at `dev:services` or, worse, pointed at another project's Redis. A `*_PORT` you set in the target's `.env` is never moved: taken, it is a refusal with nothing written. Addresses are now derived when the target already held a `.env`, too.
- **The administrator's password is not printed.** The `[n/N]` echo, `--dry-run` and the resumable list show `--password=<password>`, and the step no longer passes the password as an argument at all: it runs `admin:create -- … --password-stdin` and writes the password to the command's standard input (`InstallStep.stdin`). As an argument it was echoed twice by pnpm and once by the operator CLI's own log.
- **The resumable list starts at the step that failed** (it started after it), and each line names its directory.
- **The closing block** names the API on the instance's own `PORT` rather than `3001`, says when that port is in use, and under `--no-services` no longer promises a mail catcher. The storefront's `NEXT_PUBLIC_API_BASE_URL` and `BACKEND_BASE_URL` use the same `PORT`.

API: `NewStorefrontResult.reference` is `StorefrontReference | null` (null when the packaged reference was written) and gains `source`; `NewStorefrontOptions` / `InstallOptions` gain `packagedReferenceDir`; `InstallOptions` gains `portInUse`; `runNewStorefront` and `storefrontDeclaredInputs` no longer throw outside a checkout when the CLI carries a reference. New exports: `resolveStorefrontSource`, `StorefrontSource`, `NoReferenceStorefrontError`, `readPackagedReference`, `ownPackagedReferenceDir`, `PackagedReference`.

`@endora-commerce/mod-admin-users`: `admin_users create` accepts `--password-stdin` in place of `--password=<p>` and reads the password from standard input. Both at once is refused; `--password=` works as before.

`@endora-commerce/platform`: the operator CLI no longer logs a credential. The reason it opens a command's system scope with (`tenant.escape_hatch`, `cli: <argv>`) was the raw argv, so `admin_users create --password=…` wrote the password into the log; the value of any `--flag=value` whose name contains `password`, `passphrase`, `secret`, `token`, `credential` or `api-key` is now `<redacted>`.
