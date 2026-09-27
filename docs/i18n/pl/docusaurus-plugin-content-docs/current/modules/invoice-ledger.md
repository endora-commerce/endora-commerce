---
title: Invoice ledger
description: Wspólny mutex vendorów, numeracja i routing KSeF oraz trwałe dostawy faktur dla adapterów ledgera.
---

# Invoice ledger

Moduł `invoice_ledger` posiada wspólne szyny, z których korzysta każdy adapter księgowy: wzajemne wykluczenie, aby tylko jeden vendor był aktywny u operatora, ustawienia numeracji i routingu KSeF, mapy klientów i dokumentów, dostawy oraz potwierdzenia webhooków.

Moduły adapterów vendorów posiadają HTTP do swojego vendora. Ten moduł nie woła żadnego vendora.

## Operatorzy

- **Invoice ledger** w Sales otwiera dostawy. Routing jest zakładką na tym samym pasku.
- Moduł adaptera vendoru dodaje zakładkę połączenia, gdy adapter jest włączony.
- Routing (Endora vs numeracja vendoru, natywny vs vendor KSeF) to zapis z potwierdzeniem.
- Wyłączenie adaptera vendoru ukrywa jego zakładkę. Historia dostaw w tym module pozostaje.
- Wyłączenie Invoice ledger na `/platform/modules` wyłącza też każdy aktywny adapter. Adapterów nie można ponownie włączyć, dopóki ledger jest wyłączony. Ponowne włączenie ledgera pozostawia adaptery wyłączone.

## Dla developerów

Schemat żyje tutaj. Adapter vendoru nie dostarcza własnej migracji. Id faktur w mapach i dostawach to UUID bez klucza obcego do modułu invoices.
