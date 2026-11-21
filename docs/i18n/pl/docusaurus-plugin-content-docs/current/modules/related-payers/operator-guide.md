---
title: Płatnicy powiązani — przewodnik operatora
sidebar_label: Przewodnik operatora
sidebar_position: 2
description: Wiązanie płatników na karcie organizacji, ustawienia kanału, kolejka próśb o płatnika i warunki handlowe płatnika
---

# Płatnicy powiązani — przewodnik operatora

Ta strona jest dla operatorów sklepu. Czym jest moduł i jak wygląda zamówienie z płatnikiem, opisuje
[strona przeglądowa](./index.md) modułu.

## Zanim zaczniesz

1. **Platforma → Moduły** — aktywuj *Related payers*.
2. **Ustawienia → Płatnicy powiązani** — włącz *Płatnicy powiązani włączeni* w każdym kanale
   sprzedaży, który ma to oferować, i przejrzyj pozostałe ustawienia (niżej).
3. Nadaj rolom klientów potrzebne uprawnienia organizacji — *Zamawianie z płatnikiem powiązanym*
   kupującym, którzy zamawiają, *Podgląd zamówień, za które płacimy* księgowości płatnika,
   *Zarządzanie płatnikami* i *Zatwierdzanie próśb o płatnika* osobom, które po każdej ze stron
   zajmują się prośbami. Żadne nie jest domyślnie przyznawane członkom.
4. Twoja rola administracyjna potrzebuje **Podglądu płatników powiązanych**, żeby widzieć sekcję i
   kolejkę, oraz **Zarządzania płatnikami powiązanymi** (razem z uprawnieniem do zarządzania
   klientami), żeby je zmieniać.

## Sekcja *Płatnicy* na karcie organizacji

Otwórz kartę organizacji. Sekcja *Płatnicy* pokazuje dwie listy:

- **Płacą za tę organizację** — powiązania, w których ta organizacja jest kupującym;
- **Ta organizacja płaci za** — powiązania, w których jest płatnikiem.

Każde powiązanie pokazuje płatnika (i jego NIP), stan, dozwolone adresy rozliczeniowe, ważność,
warunki handlowe, sposób utworzenia oraz to, czy płatnik dostaje e-maile o zamówieniach. Sekcja zapisuje każdą zmianę **od razu** i nie należy do
przycisku *Zapisz* karty, co oznacza jej nagłówek.

Co możesz tam zrobić z uprawnieniem **Zarządzanie płatnikami powiązanymi**:

- **Dodaj płatnika** — wybierz istniejącą organizację firmową. Wybierz adres rozliczeniowy, który
  dopuszcza powiązanie (wszystkie adresy rozliczeniowe płatnika albo jeden z nich), warunki
  handlowe, opcjonalnie daty ważności i to, czy wysyłać płatnikowi e-maile o zamówieniach;
  powiązanie powstaje jako aktywne.
- **Utwórz organizację płatnika** — gdy płatnik nie ma jeszcze konta. Wpisz jego NIP i użyj
  **Wyszukaj w rejestrze**, żeby uzupełnić dane firmy, sprawdź je, wybierz kanał sprzedaży i
  opcjonalnie podaj e-mail, żeby zaprosić pierwszego użytkownika zwykłym zaproszeniem członka.
  Organizacja powstaje jako **zatwierdzona**, a powiązanie jest od razu aktywne. Nowa organizacja
  nie ma jeszcze adresu rozliczeniowego, więc jej powiązanie dopuszcza wszystkie; ogranicz je
  później przyciskiem **Zmień adres rozliczeniowy**.
- **Warunki handlowe** — przełącz powiązanie między *Warunkami kupującego* a *Warunkami płatnika*.
- **Zmień adres rozliczeniowy** — ogranicz powiązanie do jednego z adresów rozliczeniowych płatnika
  albo ponownie dopuść wszystkie. Lista pokazuje tylko adresy rozliczeniowe płatnika; zamówienie z
  tym płatnikiem może wtedy być rozliczone wyłącznie na ten adres.
- **Wysyłaj płatnikowi e-maile o złożonych i anulowanych zamówieniach** — przełącznik przy każdym
  powiązaniu, dostępny też przy dodawaniu i tworzeniu płatnika: gdy jest włączony, płatnik dostaje
  e-mail o każdym złożonym na niego zamówieniu i o każdym takim zamówieniu anulowanym. Jest
  wyłączony, dopóki go nie włączysz.
