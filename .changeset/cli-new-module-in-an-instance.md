---
'@endora-commerce/cli': patch
---

`endora new module <id> --name … --description …` now works inside an instance. It used to stop there, naming `backend/scripts/generate-module-manifests.ts` as missing. Inside an instance it writes an overlay module — `apps/<deployment>/modules/<id>/` with `manifest.ts`, `backend.ts` and both `i18n/` bundles — which the instance composes with no build; `--depends`, `--permission`, `--activation-setting`, `--non-deactivatable` and `--dry-run` apply. The flags that ask for what an overlay module cannot be (`--entities`, `--tenant-scope`, `--admin`, `--action`, `--ports`, `--worker`, `--subscriber`, `--dir`, `--scope`) are refused with exit 1 and the reason, before anything is written. Inside a checkout of the platform repository the command writes a module package exactly as before. `runNewModule`'s result gains `overlay: { deployment } | null`.
