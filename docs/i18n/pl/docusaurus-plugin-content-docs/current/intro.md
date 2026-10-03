---
sidebar_position: 1
slug: /
title: Platforma B2B — Wprowadzenie
---

:::caution Tłumaczenia dokumentacji
Ta witryna jest prowadzona ręcznie w wersji angielskiej i polskiej. Przy każdej zmianie treści angielskiej zaktualizuj wersję polską w tym samym pull requeście — szczegóły w [zasadach tłumaczenia dokumentacji](contributing/documentation-i18n).
:::

# Platforma B2B — Wprowadzenie

Witamy. Ta witryna dokumentuje **Platformę B2B** — platformę handlową prowadzoną przez Dostawcę, która w jednym kodzie źródłowym obsługuje zarówno **zapytania ofertowe (RFQ)**, jak i **bezpośrednie zakupy**: organizacje klientów z wieloma użytkownikami i rolami, płatność w ramach limitu kredytowego, panel administracyjny z uprawnieniami oraz otwarte API i webhooki do integracji z zewnętrznymi systemami ERP, PIM, WMS i CRM.

## Zacznij tutaj

1. [Pierwsze kroki](./getting-started.md) — jedno polecenie instaluje instancję na Twoim
   komputerze: API, panel administracyjny i sklep. O co pyta instalator, co dostajesz i gdzie się
   zalogować.
2. [Komponenty na osobnych maszynach](./getting-started.md#one-component-per-machine) — API, panel
   i sklep każde na własnej maszynie, każde pod własną nazwą albo na jednym hoście ze ścieżkami.
3. [Utwórz swój pierwszy moduł](./create-your-first-module.md) — samouczek na 20 minut, który
   rozszerza instancję o Twój własny moduł.
4. [Lista kontrolna pierwszego wdrożenia produkcyjnego](./deployment/first-deployment-checklist.md)
   — zanim instancja przyjmie prawdziwe zamówienia.

## Dla kogo jest ta dokumentacja

- **Programiści** rozszerzający platformę — sekcja każdego modułu opisuje jego domenę, kontrakty, usługi i testy na tyle szczegółowo, aby można było wnieść zmiany bez analizowania kodu od podstaw.
- **Właściciele produktu i użytkownicy końcowi** — strona „Usage” każdego modułu jest napisana tak, aby dało się ją zrozumieć bez czytania kodu TypeScript.

Obie grupy korzystają z tej samej struktury. Sekcje oznaczone jako _Developers_ i _Usage_ pozwalają pominąć fragmenty, które Cię nie dotyczą.

## Gdzie co się znajduje

| Artefakt | Lokalizacja |
| --- | --- |
| Instalacja instancji | [Pierwsze kroki](./getting-started.md) |
| Wymagania sprzętowe i praca nad samym Endora Commerce | `README.md` w katalogu głównym repozytorium |
| Dokumentacja modułów (jesteś tutaj) | Ta witryna |

## Szybkie linki

- OpenAPI na żywo (gdy API działa, na domyślnym porcie): `http://localhost:3001/api/v1/_openapi.json`.

## Status

Podstawa platformy jest **kompletna** od początku do końca:

- **Backend** zapewnia katalog (produkty, kategorie, atrybuty), wyszukiwarkę, obsługę zapytań ofertowych, koszyk, checkout, zamówienia i faktury, organizacje z członkami i zaproszeniami, administratorów i role, dziennik audytu, logowanie jako klient, listy zakupów i szybkie zamówienia, limity kredytowe, integracje (klucze API, webhooki, integracje zewnętrzne), CMS, SEO, języki i waluty oraz analitykę — strona każdego modułu dokumentuje jego publiczne API, a kontraktem obowiązującym w czasie działania jest dokument OpenAPI na żywo pod `GET /api/v1/_openapi.json`.
- **Storefront** (Next.js) zapewnia rejestrację, logowanie, 2FA i reset hasła, panel konta, ustawienia organizacji (członkowie, adresy, oczekujące zaproszenia), koszyk, checkout (z metodami płatności zależnymi od limitu kredytowego), potwierdzenie i historię zamówień, listę i szczegóły zapytań ofertowych z widżetem „Request a quote” na stronie produktu, listy zakupów z przenoszeniem do koszyka lub zapytania ofertowego, import CSV do szybkiego zamówienia oraz baner logowania jako klient.
- **Panel administracyjny** (Vite + React) zapewnia ekrany produktów, kategorii i atrybutów, stanów magazynowych, organizacji, zamówień, faktur, zapytań ofertowych (Claim / Send Quote / Decline), cenników, podatków i promocji, metod dostawy i płatności, limitów kredytowych, użytkowników i ról z macierzą uprawnień, przeglądarkę dziennika audytu, baner logowania jako klient oraz moduły kluczy API, webhooków, integracji, analityki, SEO, języków i CMS.

Pull requesty, które dodają lub zmieniają moduł, MUSZĄ w tych samych commitach zaktualizować odpowiednią stronę.

## O tej witrynie

To publiczna dokumentacja Endora Commerce, publikowana pod adresem `https://docs.commerce.endora.software/` po angielsku i po polsku. Powstaje w Docusaurusie ze źródeł przechowywanych w repozytorium samego produktu — stron tej witryny w katalogu `docs/` oraz katalogu dokumentacji każdego modułu, zbieranych podczas budowania — dzięki czemu dokumentacja i opisywany przez nią kod zmieniają się razem.
