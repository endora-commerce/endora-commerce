---
'@endora-commerce/admin-kit': minor
---

A new component, `KanbanBoard`, and **a new peer dependency an application must provide:
`@dnd-kit/core` `^6.3.1`**.

**The peer.** `@endora-commerce/admin-kit` now declares `@dnd-kit/core` in `peerDependencies`,
the way it declares `echarts`. An application that embeds the kit and installs with a package
manager that adds missing peers by itself (pnpm with `auto-install-peers`, its default; npm 7
and later) needs to do nothing. One that does not — or that wants the version under its own
control — adds `"@dnd-kit/core": "^6.3.1"` to its own `dependencies`. It is MIT-licensed and
brings `@dnd-kit/accessibility`, `@dnd-kit/utilities` and `tslib` with it. A module package
that uses the board imports it from the kit and declares nothing for it.

**`KanbanBoard`**, exported from `@endora-commerce/admin-kit/components` with the types
`KanbanBoardProps`, `KanbanBoardLabels`, `KanbanColumnRenderState`, `KanbanCardRenderState`,
`KanbanColumnState` and `KanbanDropState`. A board of lanes whose cards move between lanes by
dragging — with a mouse, with a finger (press and hold) or from the keyboard (each card has a
handle: Space lifts, the left and right arrows choose a lane, Space drops, Escape cancels).

It is generic and knows no domain: the lanes (`columns`, `getColumnId`), the cards
(`itemsByColumn`, `getItemId`) and everything drawn (`renderCard`, `renderColumnHeader`,
optional `renderColumnFooter`) are the caller's.

- `onMove(itemId, fromColumnId, toColumnId)` is called once when a card is dropped on another
  lane that accepts it. Return a promise and the move is optimistic: the card is shown in the
  new lane while the promise is pending and goes back if it rejects.
- `canDrop(item, toColumnId, fromColumnId)` says which lanes accept the lifted card. Lanes
  that refuse are marked while it is lifted, and a drop on one calls nothing.
- `getColumnState` with `renderColumnLoading`, `renderColumnError` and `renderColumnEmpty` give
  each lane its loading, error and empty content.
- `labels` carries every string the board names something with or announces to a screen
  reader. The kit ships none of them: the sentences name the caller's items and lanes, so the
  caller translates them.
- `disabled` renders a read-only board.

Links, buttons and form controls inside a card never start a drag, and neither does anything
marked `data-kanban-no-drag`. **A consumer owes one thing the component cannot supply**: a way
to move a card with a single pointer and without dragging — a "Move to…" menu in `renderCard`
— because WCAG 2.2 SC 2.5.7 requires it and only the caller knows what the target lanes mean.
Cards have no order inside a lane; a drop reports the lane, not a position.

**Size and scrolling.** Lanes share the board's width down to 256 px each and then the board
scrolls sideways. The board bounds no height itself: give it one through `className` (for
example a `max-h-…` class) and every lane takes it — a lane's cards then scroll inside the
lane, under its header, and the board's own scroll bar stays in view. The drag handle is a
28 px picture with a 44 px hit area.
