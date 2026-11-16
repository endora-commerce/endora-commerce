---
title: Adresy
description: Adresy pocztowe klientów, z najwyżej jednym adresem domyślnym każdego rodzaju
---

# Adresy (`addresses`)

Adresy pocztowe klientów, przypisane do organizacji. Każdy adres ma rodzaj `kind` (`delivery` lub
`billing`) oraz flagę adresu domyślnego dla tego rodzaju.

To **jedyna książka adresowa każdego klienta**: książka firmy albo organizacji osobistej klienta
indywidualnego. Kasa proponuje adresy z niej i do niej zapisuje nowe, a sklep pokazuje ją klientowi
indywidualnemu jako *Moje adresy* (`/addresses`), a członkowi firmy jako *Adresy organizacji*
(`/organization/addresses`). Osobna, osobista książka adresowa, którą prowadził moduł `customers`,
została wycofana.

## API publiczne

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/organizations/mine/addresses` | Lista adresów własnej organizacji |
| `POST /api/v1/organizations/mine/addresses` | Utworzenie; `isDefault=true` w tej samej operacji zdejmuje flagę z poprzedniego domyślnego adresu tego rodzaju |
| `PATCH /api/v1/organizations/mine/addresses/:id` | Aktualizacja |
| `DELETE /api/v1/organizations/mine/addresses/:id` | Usunięcie (`204`). Usunięcie miękkie: zamówienia złożone na ten adres zachowują własną kopię adresu |

Trasy obsługuje moduł `organizations`. Tworzenie, aktualizacja i usuwanie wymagają uprawnienia
organizacji **`addresses.manage`**, które deklaruje ten moduł (*Zarządzanie adresami organizacji*):
członek, którego rola go nie ma, otrzymuje odmowę `403 ORGANIZATION_PERMISSION_REQUIRED`. Listę
może odczytać każdy członek. Uprawnienie ma domyślnie rola Członek, a rola Administrator zawsze;
organizacja odbiera je, edytując rolę.

W storefroncie obie strony adresów to ta sama książka adresowa. Pokazują listę adresów każdemu
członkowi, a formularz dodawania i przyciski *Ustaw jako domyślny* i *Usuń* tylko członkowi, którego
rola ma to uprawnienie. Klient indywidualny jest administratorem swojej organizacji osobistej i
zawsze je ma. Pozostali widzą zamiast formularza jedno zdanie: *Twoja rola nie pozwala dodawać ani
usuwać adresów. Możesz je przeglądać i używać przy składaniu zamówienia.* Odrzucone pole jest
opisane własnym zdaniem, na przykład *Wpisz ulicę i numer.*

## Anonimizacja

`addressServicePort.anonymizeForOrganization(organizationId)` czyści każdy adres organizacji, także
już usunięty (`-` w polach odbiorcy, ulicy, miejscowości i kodu pocztowego; bez telefonu; nie jest
domyślny; kraj zostaje), miękko go usuwa (usunięty adres zachowuje datę usunięcia) i zapisuje jeden
wpis audytu `address.anonymized` na adres, bez autora. Wpis odnotowuje tylko rodzaj adresu, to, czy
adres był już usunięty, i chwilę wyczyszczenia. Adres już wyczyszczony jest pomijany, więc ponowne
wywołanie niczego nie zmienia. Wywołuje ją zadanie anonimizacji modułu `customers`, gdy anonimizuje
organizację osobistą klienta indywidualnego. Zamówienia zachowują własne kopie adresów.

`addressReadPort.listIdsForOrganization(organizationId, { includeDeleted })` zwraca identyfikatory
adresów organizacji, a gdy `includeDeleted` ma wartość `true`, także adresów usuniętych.

## Dziennik audytu

Dodanie, zmiana, usunięcie i anonimizacja adresu zapisują po jednym wpisie w dzienniku audytu
platformy, przypisanym do adresu po identyfikatorze. Ten dziennik czyta każdy, kto ma
`audit_log:read`, niezależnie od tego, które organizacje widzi, więc wpis odnotowuje nazwy, a nie
wartości (zgłoszenie #470): rodzaj adresu i nazwy zmienionych pól (`changedFields`, na przykład
`['phone', 'street']`). Nigdy nie zawiera odbiorcy, ulicy, miejscowości, kodu pocztowego, telefonu
ani identyfikatora organizacji. Wpisy zapisane przed wprowadzeniem tej zasady nie są przepisywane.

## Encje

`Address` — częściowy indeks unikalny `(organization_id, kind) WHERE is_default = true` wymusza na
poziomie bazy danych regułę „najwyżej jeden adres domyślny każdego rodzaju”.

## Punkty rozszerzenia

- **Walidacja zależna od kraju** — `address-service.ts#createAddress` deleguje sprawdzenie formatu
  do walidatora właściwego dla kraju; przy wejściu na nowe rynki dodawaj walidatory właśnie tutaj.
- **Kopia adresu w zamówieniu** — zamówienia zapisują obiekt wartości `AddressSnapshot`, aby
  późniejsze zmiany adresu źródłowego nie zmieniały zamówień historycznych.
