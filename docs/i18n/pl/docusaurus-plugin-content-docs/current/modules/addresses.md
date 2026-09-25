---
title: addresses
description: Adresy pocztowe klientów z inwariantem jednego domyślnego na rodzaj
---

# `addresses`

Adresy pocztowe klientów w zakresie Organization. Każdy adres ma
`kind` (`shipping`, `billing`, `delivery`) oraz flagę domyślnego dla danego rodzaju.

## Publiczne API

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/organizations/mine/addresses` | Lista adresów własnej Organization |
| `POST /api/v1/organizations/mine/addresses` | Utworzenie; `isDefault=true` atomowo cofa poprzedni domyślny tego samego rodzaju |
| `PATCH /api/v1/organizations/mine/addresses/:id` | Aktualizacja |
| `DELETE /api/v1/organizations/mine/addresses/:id` | Usunięcie (odrzucone, gdy adres jest referencjonowany przez zamówienie — `409 ADDRESS_IN_USE`) |

## Encje

`Address` — częściowy unikalny indeks `(organization_id, kind) WHERE
is_default = true` wymusza „co najwyżej jeden domyślny na rodzaj" na poziomie bazy.

## Punkty rozszerzenia

- **Walidacja specyficzna dla kraju** — `address-service.ts#createAddress`
  deleguje sprawdzenie formatu per kraj; dodawaj walidatory tutaj przy wejściu
  na nowe rynki.
- **Snapshot przy zamówieniu** — zamówienia osadzają value object `AddressSnapshot`, aby
  późniejsze edycje adresu źródłowego nie mutowały historycznych zamówień.
