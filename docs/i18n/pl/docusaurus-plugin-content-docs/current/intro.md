---
sidebar_position: 1
slug: /
title: Platforma B2B — Wprowadzenie
---

:::caution Tłumaczenia dokumentacji
Ta witryna jest utrzymywana ręcznie w wersjach angielskiej i polskiej. Przy każdej zmianie treści angielskiej zaktualizuj polską wersję w tym samym merge requeście — szczegóły w [polityce tłumaczeń dokumentacji](contributing/documentation-i18n).
:::

# Platforma B2B — Wprowadzenie

Witamy. Ta witryna dokumentuje **Platformę B2B** — produkt handlowy obsługiwany przez Dostawcę, który w jednej bazie kodu wspiera zarówno przepływ **Zapytania ofertowe (RFQ)**, jak i **bezpośrednie zakupy**, z Organizacjami Klientów, wieloma użytkownikami i rolami, rozliczeniem Limitu kredytowego, panelem administracyjnym z uprawnieniami oraz otwartą warstwą API + webhooków do integracji z zewnętrznymi ERP / PIM / WMS / CRM.

## Dla kogo jest ta dokumentacja

- **Programiści** rozszerzający platformę — sekcja każdego modułu poniżej opisuje jego domenę, kontrakty, usługi i testy z wystarczającą szczegółowością, aby móc wnieść wkład bez reverse engineeringu kodu.
- **Product Ownerzy i użytkownicy końcowi** — strona „Usage” każdego modułu jest napisana tak, aby była zrozumiała bez czytania TypeScript.

Obie grupy czytają tę samą strukturę. Sekcje oznaczone _Developers_ vs _Usage_ pozwalają pominąć fragmenty, które Cię nie dotyczą.

## Gdzie co się znajduje

| Artefakt | Lokalizacja |
| --- | --- |
| Źródło prawdy dotyczącego governance | `.specify/memory/constitution.md` w repozytorium |
| Specyfikacje, plany, zadania i kontrakty poszczególnych funkcji | `specs/###-feature-name/` w repozytorium |
| Runbook dev + prod + wymagania sprzętowe | `README.md` w katalogu głównym repozytorium |
| Dokumentacja modułów (jesteś tutaj) | Ta witryna |

## Szybkie linki

- Funkcja Spec-Kit **001 — B2B Platform Foundation** — specyfikacja, plan i zadania definiujące całą platformę: `specs/001-b2b-platform-foundation/` w repozytorium.
- OpenAPI na żywo (gdy backend działa): `http://localhost:3001/api/v1/_openapi.json`.

## Status

Funkcja **001 — B2B Platform Foundation** jest **kompletna** end-to-end w User Stories 1–7:

- **Backend** dostarcza katalog (Products / Categories / Attributes), wyszukiwarkę, cykl życia RFQ, koszyk + checkout + zamówienia + faktury, organizacje + członków + zaproszenia, admin Users & Roles + Audit Log + Impersonation, Shopping Lists + Quick Order, Credit Limits, integracje (API keys, webhooks, external integrations), CMS, SEO, języki + waluty, analitykę — każda strona modułu poniżej dokumentuje jego publiczne API, a dokument OpenAPI na żywo pod `GET /api/v1/_openapi.json` jest kontraktem runtime.
- **Storefront** (Next.js) dostarcza rejestrację / logowanie / 2FA / reset hasła, panel konta, ustawienia organizacji (członkowie + adresy + oczekujące zaproszenia), koszyk, checkout (z widocznością metod płatności uwzględniającą limit kredytowy), potwierdzenie zamówienia + historię, listę RFQ + szczegół z widgetem „Request a quote” na PDP, listy zakupów z masową konwersją do koszyka / do RFQ, importer CSV quick-order oraz baner impersonacji.
- **Panel administracyjny** (Vite + React) dostarcza Products / Categories / Attributes, Inventory, Organizations, Orders, Invoices, Quote Requests (Claim / Send Quote / Decline), Price Lists / Taxes / Promotions, Delivery + Payment Methods, Credit Limits, Users + Roles z macierzą uprawnień, przeglądarkę Audit Log, baner Impersonation, a także moduły API Keys / Webhooks / Integrations / Analytics / SEO / Languages / CMS.

Zgodnie z wymaganiami Documentation Requirements w konstytucji: PR-y, które dodają lub zmieniają moduł, MUSZĄ zaktualizować odpowiednią stronę w tym samym zakresie commitów.

## O tej witrynie

To jest publiczna dokumentacja Endora Commerce, publikowana pod adresem `https://docs.commerce.endora.software/` w wersji angielskiej i polskiej: powstaje w Docusaurusie ze źródeł dokumentacji trzymanych w repozytorium samego produktu — stron tej witryny w katalogu `docs/` oraz jednego katalogu dokumentacji na moduł, zbieranych podczas budowania — dzięki czemu strona i opisywany przez nią kod zmieniają się razem.
