# Data model: Contributed record tabs

**No database change.** There are no new entities, no columns and no migrations. The model below is
contract data, meaning declarations and API shapes.

## RecordTabDeclaration (contracts, Zod)

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | `^[a-z][a-z0-9-]{0,31}$`. Part of `?tab=`. Stable: a rename breaks saved links. |
| `labelKey` | string | `translationKeyRe`. Resolved in the **contributing** module's bundle. |
| `countLabelKey` | string, optional | `translationKeyRe`. A template taking `{label}` and `{count}`, which must start with `{label}` (WCAG 2.5.3, as `TabItem.countLabel`). If absent, the kit's `common.tabs.counted` applies. |

## AdminZoneContribution (contracts), extended

| Field | Change |
| --- | --- |
| `tab` | **new, optional** `RecordTabDeclaration`. It is required iff `zone ∈ RECORD_TAB_ZONE_NAMES`, and forbidden otherwise (`superRefine`). |
| `count` | **new, optional, TS-only** `AdminCountFactory = () => Promise<{ readonly default: unknown }>`. It is allowed only alongside `tab`. The kit helper constrains `default` to `RecordTabCounter<Z> = (props: AdminZoneProps<Z>, signal: AbortSignal) => Promise<number>`. |

## Zone enum and props map

| Member | Props | Kind |
| --- | --- | --- |
| `opportunity.detail.tabs` | `OpportunityDetailZoneProps` (reused) | record-tab zone (listed in `RECORD_TAB_ZONE_NAMES`) |

## RecordTabZoneItem (admin-kit, TS)

`{ id: string; label: string; count: number | null; countLabel?: string; module: string }` is
what `useRecordTabZone` returns per visible, non-colliding contribution, in weight order and then
module id. `count: null` while the count is pending or has failed, and also when the contribution
declares no count loader.

## Task count API (contracts, Zod; owner `tasks`)

- `TaskCountQuerySchema` has the shape of `taskFilterShape` and the `linkedBothOrNeither`
  refinement. It has no paging, sorting or card values.
- `TaskCountResponseSchema` is `{ data: { count: z.number().int().nonnegative() } }`.

## State and lifecycle

The count lives in the hook's component state only. It is not cached across pages and not stored
in Redis (research R5). A count is (re-)read when:

1. the host mounts;
2. the zone props' identity key changes (a new `opportunityId`);
3. the set of visible contributions changes (an activation or permission flip).

Each read is aborted when the next one starts and on unmount.
