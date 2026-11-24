---
title: The contract surface
description: What an overlay module, an installed package or an integration may depend on, how each part of it may change, and how a deprecation reaches you a release before a removal.
---

# The contract surface

An overlay module, an installed package or an integration compiles against the platform's
packages. The **contract surface** is the part of them it may depend on: the published ports, the
hookable actions and their data, the manifest extension fields and the extensible host tables. This
page says how each part of it may change between releases, so that you can tell what an upgrade
can break and how much warning you get.

The platform is in its `0.x` series, and caret ranges do not protect you there: every minor release
may break a consumer. The guarantee on this page is therefore not semantic versioning. It is a
release of warning.

## The rule

> A **stable** entry is removed or changed incompatibly only in a release **after** one that
> shipped it `@deprecated`. A **frozen** entry does not change. An **additive-only** entry only
> grows.

So a method you call today can disappear, but not without one release in which your build already
warned you about it.

## Tiers

| Tier | May change | How a removal happens |
| --- | --- | --- |
| **frozen** | never | not at all; a replacement is a new entry beside it |
| **stable** | compatibly at any time; incompatibly only in a release after one that shipped the entry `@deprecated` | deprecated in release N, removed in N+1 or later |
| **additive-only** | only by compatible additions | never; a breaking successor gets a new versioned name (`.v2`) and the old one is kept |

## What "compatible" means

It depends on which way the value travels between you and the platform:

| Direction | You… | Compatible when |
| --- | --- | --- |
| read | read the value | fields are added, never removed or narrowed |
| write | supply the value | accepted values widen, and new fields are optional |
| call | call the method | it accepts what it accepted before and returns no more than it did — so it may gain an **optional** parameter, never a required one |
| identity | name the literal | the literal is unchanged |

## What is on the surface

| Kind | Where you find it | Tier | Direction |
| --- | --- | --- | --- |
| Port container name | the `Container name:` line in a port's doc block in `@endora-commerce/contracts` or a module's `./ports` subpath | frozen | identity |
| Port method | each method of such a port | stable | call |
| Hookable action id | the `HookableActionRef` constants in `@endora-commerce/contracts` | frozen (`action`, `objectType`); additive-only (`phases`) | identity / write |
| Hook data and outbox data | the type arguments of `HookableActionRef` | additive-only | read |
| Manifest extension fields | `hookableActions`, `schemaExtensions` and the fields later releases add to the manifest schema | stable | write |
| Extensible host table | `CUSTOM_FIELD_HOST_BINDINGS` (`table`, `valueColumn`, `ownerModuleId`) and the host's primary key | frozen | identity |

Kinds announced for later releases — side-table `extends` declarations, policy points, and
command-middleware `meta` and `outcome` — join this table with the release that ships them.

**Not on the surface**: domain event payloads, which have their own rule (a new field is added, a
removal is a new `.vN` event); the HTTP API, versioned on its own; the platform package's barrels;
and admin-kit components, which no server-side code reaches.

## How a deprecation reaches you

A deprecated entry carries one of two tags in its doc block:

```text
@deprecated since 0.113.0; use {@link OrganizationCommandPort.create} instead.
@deprecated since 0.113.0; no replacement: <reason>.
```

The version is the release the deprecation shipped in. Your editor strikes the symbol through, the
instance overlay build reports every use as a warning, and the changeset in the release notes names
the old call and the new one. The removal comes in a later release, never in the same one.

## Breaks that cannot wait

A security fix or a forced dependency change can occasionally break an entry without a deprecation
release. That happens only by a recorded owner ruling, and **always with an upgrade note**: the
[upgrade notes](../upgrading-an-instance.md) for that release have a section naming the entry, the
ruling and what your instance must do. Read the upgrade notes before every upgrade; that section is
where such a break is announced.

## For module authors

- **A write port is the port of its aggregate.** Extend the aggregate's `<aggregate>CommandPort`
  rather than publishing a port shaped by one request; each method runs the same audited Command as
  the admin route for that operation. See [the kernel guide](./kernel.md).
- **Deprecate before you remove**, in the grammar above, and say in the changeset what the consumer
  calls instead.
- **An automatic comparison is planned.** A later release adds a check that compares the surface
  with the previous release tag and refuses an undeprecated removal. Until it lands, the rule on this
  page is kept by review.
