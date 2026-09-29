---
"@endora-commerce/cli": patch
---

`endora new storefront` now writes a `.gitignore` that keeps `.env` out of git.

The scaffold used to copy the reference storefront's `.gitignore` unchanged. That file was written
for a directory inside the platform repository, so it ignored neither `.env`, `.env*.local`,
`node_modules/`, `.next/` nor `*.tsbuildinfo` — while the same command writes `REVALIDATE_SECRET`,
the bearer token of the storefront's public `app/api/revalidate` route, into `.env`. In a
scaffolded storefront, which is its own repository, `git add .` committed that secret. The
rendered `.gitignore` adds those five entries and keeps every entry of the reference file.

`endora new instance`'s root `.gitignore` gains `.env*.local`, `.next/` and `*.tsbuildinfo`
beside the `.env`, `node_modules` and `dist` it already ignored.

**If you scaffolded a storefront with an earlier version**, add these lines to its `.gitignore`:

```gitignore
.env
.env*.local
node_modules/
.next/
*.tsbuildinfo
```

and, if `.env` was ever committed, remove it from the index with `git rm --cached .env` and
rotate `REVALIDATE_SECRET` (and any other value it held) in both the storefront and the backend —
removing the file does not remove it from the history.
