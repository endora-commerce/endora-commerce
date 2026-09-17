---
title: Admin usage
sidebar_position: 2
---

# Admin usage — Sales Channels

Jak administrator platformy obsługuje moduł Sales Channels z poziomu Admin UI na co dzień. Każda akcja poniżej jest też dostępna przez kontrakt HTTP udokumentowany w `specs/005-sales-channels/contracts/sales-channels-005.contract.md`.

## Lokalizacja obszaru

Sidebar → **Operations → Sales channels**.

Strona listy pokazuje każdy kanał zarejestrowany na platformie. Kanał system default jest oznaczony odznaką `System default` i jest zawsze obecny (świeżo zainstalowana platforma automatycznie dostaje kanał `default` przy pierwszym bootcie).

## Tworzenie nowego kanału

1. Kliknij **+ New channel**.
2. Wypełnij:
   - **Code** — lowercase machine-friendly identifier; immutable after creation.
   - **Display name** — obecnie pojedynczy string `en-US`; wsparcie wielu locale to follow-up.
   - **Theme code** *(optional)* — opaque identifier the storefront uses to pick its theme.
   - **Languages** — rozdzielone przecinkiem lub nową linią. Kody muszą już istnieć w rejestrze języków modułu i18n.
   - **Default language** — musi być jednym z języków powyżej.
   - **Currencies** / **Default currency** — ten sam kształt; kody muszą istnieć w rejestrze walut.
   - **Active** *(default `true`)*.
3. **Create channel.** System odmawia, gdy code jest już używany albo gdy którykolwiek kod języka / waluty jest nieznany.

## Edycja istniejącego kanału

1. Kliknij `code` kanału na liście.
2. Strona edycji ładuje jego tożsamość. Wprowadź zmiany; kliknij **Save changes**.
3. Gdy inny administrator zmienił ten sam kanał między twoim załadowaniem a zapisem, zapis zwraca baner konfliktu 412 z bieżącą wersją. Odśwież stronę, aby pobrać najnowszy stan i ponownie zastosować swoje zmiany.

## Deaktywacja kanału

Użyj przycisku **Deactivate** na stronie szczegółów kanału. Deaktywacja jest idempotentna i odwracalna:

- Kanał znika z listy akceptowanych resolvera (requesty storefront / POS wskazujące na niego są odrzucane z `INACTIVE_SALES_CHANNEL`).
- Jest ukryty w pickerze „Add to channel" na każdej stronie edycji encji.
- Istniejące członkostwa i historyczne Orders / Quotes nadal się do niego odnoszą.

Kanału system default nie można deaktywować.

## Hard-delete kanału

Przycisk **Delete** jest destrukcyjny. Platforma odmawia operacji, gdy:

- Kanał jest system default.
- Jakikolwiek Order lub Quote odnosi się do kanału — te atrybucje są niemutowalne, więc jedyny sposób „uwolnienia" kanału to pozostawienie go (deaktywacja to właściwa odpowiedź).
- Usunięcie kanału zostawiłoby jedną lub więcej encji (Products, Customers, …) powiązanych z **zerem** kanałów — *chyba że* potwierdzisz prompt rebind-to-Default, wtedy te encje są ponownie wiązane z system default w tej samej transakcji, zanim wiersz kanału zostanie usunięty.

`ON DELETE CASCADE` tabel mostu usuwa każdy pozostały wiersz członkostwa.

## Zarządzanie członkostwem ze strony encji

Każda strona edycji encji wspierająca członkostwo kanału (na start Products; pozostałe 8 typów to mechaniczny follow-up) pokazuje kartę **Sales channels** na dole:

- Lista pokazuje kanały, w których encja jest obecnie, z odznaką `System default` tam, gdzie to stosowne.
- Picker listuje kanały, w których encja **nie** jest jeszcze. Wybierz jeden i kliknij **Add**.
- **Remove** uruchamia inwariant FR-008 — gdy encja ma tylko jeden kanał i potwierdzisz prompt rebind-to-Default, system wiąże ją z system default przed zakończeniem usunięcia.

## Konfiguracja multi-storefront

Aby uruchomić dwa storefronty na tym samym backendzie (np. `serwisA.com` i `serwisB.com`), ustaw zmienną env `SALES_CHANNEL_HOST_MAP` na backendzie:

```env
SALES_CHANNEL_HOST_MAP=serwisA.com=channel-a,serwisB.com=channel-b
```

Każdy request storefront rozwiązuje się automatycznie do kanału hosta; nagłówek nie jest potrzebny. Każdy storefront widzi wtedy tylko produkty / klientów / ceny należące do swojego kanału.

## Czego admini nie mogą zrobić

- Przypisać Order lub Quote Request do innego kanału po utworzeniu. Atrybucja jest niemutowalna; to świadoma gwarancja audytu, nie przeoczenie.
- Usunąć kanał system default. Reconciler boot-time odtworzy go przy następnym bootcie platformy.
- Wymusić dwa kanały jako system default jednocześnie. Partial unique index blokuje to na warstwie bazy danych.
