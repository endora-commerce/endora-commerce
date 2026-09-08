---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/mod-organizations': major
---

Published `OrganizationTaxProfilePort`, and moved the error envelope's assembly into the
platform.

**`@endora-commerce/contracts` gains `OrganizationTaxProfilePort`.** It described the
`organizationTaxProfilePort` container name and was declared by
`@endora-commerce/mod-organizations/backend`, so a consumer resolving that port had to name
the provider's own package to spell the type — which is the reach a port exists to remove,
and which `@endora-commerce/platform` may not write at all. The declaration is unchanged
member for member.

```diff
-import type { OrganizationTaxProfilePort } from '@endora-commerce/mod-organizations/backend';
+import type { OrganizationTaxProfilePort } from '@endora-commerce/contracts';

 const taxProfile = lazyPort<OrganizationTaxProfilePort>(ctx, 'organizationTaxProfilePort');
```

**`@endora-commerce/mod-organizations/backend` no longer exports it**, and that is the
breaking half. A re-export was written and withdrawn: a barrel re-exporting a name whose
source is another package makes *"does this barrel carry an entity class by name"* unknown
rather than false, which D-168 may not be wrong about, and two spellings for one type is the
shape this repository removes rather than adds. Change the specifier; the type is
unchanged.

**`@endora-commerce/platform/composition` gains `composeErrorEnvelopeOptions` and loses
`createRequestLanguageResolver`.** The two callbacks a composition root passes to
`registerErrorEnvelope` — the language ladder and the translation lookup — were assembled
by each root itself, identically, in twenty lines apiece. They are one function now, and
what a root supplies is only what a root knows: its own resolved error-code routing table
and the two container names the callbacks read.

```diff
-errorEnvelope: {
-  errorTranslationTargets: routing.targets,
-  resolvePreferredLanguage: createRequestLanguageResolver({
-    adminPreferredLanguage: async (id) =>
-      (await adminUserReadPort().findById(id))?.preferredLanguage ?? null,
-  }),
-  translateErrorMessage: async ({ moduleId, key, language, originalMessage, params }) => {
-    const t = await i18n().translate(moduleId, key, language, params);
-    return t === `${moduleId}.${key}` ? originalMessage : t;
-  },
-},
+errorEnvelope: composeErrorEnvelopeOptions({
+  errorTranslationTargets: routing.targets,
+  adminUserReadPort: () => identityPorts().adminUserReadPort,
+  translate: () => cradle().adminI18nService,
+}),
```

`createRequestLanguageResolver` is off the barrel because no composition root constructs it
any more; the ladder it builds is unchanged and is now built inside the assembly. If you
called it directly, call `composeErrorEnvelopeOptions` instead. Both are on `./composition`,
which is host-internal — no module may name it — so this affects a host and never a module.
