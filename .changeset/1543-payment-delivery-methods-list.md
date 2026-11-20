---
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-i18n': patch
---

The payment-methods and delivery-methods admin screens put the list first (issue #1543, UX audit 2026-11-17, SALES-18).

- Each screen is the kit's `ListPage`. The "New / update method" form that was drawn open above the list is gone. *New method* in the header and *Edit* in a row's menu (or a click on the method's code) open the same form in a dialog. The dialog stays open on a refused save and shows the server's reason. While there is no method, the empty state carries the one *New method*.
- *Delete* is the last entry of the row menu, after a separator. It is confirmed, and a refusal (a method still referenced) is shown inside the confirmation. Focus moves to the next row afterwards.
- A save's result ("Saved {code}.") sits beside *New method*, where the dialog returns focus.
- The *Integrations* card sits under the list.
- An operator with only the `:read` permission is offered no create, edit, delete or status change. The payment-method status column shows a badge for them instead of a select.
- Delivery methods: the two shipment-status fields, the list column and the empty options are translated (EN + PL). The empty option now names the status the server actually uses for a new method (*Default (Shipment sent)* / *Default (Processing)*). The old hard-coded "(default: shipped)" / "(default: in_fulfilment)" named neither. The list shows the mapping by status name, not by code.
- `core` bundle: `legacyMethods.formTitle` removed; `legacyMethods.action.new` reads "New method"; new keys `legacyMethods.payment.newTitle`, `legacyMethods.delivery.newTitle`, `legacyMethods.rowActions`, `legacyMethods.fields.adapterDefault`, `legacyMethods.payment.statusGroup`.
