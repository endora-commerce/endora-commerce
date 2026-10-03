---
title: addresses
description: Adresy pocztowe klientów, z najwyżej jednym adresem domyślnym każdego rodzaju
---

# `addresses`

Adresy pocztowe klientów, przypisane do organizacji. Każdy adres ma rodzaj `kind` (`shipping`,
`billing`, `delivery`) oraz flagę adresu domyślnego dla tego rodzaju.

## API publiczne

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/organizations/mine/addresses` | Lista adresów własnej organizacji |
| `POST /api/v1/organizations/mine/addresses` | Utworzenie; `isDefault=true` w tej samej operacji zdejmuje flagę z poprzedniego domyślnego adresu tego rodzaju |
| `PATCH /api/v1/organizations/mine/addresses/:id` | Aktualizacja |
| `DELETE /api/v1/organizations/mine/addresses/:id` | Usunięcie (odrzucane, gdy adres jest używany przez zamówienie — `409 ADDRESS_IN_USE`) |

## Encje

`Address` — częściowy indeks unikalny `(organization_id, kind) WHERE is_default = true` wymusza na
poziomie bazy danych regułę „najwyżej jeden adres domyślny każdego rodzaju”.

## Punkty rozszerzenia

- **Walidacja zależna od kraju** — `address-service.ts#createAddress` deleguje sprawdzenie formatu
  do walidatora właściwego dla kraju; przy wejściu na nowe rynki dodawaj walidatory właśnie tutaj.
- **Kopia adresu w zamówieniu** — zamówienia zapisują obiekt wartości `AddressSnapshot`, aby
  późniejsze zmiany adresu źródłowego nie zmieniały zamówień historycznych.
