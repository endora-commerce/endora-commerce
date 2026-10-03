---
sidebar_position: 20
title: Checkout
---

# Checkout (składanie zamówienia)

Checkout to proces w sklepie, który zamienia niepusty **koszyk** w **zamówienie**. Zalogowany klient
potwierdza adres dostawy i adres do faktury, wybiera metodę dostawy i płatności, opcjonalnie stosuje
kupon i dodaje komentarz, a potem składa zamówienie. Po powodzeniu koszyk otrzymuje stan
`completed`, powstaje zamówienie w statusie oczekiwania na wybraną metodę płatności (kupujący widzi
go jako *New*), a kupujący trafia na **stronę sukcesu**; po błędzie koszyk pozostaje bez zmian, a
kupujący trafia na **stronę błędu** z przyciskiem ponowienia.

Ta strona opisuje dwie rzeczy, które operator najczęściej musi skonfigurować: **numer zamówienia
widoczny dla klienta** oraz **listy dostępnych metod**.

## Numer zamówienia widoczny dla klienta

Każde zamówienie ma dwa identyfikatory:

- `id` — wewnętrzny UUID w bazie danych. Używany w kluczach obcych, narzędziach panelu
  administracyjnego i logach. **Nigdy nie jest pokazywany klientowi.**
- `businessId` — **numer zamówienia widoczny dla klienta**, pokazywany na stronie sukcesu, w e-mailu
  z potwierdzeniem zamówienia oraz na liście i w szczegółach zamówienia w sklepie.

Numer zamówienia jest tworzony przy składaniu zamówienia według wzoru:

```
<prefix><sequence><suffix>
```

- `<sequence>` pochodzi z osobnej, stale rosnącej sekwencji Postgresa (`orders_business_id_seq`).
  Nigdy nie jest zerowana, więc numer jest unikalny globalnie, niezależnie od późniejszych zmian
  przedrostka i przyrostka.
- `<prefix>` i `<suffix>` **konfiguruje się w panelu administracyjnym**, osobno dla każdego kanału
  sprzedaży.

### Ustawienie przedrostka i przyrostka

W ustawieniach w panelu administracyjnym otwórz grupę **Orders** i zmień:

| Ustawienie | Wartość domyślna | Przykład |
|---------|---------|---------|
| `orders.business_id.prefix` | `` (pusta) | `ORD-` |
| `orders.business_id.suffix` | `` (pusta) | `-2026` |

Przy wartościach domyślnych numer zamówienia to sama liczba (np. `1042`). Przy przykładowych
wartościach to `ORD-1042-2026`. Oba ustawienia można określić osobno dla kanału sprzedaży, więc
różne kanały mogą mieć różne formaty.

Zmiana wartości dotyczy **wyłącznie zamówień złożonych później** — numery istniejących zamówień się
nie zmieniają.

## Dostępne metody dostawy i płatności

W checkoucie w sekcjach metod dostawy i płatności wyświetlane są dokładnie te metody, które:

1. są **aktywne** (status `Active` w panelu administracyjnym),
2. są przypisane do bieżącego **kanału sprzedaży** kupującego,
3. są dozwolone dla **organizacji** kupującego oraz
4. zostały zaakceptowane przez walidator `validateUseOnStorefront` adaptera.

Za te reguły odpowiadają moduły metod płatności i metod dostawy; checkout tylko wyświetla metody i
przesyła wybór kupującego. Dopłata do metody (`additionalPrice` dla płatności, `cost` dla dostawy)
jest wliczana do wartości zamówienia i pokazywana w e-mailu z potwierdzeniem.

## Kupony

Kupon wpisany w checkoucie jest stosowany do **koszyka**, który jest źródłem danych dla transakcji
składania zamówienia. Rabat widać w podsumowaniu checkoutu przed złożeniem zamówienia, a potem jest
zapisywany w zamówieniu (`promotionCode` i `discountTotal`) i pokazywany w e-mailu z potwierdzeniem.
Aktywny może być najwyżej jeden kupon naraz; nowy kod zastępuje poprzedni.

## Obsługa błędów

Składanie zamówienia odbywa się w jednej transakcji bazy danych. Jeśli się nie powiedzie — pusty
koszyk, brak towaru w którejś pozycji, niedozwolona lub nieaktywna metoda, adres, którego kupujący
już nie ma, organizacja, która nie może składać zamówień, albo błąd przy rozpoczęciu płatności w
bramce — transakcja jest wycofywana, **koszyk pozostaje bez zmian**, a zamówienie nie powstaje.
Kupujący trafia na stronę błędu z komunikatem dopasowanym do przyczyny i przyciskiem *Try again*.
Płatność odrzucona **po** utworzeniu zamówienia (np. nieudane powiadomienie zwrotne z bramki) jest
obsługiwana w zamówieniu, w ramach cyklu życia płatności, a nie przez ponowne uruchomienie checkoutu.
