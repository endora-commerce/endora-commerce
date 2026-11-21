# Contract: record-tab zones

Normative for `@endora-commerce/contracts` (`src/admin-contributions.ts`) and
`@endora-commerce/admin-kit` (`./contributions`, `./zones`). Once this feature ships, the member
doc comments in `admin-contributions.ts` carry this text. This file is the design record.

## RT1 — What a record-tab zone is

A member of `AdminZoneNameSchema` that is also listed in `RECORD_TAB_ZONE_NAMES`. Its contributions
are **whole tabs** of a host's record tab strip (`RecordTabs`): one button with a label and an
optional count, plus one panel. The host draws the strip, and the contributions supply tabs.
Members are named `<host>.detail.tabs`, one per host (Z13, Z14).

## RT2 — Declaring a contribution (contributor)

```ts
import { recordTabComponent } from '@endora-commerce/admin-kit/contributions';

recordTabComponent('opportunity.detail.tabs', () => import('./zones/OpportunityTasksTab.js'), {
  tab: { id: 'tasks', labelKey: 'recordTab.label', countLabelKey: 'recordTab.countLabel' },
  count: () => import('./zones/opportunity-task-count.js'),
  weight: 100,
  requiredPermission: 'tasks:read',
});
```

- The panel's default export is `ComponentType<AdminZoneProps<Z>>`.
- The count module's default export is
  `(props: AdminZoneProps<Z>, signal: AbortSignal) => Promise<number>`.
  - It MUST call only the contributor's own API.
  - It MUST honour `signal`.
  - It MUST resolve to a non-negative integer, or reject.
- `zoneComponent()` does not accept a record-tab zone, and `recordTabComponent()` accepts nothing
  else. Both rules are compile errors.
- `AdminZoneContributionSchema` refuses `tab` on a stack zone, and its absence on a tab zone.

## RT3 — Rendering (host)

```tsx
const contributed = useRecordTabZone('opportunity.detail.tabs', { opportunityId }, {
  reservedIds: OPPORTUNITY_TABS.map((tab) => tab.id),
});
// items: host tabs ... Events, ...contributed.tabs, Notes ... (the host chooses the slot)
// body:  host tab ? <HostTab/> : contributed.renderPanel(activeTab)
```

- The zone name is a **string literal** (Z7). `check:admin-zones` reads it.
- The props object SHOULD be memoised by the host, so the count is not re-read on every render.
  The hook keys its count reads on the props' string values, so an unmemoised literal is still
  correct, only noisier for `useMemo`.
- `tabs` is synchronous. It is the output of `selectZoneContributions`, so it has passed both
  presence axes, the permission and `match`. It is then filtered for collisions:
  - an id that is in `reservedIds` is dropped;
  - a duplicate of an earlier contribution's id is dropped.
  - In development each drop logs one warning naming the module and the id.
- `renderPanel(id)` returns `null` for an id that is not in `tabs`. Otherwise it returns the
  contribution's component inside:
  - `ZoneErrorBoundary`;
  - `ZoneContributionContext`;
  - `Suspense`, whose fallback is the host's loading line, passed as an option, defaulting to
    `null`;
  - `EditorSectionChromeProvider chrome="section"`.

## RT4 — Labels and counts

- `label` is `t(module, tab.labelKey)`, where `module` is the registry entry key, never a declared
  field (D-142).
- `countLabel`, when `countLabelKey` is declared, is `t(module, countLabelKey, { label, count })`.
- `count` is `null` until the loader resolves. A count of `0` or `null` draws no badge, through the
  kit's existing `TabItem.count` rule.
- A count module is imported only for a contribution in `tabs`. A tab that is not visible
  downloads nothing (091 FR-013).

## RT5 — Address

The host owns `?tab=`. A contributed id is selectable while it is in `tabs`. Otherwise the host's
default tab is shown and the address is left alone, which is the existing rule for an unknown id.

## RT6 — `check:admin-zones`

- `useRecordTabZone('<member>', …)` is a render site.
- `recordTabComponent('<member>', …)` is a contribution site.
- A non-literal name in either is `computed-zone-name`.
- `unrendered-zone`, `missing-props-type` and `contribution-to-unrendered-zone` apply unchanged.
