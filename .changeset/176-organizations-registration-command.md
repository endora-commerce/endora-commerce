---
'@endora-commerce/mod-organizations': patch
---

Storefront self-registration (`POST /api/v1/organizations/register`) is now one transaction
(`specs/176-command-hooks-outbox/` US1). It runs as the `organization.register` Command, and the
first account is `customer_accounts`' `customer_account.create`, run as its child through
`ctx.run`.

What this writes now commits together or not at all: the Organization, its sales-channel binding,
the first account, the registry-lookup validation row, the e-mail verification token, both audit
entries and both events (`organization.registered.v1`, `customer_account.created.v1`). Before, the
Organization committed on its own. A failure after that point, such as a racing e-mail address or
a failing token insert, left an Organization with no administrator, and the same tax ID could not
be registered again.

The request, the response, the status codes and the error codes are unchanged. That includes
`409 ORGANIZATION_TAX_ID_EXISTS` from either tax-ID scope's constraint, mapped around the Command
Bus for `per-tree-root`'s deferred one.

**Audit log, for upgraders.** The `organization.register` entry keeps its names-only state: the
status, `changedFields`, `changedCustomFields` and the registry lookup's codes. It is now written
by the Command Bus, so it carries the request id, IP address and user agent, the same request id
as the account's `customer_account.create` entry. Entries written before the upgrade are not
rewritten.

**For code that builds `RegistrationService` by hand.** The constructor now takes one options
object: `{ emFactory, commandBus, events, accounts: { read, commands }, dictionaryValidator?,
channelMembership?, registryLookup?, customFieldValues? }`. `accounts.commands` is the
`customerAccountMemberCommandPort`. It no longer takes an audit port. The module's plugin option
`customerAccountCommands` carries the port, and the module's own composition wires it.
