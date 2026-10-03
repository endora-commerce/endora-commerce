---
title: Księga faktur
description: Wspólna blokada dostawcy, numeracja i trasowanie KSeF oraz trwała wysyłka faktur dla adapterów księgi faktur.
---

# Księga faktur

Moduł `invoice_ledger` zapewnia wspólne mechanizmy, z których korzysta każdy adapter systemu księgowego: wzajemne wykluczanie, dzięki któremu operator może mieć aktywnego tylko jednego dostawcę, ustawienia numeracji i trasowania KSeF, mapowania klientów i dokumentów, wysyłki oraz potwierdzenia webhooków.

Komunikację HTTP z dostawcą obsługują moduły adapterów poszczególnych dostawców. Ten moduł nie łączy się z żadnym dostawcą.

## Dla operatora

- **Księga faktur** w sekcji Sprzedaż otwiera listę wysyłek (dostaw). Trasowanie jest zakładką na tym samym pasku.
- Moduł adaptera dostawcy dodaje zakładkę połączenia, gdy adapter jest włączony.
- Zmiana trasowania (numeracja Endory albo dostawcy, natywny KSeF albo KSeF dostawcy) wymaga potwierdzenia przed zapisem.
- Wyłączenie adaptera dostawcy ukrywa jego zakładkę. Historia wysyłek w tym module pozostaje.
- Wyłączenie Księgi faktur na `/platform/modules` wyłącza też każdy aktywny adapter. Adapterów nie można ponownie włączyć, dopóki księga jest wyłączona. Ponowne włączenie księgi pozostawia adaptery wyłączone.

## Dla programisty

Schemat danych należy do tego modułu. Adapter dostawcy nie dostarcza własnej migracji. Identyfikatory faktur w mapowaniach i wysyłkach to UUID bez klucza obcego do modułu invoices.
