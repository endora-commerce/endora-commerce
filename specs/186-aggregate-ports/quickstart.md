# Quickstart: driving a core aggregate from server code (186)

For a module or overlay author once the feature lands. The example is an ERP import placing a branch
under its head office and approving it.

## 1. Declare the edge

```ts
// packages/modules/erp_example/src/manifest.ts
dependencies: ['organizations'],
```

## 2. Resolve per use, call after your own commit

```ts
import { enterSystemScope, lazyPort, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import type { OrganizationCommandPort } from '@endora-commerce/contracts';

const organizations = lazyPort<OrganizationCommandPort>(ctx, 'organizationCommandPort');

await enterSystemScope('erp-import: branch placement', async () => {
  const branch = await organizations.setParent(branchId, { parentId: headOfficeId }, { source: 'erp_example' });
  await organizations.approve(branch.id, { source: 'erp_example', expectedVersion: branch.version });
});
```

The audit trail shows two entries, `organization.set_parent` (or `organization.move`) and
`organization.approved` — the same actions the admin records — with the `system` actor and
`source: 'erp_example'`. There is no separate "automation" actor: the source code is what tells
integrations apart (D-293.6). Command hooks on those actions run as they do for the admin.

## 3. Handle refusals by code

```ts
try {
  await organizations.approve(id, { source: 'erp_example' });
} catch (error) {
  rethrowIfModuleDisabled(error);                       // never swallow the owner-off refusal
  if (error instanceof HttpError && error.code === 'VERSION_CONFLICT') { /* re-read and retry */ }
  else throw error;
}
```

## 4. Watch for deprecations

A deprecated method reads `@deprecated since 0.113.0; use {@link …} instead.` Your editor strikes it
through, and the instance overlay build lists it (`specs/190-overlay-full-modules/`). It is removed no
earlier than the next release — except a break the owner rules urgent (D-293.7), which the upgrade note
of that release announces under its own heading, naming the call and the ruling.

## 5. Verify locally (repository maintainers)

```bash
pnpm run build:packages
pnpm --filter backend run check:port-shape
pnpm --filter backend exec tsx scripts/check-release-intent.ts --contract-base v0.112.0   # the contract comparison alone
pnpm --filter backend run check:release-intent -- --since origin/master                 # as CI runs it, comparison included
pnpm --filter backend exec vitest run test/contract/organizations/organization-command-port.test.ts
```
