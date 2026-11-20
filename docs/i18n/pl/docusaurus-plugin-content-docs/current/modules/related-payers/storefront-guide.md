---
title: Płatnicy powiązani — przewodnik po storefroncie
sidebar_label: Przewodnik po storefroncie
sidebar_position: 3
description: Co widzą w sklepie kupujący i płatnicy — płacenie przez płatnika powiązanego, kupowanie na jego warunkach, prośby o płatnika i zamówienia, za które płaci płatnik
---

# Płatnicy powiązani — przewodnik po storefroncie

Co widzą w sklepie członkowie firmy, gdy operator włączył płatników powiązanych w kanale sprzedaży.
To, które z tych ekranów widzi członek, zależy od uprawnień jego roli w organizacji; rola
administratora organizacji ma je wszystkie. Zasady, które za nimi stoją, opisuje
[strona przeglądowa](./index.md) modułu.

## Dla kupującego

### Wybór płatnika w checkoucie

Z uprawnieniem *Zamawianie z płatnikiem powiązanym* checkout pokazuje pole **Płaci**: *Nasza
organizacja* albo jedna z organizacji, które płacą za Waszą.

Gdy wybierzesz płatnika:

- lista adresów rozliczeniowych pokazuje tylko te adresy płatnika, na które pozwala Wasze
  powiązanie, a nazwa firmy i NIP stają się tylko do odczytu — faktura jest wystawiana na płatnika,
  z jego danymi firmy;
- kwoty są przeliczane dla płatnika (VAT idzie za płatnikiem, więc płatnik zagraniczny albo
  zwolniony z VAT może zmienić kwotę brutto) i pokazywane jako *Kwoty rozliczane na płatnika*;
- metody płatności są tymi, z których może korzystać płatnik; metoda w ramach limitu kredytowego
  jest oferowana, gdy dostępny kredyt płatnika pokrywa kwotę, i wykorzystywany jest kredyt płatnika;
- adres i metody dostawy pozostają Wasze.

Zamówienie jest Wasze: widnieje w Waszym koncie z dopiskiem *Płaci* i nazwą płatnika.

### Zamawianie po cenach płatnika

Gdy płatnik zgodził się, żebyście zamawiali **po jego cenach**, koszyk z produktami pokazuje pole
**Płaci**: *Nasza organizacja* albo ten płatnik. Wybierz płatnika i zastosuj: koszyk, listy
produktów, strony produktów i wyszukiwanie pokazują ceny płatnika, a podsumowanie mówi, które
pozycje zmieniły cenę, które nie mają już ceny (usuń je przed złożeniem zamówienia) i które promocje
zostały dodane albo usunięte. Checkout pokazuje wtedy płatnika jako ustalonego — zmienisz go w
koszyku. Płatnika, który płaci po Waszych cenach, koszyk nie pokazuje; wybierasz go w checkoucie.

Jeśli płatnika nie można już użyć albo zmienią się jego warunki, koszyk wraca do Waszych cen i
podaje powód.

### Ekran *Płatnicy*

**Konto → Płatnicy** pokazuje, zależnie od uprawnień:

- **Nasi płatnicy** — organizacje, które płacą za Wasze zamówienia, adresy rozliczeniowe i ważność
  każdego powiązania oraz to, czy zamawiacie po swoich cenach, czy po cenach płatnika. Z
  uprawnieniem *Zarządzanie płatnikami* możesz płatnika **Odwołać**.
- **Poproś firmę o opłacanie naszych zamówień** (*Zarządzanie płatnikami*) — wpisz dokładny NIP
  firmy, e-mail kontaktowy w tej firmie i opcjonalny komentarz. Odpowiedź jest zawsze taka sama:
  prośba ma status *Oczekuje*, dopóki nie zostanie przyjęta, odrzucona albo nie wygaśnie. Wasza
  organizacja może wysłać dziennie ograniczoną liczbę próśb i zaproszeń.
- **Wysłane prośby** — ich stan, powód odrzucenia, jeśli prośbę odrzucono, i **Wycofaj**, dopóki
  prośba oczekuje.
- **Płatnicy proponujący opłacanie naszych zamówień** (*Zarządzanie płatnikami*) — zaproszenia od
  płatników, z przyciskami **Przyjmij** i **Odmów**.

Przyjęcie prośby albo zaproszenia tworzy powiązanie po Waszych cenach; zamawianie po cenach płatnika
ustawia operator sklepu.

## Dla płatnika

### Zamówienia, za które płacimy

Z uprawnieniem *Podgląd zamówień, za które płacimy* ekran **Konto → Zamówienia, za które płacimy**
pokazuje zamówienia złożone przez inne organizacje z Waszą jako płatnikiem: numer, datę, kto
zamówił, status, status płatności i kwotę. Szczegóły pokazują pozycje, dane do faktury i metodę
dostawy oraz pozwalają pobrać faktury. Nie pokazują adresu dostawy, uwagi ani komentarzy
kupującego i nie można takiego zamówienia anulować, zamówić ponownie ani zwrócić — to pozostaje po
stronie kupującego. Zamówienia nadal są widoczne po odwołaniu powiązania.

Jeśli powiązanie tak stanowi, członkowie z tym uprawnieniem dostają też e-mail, gdy takie zamówienie
zostanie złożone albo anulowane.

### Prośby i zaproszenia

**Konto → Płatnicy**, z uprawnieniem *Zatwierdzanie próśb o płatnika*:

- **Prośby czekające na naszą decyzję** — kupujący proszący Waszą organizację o opłacanie ich
  zamówień. **Przyjmij** tworzy powiązanie; **Odmów** przyjmuje opcjonalny powód, który zobaczy
  kupujący.
- **Organizacje, za które płacimy** — Wasze bieżące powiązania, każde z NIP-em kupującego, oraz
  **Odwołaj**.
- **Zaproś firmę, za którą zapłacimy** — jeśli sklep na to pozwala: dokładny NIP kupującego i e-mail
  kontaktowy. Decydują osoby zarządzające płatnikami u kupującego. **Wysłane zaproszenia** pokazuje
  je wraz z **Wycofaj**, dopóki oczekują.

Dostajesz informację e-mailem i w centrum powiadomień, gdy przychodzi prośba, gdy wysłana przez
Was prośba albo zaproszenie zostanie rozstrzygnięte lub wygaśnie i gdy druga strona odwoła
powiązanie.

## Gdy firma nie ma jeszcze konta

Jeśli prośba wskazuje NIP, którego sklep nie zna, sklep albo sam o niej decyduje, albo wysyła na
e-mail kontaktowy zaproszenie do rejestracji. Link z zaproszenia otwiera formularz rejestracji z
już uzupełnionym NIP-em. Po zatwierdzeniu rejestracji prośba trafia do osób zatwierdzających w nowej
firmie (albo do operatora sklepu) jak każda inna prośba. Wygasłe zaproszenie niczego nie uzupełnia.
