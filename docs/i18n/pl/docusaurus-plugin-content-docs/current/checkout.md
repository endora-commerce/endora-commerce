---
sidebar_position: 20
title: Checkout
---

# Checkout (Kasa)

Checkout to przepływ sklepu, który zamienia niepusty **Cart** w **Order**. Zalogowany Klient potwierdza adres wysyłki i rozliczeniowy, wybiera metodę wysyłki i płatności, opcjonalnie stosuje kupon i dodaje komentarz, a następnie składa zamówienie. Po sukcesie koszyk staje się `completed`, tworzone jest Order w statusie oczekującym metody płatności (pokazywanym kupującemu jako *New*), a kupujący trafia na **Success Page**; po błędzie koszyk pozostaje nietknięty, a kupujący trafia na **Failure Page** z przyciskiem ponowienia.

Ta strona opisuje dwa aspekty istotne dla operatora, które najczęściej wymagają konfiguracji: **biznesowy Order ID** oraz **listy kwalifikujących się metod**.

## Biznesowy Order ID

Każde zamówienie ma dwa identyfikatory:

- `id` — wewnętrzny UUID w bazie danych. Używany w kluczach obcych, narzędziach admina i logach. **Nigdy nie jest pokazywany Klientowi.**
- `businessId` — **biznesowy Order ID widoczny dla klienta**, wyświetlany na Success Page, w e-mailu z potwierdzeniem zamówienia oraz na liście i w widoku szczegółowym zamówienia w sklepie.

Biznesowy Order ID jest generowany przy składaniu zamówienia jako:

```
<prefix><sequence><suffix>
```

- `<sequence>` pochodzi z dedykowanej, monotonicznej sekwencji Postgres (`orders_business_id_seq`). Nigdy się nie resetuje, więc ID jest globalnie unikalne niezależnie od późniejszej zmiany prefix/suffix.
- `<prefix>` i `<suffix>` są **konfigurowalne w panelu admina** i rozwiązywane per Sales Channel.

### Konfiguracja prefix / suffix

W Admin Settings UI otwórz grupę **Orders** i edytuj:

| Setting | Default | Example |
|---------|---------|---------|
| `orders.business_id.prefix` | `` (empty) | `ORD-` |
| `orders.business_id.suffix` | `` (empty) | `-2026` |

Przy wartościach domyślnych biznesowy Order ID to sam numer (np. `1042`).
Przy przykładowych wartościach staje się `ORD-1042-2026`. Obie ustawienia mają zakres Sales Channel, więc różne kanały mogą używać różnych formatów.

Zmiana wartości wpływa **wyłącznie na zamówienia złożone później** — istniejące biznesowe Order ID są niezmienne.

## Kwalifikujące się metody wysyłki i płatności

Sekcje metod wysyłki i płatności w checkout wyświetlają dokładnie te metody, które są:

1. **active** (status `Active` w Admin UI),
2. przypisane do bieżącego **Sales Channel** kupującego,
3. dozwolone dla **Organization** kupującego oraz
4. zaakceptowane przez walidator `validateUseOnStorefront` adaptera.

Te reguły należą do modułów Payment Method i Shipping Method; checkout tylko renderuje i przesyła wybór kupującego. Dopłata metody (`additionalPrice` dla płatności, `cost` dla wysyłki) jest uwzględniana w sumie zamówienia i w e-mailu potwierdzającym.

## Kupony

Kupon wprowadzony w checkout jest stosowany do **cart**, który jest źródłem prawdy odczytywanym przez transakcję składania zamówienia. Rabat widać w podsumowaniu checkout przed złożeniem zamówienia i jest zapisywany na Order (`promotionCode` + `discountTotal`) oraz w e-mailu potwierdzającym. Jednocześnie może być aktywny co najwyżej jeden kupon; nowy kod zastępuje poprzedni.

## Obsługa błędów

Składanie zamówienia odbywa się w jednej transakcji bazy danych. Jeśli się nie powiedzie — pusty koszyk, brak towaru w linii, niedozwolona/nieaktywna metoda, adres, którego kupujący już nie posiada, organizacja, która nie może transakcjonować, lub błąd inicjacji bramki płatności — transakcja jest wycofywana, **koszyk pozostaje bez zmian**, a Order nie jest tworzone. Kupujący trafia na Failure Page z komunikatem dopasowanym do przyczyny i przyciskiem *Try again*. Płatność odrzucona **po** utworzeniu zamówienia (np. nieudany callback bramki) jest obsługiwana na Order w cyklu życia płatności, a nie przez ponowne uruchomienie checkout.
