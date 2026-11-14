# Data model: One Save for every panel on the product edit page

No database change, no migration, no entity. Everything below is client-side state in the admin
SPA, owned by `@endora-commerce/admin-kit` (`packages/admin-kit/src/save-session/`), plus one query
parameter on an existing `price_lists` endpoint (`contracts/base-prices-dry-run.md`).

## SaveSession

One per mounted host editor (the product edit page, for one product). Created by
`SaveSessionProvider`; reset when the host says so (scope switch after *Save* or *Discard*, reload
after a `409`, product change).

| Field | Type | Meaning |
| --- | --- | --- |
| `entries` | `Map<ParticipantId, ParticipantEntry>` | every registered participant, mounted or not |
| `dirtyCount` | number (derived) | sum of `changeCount` over dirty entries, plus the host's own count passed in |
| `saving` | boolean | a `runSave` is in flight |
| `lastOutcome` | `SaveOutcome \| null` | the last Save's result, cleared by the next edit |
| `notices` | string[] | discarded-change notices (module switched off, contribution crashed) |

## ParticipantEntry

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `` `${moduleId}:${localKey}` `` | identity; `moduleId` from the contribution (R8), never declared |
| `module` | string | the contributing module, used for the presence re-check |
| `zone` | `AdminZoneName` | where it rendered; the host maps it to a tab for summary links |
| `order` | number | position in zone order (weight, then module id) at registration |
| `label` | string | translated part name, e.g. "Base prices" |
| `writable` | boolean | the participant may write; false → never dirty |
| `baseline` | `D` (participant-defined) | last saved state |
| `draft` | `D` | current edits |
| `changeCount` | number | `handlers.changeCount(draft, baseline)`; 0 = clean |
| `mounted` | boolean | the panel is rendered now |
| `status` | `clean \| dirty \| invalid \| saving \| failed` | see transitions |
| `issues` | `Record<fieldKey, string>` | translated messages from the last validate or failed save |
| `error` | string \| null | the part-level message of the last failure |
| `handlers` | `{ changeCount, validate, save }` | registered by the hook; pure of component state |

### Transitions

```text
clean ──edit──▶ dirty ──validate refuses──▶ invalid ──edit──▶ dirty
dirty ──runSave writes──▶ saving ──ok──▶ clean (baseline := returned state)
                                 └─fail──▶ failed ──edit or Save again──▶ dirty/saving
any ──discard──▶ clean (draft := baseline)
any ──module no longer visible / boundary crash──▶ removed (+ notice if it was not clean)
clean & unmounted ──▶ removed
```

## SaveOutcome

| Field | Type | Meaning |
| --- | --- | --- |
| `result` | `saved \| refused \| partial \| failed` | `refused`: validation stopped it, nothing written; `failed`: the blocking host part failed, nothing written; `partial`: at least one part written and one not |
| `parts` | `Array<{ id, label, result: 'saved' \| 'refused' \| 'failed' \| 'not-attempted', message?: string, count: number }>` | per part, in write order |

The host's own write appears as a part with id `host` and the label "Product fields".