- **Zmień ważność** — ustaw albo wyczyść daty *Ważne od* i *Ważne do*. Są traktowane jako początek
  pierwszego i koniec ostatniego dnia w strefie czasowej Twojej przeglądarki.
- **Dezaktywuj** / **Aktywuj** — wstrzymaj albo wznów powiązanie bez jego utraty.
- **Odwołaj** — zakończ powiązanie na stałe. Złożone już zamówienia zachowują płatnika; parę można
  później powiązać ponownie nowym powiązaniem.

Odrzucona zmiana podaje powód: obie organizacje są tą samą organizacją, jedna z nich jest
organizacją osobistą albo para ma już powiązanie, które nie jest odwołane.

## Ustawienia kanału

**Ustawienia → Płatnicy powiązani**, z nadpisaniem dla kanału sprzedaży:

- **Płatnicy powiązani włączeni** — udostępnia w tym kanale wybór płatnika w checkoucie i w koszyku
  oraz ekrany konta.
- **Zatwierdzanie próśb o płatnika** — kto decyduje o prośbie wskazującej organizację, która ma
  konto:
  - *Decydują użytkownicy płatnika* (`payer`, domyślnie) — jej członkowie z uprawnieniem
    *Zatwierdzanie próśb o płatnika*;
  - *Decyduje operator* (`admin`) — prośba trafia do Twojej kolejki;
  - *Użytkownicy płatnika, a potem operator* (`payer_then_admin`) — obaj, w tej kolejności.

  Jeśli u płatnika nie ma nikogo, kto może zatwierdzić, prośba trafia zamiast tego do Twojej
  kolejki.
- **Płatnik bez konta** — co dzieje się z prośbą wskazującą NIP, którego nie ma żadna organizacja:
  - *Decyduje operator* (`admin`, domyślnie) — prośba trafia do Twojej kolejki, gdzie możesz
    utworzyć organizację, wysłać zaproszenie albo odrzucić prośbę;
  - *Zaproś płatnika do rejestracji* (`invite`) — na e-mail kontaktowy wpisany przez nadawcę trafia
    zaproszenie do rejestracji z uzupełnionym NIP. Prośba zostaje przypięta do nowej organizacji po
    zatwierdzeniu jej rejestracji i dalej idzie zgodnie z trybem zatwierdzania. Z samego zaproszenia
    nic nie powstaje.
- **Płatnicy mogą zapraszać kupujących** — pozwala płatnikom zaproponować płacenie za kupującego.
  Wyłączenie ukrywa formularz zaproszenia; wysłane już zaproszenia nadal można wycofać.
- **Ważność prośby (dni)** — od 1 do 365, domyślnie 30.
- **Prośby organizacji na dzień** — od 1 do 1000, domyślnie 10, prośby i zaproszenia łącznie.
- **Strefa czasowa dziennego limitu próśb** — dzień tego limitu zaczyna się o północy w tej strefie
  (domyślnie `Europe/Warsaw`). Jest odczytywana dla domyślnego sklepu i obowiązuje w każdym kanale.

### Ryzyko szczątkowe trybu `invite` {#residual-risk-of-the-invite-mode}

Nadawca dostaje taką samą odpowiedź bez względu na to, czy NIP do czegoś pasował, więc kupujący nie
może za pomocą próśb ustalić, które firmy mają konto w Twoim sklepie. Tryb `invite` ma jeden
zaakceptowany wyjątek: nadawca, który jako kontakt wpisze **własny** adres e-mail, dostaje
zaproszenie do rejestracji i w ten sposób dowiaduje się, że NIP nie ma konta. W domyślnym trybie
`admin` na e-mail kontaktowy nic nie jest wysyłane i to pytanie pozostaje bez odpowiedzi. Wybierz
`invite` tylko tam, gdzie takie ujawnienie jest do przyjęcia.

## Kolejka próśb o płatnika

**Klienci → Prośby o płatnika** (także pod ⌘K / CTRL+K, *Prośby o płatnika*) pokazuje prośby, które
czekają na operatora, od najstarszej, wraz z powodem. Listę można filtrować według stanu
(*Oczekuje*, jeśli nie wybierzesz innego) i powodu; *Wyczyść wszystkie filtry* wraca do próśb, które
czekają. Długa kolejka jest stronicowana pod listą.

