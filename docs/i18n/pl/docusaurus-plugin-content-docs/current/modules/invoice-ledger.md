---
title: Invoice ledger
description: Wspólny mutex vendorów, numeracja i routing KSeF oraz trwałe dostawy faktur dla adapterów ledgera.
---

# Invoice ledger

Moduł `invoice_ledger` posiada wspólne szyny, z których korzysta każdy adapter księgowy: wzajemne wykluczenie, aby tylko jeden vendor był aktywny u operatora, ustawienia numeracji i routingu KSeF, mapy klientów i dokumentów, dostawy oraz potwierdzenia webhooków.

Adaptery takie jak Infakt posiadają własne HTTP. Ten moduł nie woła Infakt.

## Operatorzy

- **Invoice ledger** w Sales otwiera dostawy. Routing jest zakładką na tym samym pasku.
- Adapter vendoru (Infakt) dodaje zakładkę połączenia, gdy adapter jest włączony.
- Routing (Endora vs numeracja vendoru, natywny vs vendor KSeF) to zapis z potwierdzeniem.
- Wyłączenie Infakt ukrywa jego zakładkę. Historia dostaw w tym module pozostaje.
- Wyłączenie Invoice ledger na `/platform/modules` wyłącza też każdy aktywny adapter (Infakt). Adapterów nie można ponownie włączyć, dopóki ledger jest wyłączony. Ponowne włączenie ledgera pozostawia adaptery wyłączone.

## Dla developerów

Schemat żyje tutaj. Infakt nie dostarcza migracji. Id faktur w mapach i dostawach to UUID bez klucza obcego do modułu invoices.
