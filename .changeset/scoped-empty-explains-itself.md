---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/mod-i18n': patch
---

A listing that a viewer's organization scope emptied now says so.

`@endora-commerce/contracts` adds `SCOPE_NOTICE_CODES`, `scopeNoticeCodeSchema`,
`ScopeNoticeCode`, `scopeNoticeMetaSchema`, `ScopeNoticeEnvelope` and `scopeNoticeOf`.
The last is the reader both sides share: `meta.scopeNotice` on any successful response,
absent when there is nothing to say.

```ts
import { scopeNoticeOf } from '@endora-commerce/contracts';

const res = await apiClient.get<ListResult>('/api/v1/admin/comparisons');
const notice = scopeNoticeOf(res); // 'ORGANIZATION_ATTRIBUTION_PENDING' | null
```

`@endora-commerce/platform` adds `TenantScopeNotices` and
`noteOrganizationAttributionRefusal` to `./tenancy`, an optional `notices` field on
`TenantContext`, and a `preSerialization` hook inside `registerRequestScopeHook` that puts
the code on the envelope. **This changes what every route registered behind that hook
answers**: a successful object body gains `meta.scopeNotice` when the `customerAccount`
filter refused a whole table during that request. Error bodies, arrays, buffers and string
bodies are untouched, and a viewer whose reach is not restricted never sees the key,
because only an `allowed-set` context carries a sink for the filter to write to.

Nothing to do to adopt it: no route sets a flag, and the notice stops being emitted for a
table on the day that table gains an `organization_id`, because the same filter arm starts
granting instead of refusing.

`@endora-commerce/mod-i18n` adds the two operator-facing sentences to the `core` bundle in
`en` and `pl`: `scopeNotice.organizationAttributionPending.title` and `.body`.