| Powód | Co zrobić |
| --- | --- |
| Wymagana akceptacja operatora | Tryb zatwierdzania kanału to `admin`. Zaakceptuj albo odrzuć. |
| Zaakceptowana przez płatnika, czeka na operatora | Drugi krok `payer_then_admin`. Zaakceptuj albo odrzuć. |
| Nikt u płatnika nie może zaakceptować | Płatnik nie ma aktywnego członka, który może zatwierdzać. Zaakceptuj albo odrzuć. |
| Żadna organizacja nie ma tego NIP | Tryb `admin` i brak konta. Utwórz organizację, wyślij zaproszenie albo odrzuć. |
| Kilka organizacji ma ten NIP | Przypisz właściwą organizację albo odrzuć. |
| Organizacja nie może być płatnikiem | Dopasowana organizacja nie jest zatwierdzoną organizacją firmową albo już płaci za nadawcę. Odrzuć albo najpierw popraw organizację. |

Akcje — **Zaakceptuj** to przycisk w wierszu; pozostałe są w menu ⋮ wiersza, a **Odrzuć** jest na
końcu. Wynik każdej akcji pojawia się nad listą:

- **Zaakceptuj** — tworzy aktywne powiązanie na warunkach kupującego. Prośba bez dopasowanej
  organizacji nie ma przycisku *Zaakceptuj*, dopóki jej nie dostanie.
- **Odrzuć** — wpisany powód kupujący zobaczy na ekranie *Płatnicy* swojego konta.
- **Przypisz organizację** — dostępne, gdy istnieją organizacje z NIP-em prośby (niejednoznaczny NIP
  albo organizacja zarejestrowana po wysłaniu prośby). Prośba trafia wtedy do osób zatwierdzających
  w tej organizacji albo zostaje u Ciebie, zgodnie z trybem zatwierdzania, w jakim została wysłana.
- **Utwórz organizację** — tworzy organizację z NIP-em prośby, zatwierdzoną, i od razu powiązanie.
  NIP-u nie można tu zmienić: organizacja z innym NIP-em jest odrzucana. Wymaga też uprawnienia do
  zarządzania klientami.
- **Wyślij zaproszenie** — wysyła na e-mail kontaktowy zaproszenie do rejestracji z uzupełnionym
  NIP-em; prośba czeka na tę rejestrację.

Gdy prośba trafia do kolejki, dostajesz powiadomienie w dzwonku panelu. Prośby, o których nikt nie
zdecyduje, wygasają po okresie ważności kanału i powiadamiają nadawcę.

## Warunki handlowe płatnika

Powiązanie na **Warunkach płatnika** pozwala kupującemu wybrać tego płatnika w polu *Płaci* w
koszyku; koszyk i katalog są wtedy wyceniane tak, jak płatnik według cenników kanału, a VAT idzie za
płatnikiem. Używaj tego, gdy płatnik ma wynegocjowane ceny, po których ma zamawiać kupujący — na
przykład inwestor z własnym cennikiem zamawiający przez swoich wykonawców. Obowiązują tylko cenniki
przypisane do kanału. To, co kupujący może zobaczyć (produkty, tryb wyświetlania cen), pozostaje
kupującego.

Prośba, zaproszenie albo powiązanie utworzone z kolejki zawsze startuje na **warunkach kupującego**:
warunki płatnika ustawia tylko operator albo integracja. Przełączenie powiązania z powrotem na
warunki kupującego przywraca ceny kupującego w każdym koszyku kupowanym dla tego płatnika przy jego
następnym odczycie.

## Zamówienia, faktury i zwroty

- Szczegóły zamówienia pokazują w karcie rozliczenia **Płatnika** wraz z warunkami, a lista zamówień
  ma filtr *Płatnik* pod *Więcej filtrów*.
- Faktura jest wystawiana na płatnika i widnieje przy płatniku, a nie przy kupującym; filtr
  *Organizacja na fakturze* na liście faktur znajduje ją przy płatniku.
- Rozliczenie zwrotu takiego zamówienia w formie kredytu uznaje płatnika.

## Odwoływanie

Powiązanie może odwołać operator, każda ze stron powiązania albo integracja. Druga strona dostaje
informację e-mailem i w koncie (obie strony, gdy odwołał operator albo integracja). Nowe zamówienia
na tym powiązaniu są od razu odrzucane; złożone już zamówienia zachowują płatnika, faktury i
zarezerwowany kredyt.
