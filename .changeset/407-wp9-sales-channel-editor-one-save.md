---
'@endora-commerce/mod-sales-channels': minor
'@endora-commerce/mod-inventory': minor
---

The sales-channel editor's Save now covers the panels contributed to `sales_channel.editor.after` (issue #407, `specs/180-one-save-zone-editors/` WP-9).

**mod-sales-channels:**
- The edit screen of an existing channel runs a save session, one per channel, and passes it to `sales_channel.editor.after`. A panel that takes part in it needs no change to this screen. The create form runs none and is unchanged.
- The identity form's Save reads "Save" or "Save n changes", counting the form's own changed fields plus every panel's. It does nothing while there is nothing to save.
- Save writes the channel first, then the panels. If the channel write is refused (a version conflict, a validation error), no panel is written. If a panel fails after the channel saved, the screen reports what was saved and what was not; the next Save writes only what is left.
- Leaving the page through a link, reloading or closing the browser tab with unsaved changes now asks first; the form had no such prompt before. Cancel discards every change and returns to the list without asking, as before.
- `ChannelIdentityForm` takes three optional props for this: `participantChangeCount`, `onChangeCountChange` and `summary`. Without them it behaves as before.
- New strings in English and Polish: `channelEditor.save.hostPartLabel` and `channelEditor.save.failed`.

**mod-inventory:**
- The warehouse routing panel on the sales-channel editor stays immediate: assigning, unassigning and making a warehouse the default still apply at once. Its heading now carries an "Applies immediately" badge while those actions are offered (`warehouses.channel.immediateBadge`, English and Polish).
