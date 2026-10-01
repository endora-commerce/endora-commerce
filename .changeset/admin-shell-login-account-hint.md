---
"@endora-commerce/admin-shell": patch
---

The sign-in screen's "No account yet?" hint no longer tells the reader to run `pnpm --filter backend run admin:create` from the repository root — a command only a checkout of the Endora Commerce repository has. It now reads "Ask your platform administrator, or create one from the command line: see the Getting started guide", linking to the guide's new *Creating an administrator* section, which spells the command for an instance, a production image and a repository checkout. The `loginCopy.footerPrefix` and `loginCopy.footerSuffix` keys are replaced by `loginCopy.noAccount` and `loginCopy.noAccountLink`, and `ADMIN_ACCOUNT_HELP_URL` is new beside them; none of the three is exported from the package's entry point.
