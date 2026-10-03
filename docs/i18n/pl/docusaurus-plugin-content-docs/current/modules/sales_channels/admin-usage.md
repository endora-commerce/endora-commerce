---
title: Obsługa w panelu administracyjnym
sidebar_position: 2
---

# Obsługa kanałów sprzedaży w panelu administracyjnym

Jak administrator platformy na co dzień obsługuje moduł kanałów sprzedaży w panelu
administracyjnym. Każda opisana tu czynność jest też dostępna przez administracyjne API HTTP modułu.

## Gdzie to znaleźć

Pasek boczny → **Operations → Sales channels**.

Lista pokazuje wszystkie kanały zarejestrowane w platformie. Domyślny kanał systemowy jest oznaczony
etykietą `System default` i zawsze istnieje (świeżo zainstalowana platforma przy pierwszym starcie
automatycznie dostaje kanał `default`).

## Tworzenie nowego kanału

1. Kliknij **+ New channel**.
2. Wypełnij pola:
   - **Code** — identyfikator techniczny małymi literami; po utworzeniu nie można go zmienić.
   - **Display name** — obecnie jeden tekst w `en-US`; obsługa wielu języków zostanie dodana
     później.
   - **Theme code** *(opcjonalne)* — identyfikator, na podstawie którego storefront wybiera motyw.
   - **Languages** — rozdzielone przecinkami albo w osobnych wierszach. Kody muszą już istnieć w
     rejestrze języków modułu i18n.
   - **Default language** — musi być jednym z powyższych języków.
   - **Currencies** / **Default currency** — tak samo; kody muszą istnieć w rejestrze walut.
   - **Active** *(domyślnie `true`)*.
3. Kliknij **Create channel**. System odrzuci operację, gdy kod jest już używany albo którykolwiek kod
   języka lub waluty jest nieznany.

## Edycja istniejącego kanału

1. Kliknij `code` kanału na liście.
2. Strona edycji wczytuje dane kanału. Wprowadź zmiany i kliknij **Save changes**.
3. Jeśli inny administrator zmienił ten sam kanał między wczytaniem strony a zapisem, zapis zwróci
   baner konfliktu 412 z bieżącą wersją. Odśwież stronę, aby pobrać aktualny stan, i ponownie
   wprowadź swoje zmiany.

## Dezaktywacja kanału

Użyj przycisku **Deactivate** na stronie szczegółów kanału. Dezaktywacja jest idempotentna i
odwracalna:

- Kanał przestaje być akceptowany przy wyznaczaniu kanału żądania (żądania ze storefrontu lub POS
  wskazujące ten kanał są odrzucane z `INACTIVE_SALES_CHANNEL`).
- Kanał znika z listy „Add to channel” na każdej stronie edycji encji.
- Istniejące przypisania oraz historyczne zamówienia i oferty nadal się do niego odwołują.

Domyślnego kanału systemowego nie można dezaktywować.

## Trwałe usunięcie kanału

Przycisk **Delete** usuwa dane. Platforma odrzuca tę operację, gdy:

- kanał jest domyślnym kanałem systemowym;
- do kanału odwołuje się jakiekolwiek zamówienie lub oferta — tych przypisań nie można zmienić, więc
  jedynym sposobem na „uwolnienie” kanału jest pozostawienie go (właściwą odpowiedzią jest
  dezaktywacja);
- usunięcie kanału zostawiłoby jedną lub więcej encji (produktów, klientów…) przypisanych do **zera**
  kanałów — *chyba że* potwierdzisz przepisanie ich do kanału domyślnego; wtedy w tej samej
  transakcji, zanim wiersz kanału zostanie usunięty, encje są przypisywane do domyślnego kanału
  systemowego.

`ON DELETE CASCADE` tabel łączących usuwa wszystkie pozostałe wiersze przypisań.

## Zarządzanie przypisaniami ze strony encji

Każda strona edycji encji obsługująca przypisania do kanałów (na początek produkty; pozostałe 8 typów
to mechaniczna praca do wykonania później) ma na dole kartę **Sales channels**:

- Lista pokazuje kanały, do których encja jest obecnie przypisana, z etykietą `System default` tam,
  gdzie to potrzebne.
- Lista wyboru pokazuje kanały, do których encja **nie** jest jeszcze przypisana. Wybierz jeden i
  kliknij **Add**.
- **Remove** uruchamia regułę „co najmniej jeden kanał” — gdy encja ma tylko jeden kanał, a ty
  potwierdzisz przepisanie do kanału domyślnego, system przypisze ją do domyślnego kanału
  systemowego, zanim zakończy usuwanie.

## Kilka storefrontów

Aby uruchomić dwa storefronty na tym samym backendzie (np. `serwisA.com` i `serwisB.com`), ustaw w
backendzie zmienną środowiskową `SALES_CHANNEL_HOST_MAP`:

```env
SALES_CHANNEL_HOST_MAP=serwisA.com=channel-a,serwisB.com=channel-b
```

Każde żądanie ze storefrontu jest wtedy automatycznie przypisywane do kanału hosta; nagłówek nie jest
potrzebny. Każdy storefront widzi wyłącznie produkty, klientów i ceny należące do jego kanału.

## Czego administrator nie może zrobić

- Przypisać zamówienia ani zapytania ofertowego do innego kanału po utworzeniu. Tego przypisania nie
  można zmienić; to świadoma gwarancja na potrzeby audytu, a nie przeoczenie.
- Usunąć domyślnego kanału systemowego. Mechanizm uzgadniania przy starcie odtworzy go przy
  następnym uruchomieniu platformy.
- Ustawić dwóch kanałów jednocześnie jako domyślnych. Blokuje to częściowy indeks unikalny w bazie
  danych.
