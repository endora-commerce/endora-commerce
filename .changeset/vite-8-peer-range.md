---
'@endora-commerce/admin-shell': patch
---

`@endora-commerce/admin-shell` now accepts Vite 8 as well as Vite 7: its optional `vite` peer
dependency widens from `^7.3.7` to `^7.3.7 || ^8.0.0`. An admin application still building with
Vite 7 needs no change. To move to Vite 8, raise `vite` to `^8` in the application's own
`package.json`; keep `@vitejs/plugin-react` on `^5.2.0`, which accepts both majors. The package's
own code and exports are unchanged. Vite 8 bundles with Rolldown, so an application that sets
`build.rollupOptions` should check the Vite 8 migration guide.
