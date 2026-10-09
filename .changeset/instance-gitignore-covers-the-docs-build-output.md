---
'@endora-commerce/cli': patch
---

The `.gitignore` that `endora new` writes into an instance ignores the build output of the
instance's documentation site. Building the site writes `docs/build/` and `docs/.docusaurus/`, and
neither was ignored, so an instance that had built its docs and then ran `pnpm run upgrade` saw a
diff of well over a hundred regenerated files instead of the `package.json` per member and the
lockfile that `docs/docs/upgrading-an-instance.md` promises.

An instance that already exists keeps the `.gitignore` it was created with. Add these two lines to
it by hand:

```
docs/build/
docs/.docusaurus/
```

If either directory is already committed, also run `git rm -r --cached docs/build docs/.docusaurus`
once: git never ignores a file it tracks.
