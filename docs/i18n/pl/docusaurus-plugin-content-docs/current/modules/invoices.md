---
title: invoices
description: Generowanie faktur PDF / proform + powiązanie z zasobami
---

# `invoices`

Generuje proformy i końcowe faktury PDF, rejestruje je w module
`assets` i powiązuje z zamówieniem źródłowym.

## Publiczne API

Lista admina jest chroniona przez `orders:read`.

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/orders/:id/invoice` | customer | Pobranie faktury PDF (404 `INVOICE_NOT_READY`, dopóki status='ready'; po gotowości binarny Content-Type). Admin używa tego samego endpointu przez origin storefrontu, aby pobrać ponownie. |
| `GET /api/v1/admin/invoices` | admin | Lista wszystkich faktur z `filter[status]` / `filter[orderId]`; domyślny limit 50, maks. 200 |

## Przepływ generowania

`invoice-service.ts#generate()` uruchamia się po `order.confirmed`: pobiera
zamówienie + pozycje + snapshot adresu kupującego, renderuje PDF przez lekki
renderer bez ciężkich zależności, persystuje bajty przez moduł `assets`
i zapisuje id zasobu z powrotem na zamówieniu. Błędy emitują
`invoice.generation_failed.v1` do kolejki ponowień w adminie.

## Encje

`Invoice` (numer, znaczniki issued/dated, referencja do zasobu,
`type ∈ {proforma, final}`).

## Numeracja

Dwa fakty o numerze faktury ciągną w przeciwnych kierunkach — oba są
zamierzone:

- **sekwencja** jest pobierana per `(sales channel, kind, year)`, bez luk, pod
  blokadą wiersza — `invoice_number_counters`;
- **numer** jest unikalny w całej platformie — `invoices_number_unique`.

To, co zamienia pierwsze w drugie, to wzorzec trzymany w Setting per rodzaj
dokumentu, z możliwością scope per kanał sprzedaży:

| Kind | Setting | Default |
| --- | --- | --- |
| VAT invoice | `invoices.numbering.invoice.pattern` | `FV {seq}/{channel}/{YYYY}` |
| Proforma | `invoices.numbering.proforma.pattern` | `PRO {seq}/{channel}/{YYYY}` |
| Correction | `invoices.numbering.correction.pattern` | `KOR {seq}/{channel}/{YYYY}` |

### Tokeny

| Token | Renderuje |
| --- | --- |
| `{seq}` | wylosowany numer sekwencji |
| `{seq:N}` | ten sam, dopełniony zerami do szerokości `N` |
| `{channel}` | `code` kanału sprzedaży, wielkie litery |
| `{YYYY}` / `{YY}` | rok wystawienia, 4 lub 2 cyfry |
| `{MM}` | miesiąc wystawienia |

Reszta to tekst dosłowny. `code` kanału jest niezmienny i unikalny, więc
numer już wyrenderowany przez `{channel}` nie może zostać unieważniony przez
zmianę nazwy; trzymaj separator po obu stronach, bo `FV {channel}{seq}` gubi
granicę między dwoma polami o zmiennej długości i renderuje `FV A12` zarówno dla
(`a1`, 2), jak i (`a`, 12).

### Trzy odmowy i która z nich jest gwarancją

Ponieważ sekwencja jest per kanał, a numer nie, dwa kanały, których wzorce
mogą wyrenderować ten sam ciąg, to czekająca kolizja. Trzy warstwy stoją między
tym a dokumentem klienta:

1. **Domyślny wzorzec zawiera `{channel}`**, więc utworzenie kanału sprzedaży
   nie uzbraja kolizji. Kanał system-default jest przypięty raz, przy starcie,
   do historycznego `FV {seq}/{YYYY}` — seria istniejącego wdrożenia nie
   zmienia kształtu — i tylko dopóki nikt nie skonfigurował ustawienia.
2. **`400 INVOICE_NUMBER_PATTERN_COLLIDES`** przy zapisie ustawień, wskazując
   kanał, z którym wzorzec koliduje. Odmawia *możliwej* kolizji: przy zapisie
   konfiguracji nic nie jest w grze, więc konserwatywna odmowa kosztuje jedną
   edycję.
3. **`409 INVOICE_NUMBER_ALREADY_ISSUED`** przy wystawieniu, wskazując kanał,
   który już trzyma numer. To jest gwarancja — jedyny punkt kontrolny, przez
   który przechodzi każdy numer — i odmawia tylko *faktycznego* duplikatu.
   Transakcja się wycofuje, więc draw licznika jest cofnięty i nie powstaje luka.

Wdrożenie już skonfigurowane w kolizję jest raportowane przy starcie,
raz na parę kolidującą, i **nie jest blokowane**: naprawialna
miskonfiguracja fakturowania nie może stać się awarią storefrontu.

## Punkty rozszerzenia

- **Schemat numeracji** — `services/invoice-number-generator.ts` renderuje
  wzorzec (`formatInvoiceNumber`) i pobiera sekwencję;
  `services/invoice-number-collisions.ts` decyduje, czy dwa kanały mogą
  wyrenderować jeden ciąg. Dodaj token w pierwszym, a siatka sondy w drugim
  go porówna.
- **E-fakturowanie** — dla KSeF / Peppol / podobnych podłącz adapter nadawcy
  konsumujący zdarzenia `invoice.issued.v1`.

## Szablony PDF (page builder)

Trasa admina `/invoices/templates` edytuje drzewo Puck sekcji faktury
(`InvoiceHeader`, `InvoiceParties`, tabele pozycji/VAT, sumy, notatki, KSeF,
oraz bloki layoutu: spacer, divider, logo, footer). Właściwości sekcji
personalizują typografię, widoczność kolumn i etykiety; brakujące props
zachowują historyczny domyślny layout.

- `GET /api/v1/admin/invoice-templates/:id/preview` — PDF **zapisanego**
  contentu szablonu dla danego id (fixture przykładowej faktury).
- `POST /api/v1/admin/invoice-templates/:id/preview` — to samo, z draftowym
  ciałem `{ data }`, aby autor mógł podglądnąć nieszablonowany stan canvasu.
- Ścieżka wystawienia runtime nadal używa `resolveTree(salesChannelId)` (aktywny
  szablon kanału/globalny).
