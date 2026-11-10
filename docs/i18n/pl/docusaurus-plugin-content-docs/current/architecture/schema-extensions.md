---
title: Zadeklarowane kolumny rozszerzeń
description: Jak zainstalowany pakiet modułu dodaje własne kolumny do rozszerzalnej tabeli rdzenia — deklaracja, generowane DDL, rejestr, akcesor, odczyty w panelu administracyjnym, odinstalowanie i usunięcie.
sidebar_label: Zadeklarowane kolumny rozszerzeń
---

# Zadeklarowane kolumny rozszerzeń

Zainstalowany pakiet modułu może dodać kilka własnych kolumn **do tabeli rdzenia** — na przykład
kod ERP organizacji — bez edytowania rdzenia, bez ręcznie pisanego `alter table` i bez ryzyka, że
zginą przy następnej aktualizacji platformy. Pakiet je deklaruje, a resztą zajmuje się platforma.

To stopień **D2** drabiny danych opisanej na stronie
[Drabina dostosowań](./customisation-ladder.md). Najpierw spróbuj niższych stopni: operator może
dodać pole niestandardowe w czasie działania bez żadnego kodu (D0), a tabela poboczna, której
właścicielem jest twój moduł (D1), niczego od gospodarza nie wymaga. Po zadeklarowane kolumny
sięgaj wtedy, gdy wartość należy do wiersza gospodarza — jest z nim odczytywana, indeksowana i
unikalna w jego obrębie.

## Co możesz rozszerzyć

**Rozszerzalne tabele** to dokładnie te tabele, które mają pola niestandardowe — są wyprowadzane z
powiązań gospodarzy pól niestandardowych, nigdy nie wypisuje się ich po raz drugi. W tym wydaniu
otwarta jest jedna:

| Tabela | Moduł-właściciel |
| --- | --- |
| `organizations` | `organizations` |

Pozostałych ośmiu gospodarzy pól niestandardowych (`customer_accounts`, `orders`,
`quote_requests`, `products`, `categories`, `crm_opportunities`, `projects`, `tasks`) zostanie
otwartych w późniejszym wydaniu. Deklaracja w tabeli, która nie jest otwarta, jest odrzucana, gdy
platforma wykrywa pakiet, a komunikat wymienia tabele otwarte.

## Reguły

- **Deklaruje tylko zainstalowany pakiet.** Pakiet modułu z własnego repozytorium platformy jest
  właścicielem swoich tabel albo używa tabeli pobocznej, a moduł nakładkowy wdrożenia nie zawiera
  schematu; generator odrzuca oba przypadki.
- **Musisz zależeć od gospodarza.** Moduł-właściciel gospodarza musi należeć do domknięcia
  `dependencies` twojego manifestu, inaczej deklaracja jest odrzucana (`host-not-a-dependency`).
- **Kolumny są twoje i tylko twoje.** Ich fizyczne nazwy to `x_<moduleId>_<snake_case(klucz)>`;
  zapisuje je wyłącznie kod twojego modułu, przez opisany niżej akcesor, wewnątrz polecenia
  (Command) albo haka polecenia. Gospodarz zachowuje tabelę, jej ograniczenia i każdą kolumnę,
  której nie zadeklarowałeś.
- **Tylko addytywnie.** Kolumna ma typ `text`, `varchar` (z `length`), `boolean`, `smallint`,
  `integer`, `bigint`, `numeric` (z `precision` i `scale`), `date`, `timestamptz`, `uuid` albo
  `jsonb` (ze schematem Zod w `schema`). Dopuszcza `null` albo jest NOT NULL ze stałą wartością
  `default`; `timestamptz` i `jsonb` zawsze dopuszczają `null`. `index: true` tworzy indeks btree,
  `index: 'unique'` — unikalny indeks częściowy po wartościach różnych od `null` (tylko dla kolumn
  dopuszczających `null`). Najwyżej 32 kolumny w deklaracji; nazwa fizyczna dłuższa niż 63 bajty
  jest odrzucana.
- **Dwa klucze są zarezerwowane**: `id` i `organizationId` to własne kolumny gospodarza, które
  platforma mapuje za ciebie; deklaracja z którymkolwiek z nich jest odrzucana (`key`).
- **Nazwy fizyczne są unikalne między modułami.** `x_<moduleId>_<snake_case(klucz)>` może wyjść
  taka sama dla dwóch modułów (`acme` + `erpCode` i `acme_erp` + `code` to w obu przypadkach
  `x_acme_erp_code`); wykrywanie odrzuca drugą deklarację z `physical-name-collision`, podając
  oba moduły. Uzupełnianie danych może ustawiać wyłącznie dokładnie te kolumny, które twój moduł
  deklaruje.
- **Zmiana kolumny nie jest oferowana.** Zmiana typu, dopuszczalności `null` albo wartości
  domyślnej klucza jest odrzucana (`non-additive-change`) — zadeklaruj nowy klucz. Usunięcie
  klucza oznacza jego kolumnę jako osieroconą; kolumna nie jest usuwana.
- **Jeszcze nie oferowane:** filtry i sortowanie list po kolumnach rozszerzeń, dane rozszerzeń w
  treści zapisów HTTP rdzenia, wyszukiwarka, eksporty, pliki PDF, odpowiedzi sklepu i zdarzenia.
  Deklaracja z `filterable` albo `sortable` jest odrzucana jako `not-offered-yet`.

## Przykład

Pakiet `acme_erp` dodaje trzy kolumny do `organizations`. Jego źródła to dane testowe samej
platformy, sprawdzane kompilatorem przy każdym uruchomieniu, więc ta strona nie może się
rozjechać z tym, co się kompiluje.

Deklaracja:

```ts
export const acmeOrganizationColumns = defineColumnExtension({
  host: 'organizations',
  module: 'acme_erp',
  adminReads: true,
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
    onboardedVia: { type: 'text', nullable: true },
  },
});
```

Eksport `./backend` pakietu wymienia ją obok encji:

```ts
export const schemaExtensions = [acmeOrganizationColumns];
export const entities = [];
```

Manifest pakietu zależy od gospodarza: `dependencies: ['organizations']`.

Po `pnpm install` i `migrate` tabela `organizations` ma kolumny `x_acme_erp_erp_code`,
`x_acme_erp_credit_tier` i `x_acme_erp_onboarded_via`, unikalny indeks częściowy na pierwszej z
nich, a rejestr platformy `schema_extensions` zapisuje każdy element. Encja rdzenia
`Organization`, jej odpowiedzi i jej wpisy audytu pozostają bez zmian.

### Zapis z polecenia

`extensionColumns(declaration, em)` zwraca `get(id)`, `load(ids)` i `set(id, patch)`. `set` wykonuje
jedno UPDATE wyłącznie zmienionych kolumn, nigdy nie wstawia wiersza, odmawia działania poza
transakcją i zwraca zmienione **klucze** — nigdy ich wartości — do wpisu audytu:

```ts
export function syncErpCode(organizationId: string, erpCode: string): Command<void> {
  return {
    action: 'acme_erp.organization.sync',
    objectType: 'organization',
    objectId: organizationId,
    async run({ em }) {
      const { changedFields } = await extensionColumns(acmeOrganizationColumns, em).set(
        organizationId,
        columnExtensionPatchSchema(acmeOrganizationColumns).parse({ erpCode }),
      );
      // audit-state D-288: names, never values.
      return { result: undefined, after: { extensions: { acme_erp: { changedFields } } } };
    },
  };
}
```

`ColumnExtensionValues<typeof acmeOrganizationColumns>` to wywnioskowany typ wiersza
(`{ erpCode: string | null; creditTier: number; onboardedVia: string | null }`), a
`columnExtensionSchema` / `columnExtensionPatchSchema` to odpowiadające mu schematy Zod.

Każda metoda akcesora jest uzależniona od obecności twojego modułu: gdy jest wyłączony, każde
wywołanie rzuca `ModuleDisabledError`, a kolumny zachowują wartości.

**Akcesor nie sprawdza uprawnień.** W `organizations`, która jest tabelą globalną, `load`, `get`
i `set` sięgają każdej organizacji po identyfikatorze: nie ma filtra dzierżawy, który by je
zawężał, ani sprawdzenia zasięgu wywołującego. Sprawdź uprawnienia we własnej trasie albo
poleceniu, zanim go wywołasz — tak jak robią to odczyty gospodarza w panelu administracyjnym,
które dołączają wartości rozszerzeń wyłącznie do rekordów, do których już sprawdziły dostęp.

### Uzupełnianie z własnej migracji

Generowany krok wykonuje się na początku bloku migracji twojego modułu, więc twoje własne migracje
wykonują się po nim i mogą uzupełnić twoje kolumny — i tylko twoje kolumny:

```ts
export class Migration20261201T090000AcmeErpBackfillCreditTier extends Migration {
  override async up(): Promise<void> {
    this.addSql(`update "organizations" set "x_acme_erp_credit_tier" = 1 where "vat_status" = 'valid'`);
  }
}
```

### Odczyt na ekranach panelu administracyjnego

Przy `adminReads: true` (domyślnie `false`) odczyty szczegółów i listy organizacji w panelu
administracyjnym przyjmują `?extensions=acme_erp` i dołączają wartości do każdego rekordu:

```
GET /api/v1/admin/organizations/<id>?extensions=acme_erp
→ { "data": { …, "extensions": { "acme_erp": { "erpCode": "ERP-42", "creditTier": 0, "onboardedVia": null } } } }
```

Lista pięćdziesięciu organizacji kosztuje jedno dodatkowe zapytanie na każdy wskazany moduł, a nie
jedno na wiersz. Moduł wyłączony, niezainstalowany albo nieudostępniający gospodarza po prostu nie
występuje w `extensions` i nie powoduje błędu; bez parametru odpowiedź się nie zmienia. Miejscem
na ich pokazanie jest strefa twojego pakietu na ekranie szczegółów organizacji — nie ma nowego
miejsca w interfejsie.

## Migracja, aktualizacja i weryfikacja

Platforma zamienia twoje deklaracje w jeden generowany krok migracji,
`Migration10000101T000000AcmeErpSchemaExtensions<hash12>`, który oczekuje na wykonanie dokładnie
wtedy, gdy deklaracje się zmieniają. Krok uzgadnia je z rejestrem — dodaje brakujące elementy,
przejmuje pasującą kolumnę, która już istnieje, ponownie dołącza osieroconą o niezmienionej
specyfikacji i odrzuca wszystko, co nieaddytywne. `migrate up` i `install` cyklu życia sprawdzają
każdą zadeklarowaną kolumnę i indeks wewnątrz transakcji migracji, więc przebieg, który którąś
utraci, jest wycofywany, a backend odmawia startu przy rozjeździe, podając moduł, kolumnę, tabelę i
ostatnią wykonaną migrację właściciela tabeli.

Rdzeń dotrzymuje swojej strony umowy w CI: każda migracja rdzenia jest wykonywana po kolei na
świeżej bazie danych z przykładowymi kolumnami rozszerzeń w każdej otwartej rozszerzalnej tabeli, a
migracja, która którąś utraci, przerywa build.

**Uwaga dla operatora.** Dodanie kolumny dopuszczającej `null` albo ze stałą wartością domyślną
zmienia w PostgreSQL wyłącznie katalog. Budowa indeksu blokuje tabelę na czas budowy, w trakcie
`migrate`; przy dużych tabelach zaplanuj to odpowiednio.

## Odinstalowanie i usunięcie

```bash
pnpm --filter backend run module:schema-extensions list
pnpm --filter backend run module:uninstall acme_erp --hard                 # kolumny zostają, rejestr: orphaned
pnpm --filter backend run module:schema-extensions drop acme_erp           # wypisuje plan
pnpm --filter backend run module:schema-extensions drop acme_erp --confirm # usuwa, jeden wpis audytu
```

Odinstalowanie twojego modułu zachowuje jego kolumny wraz z wartościami; usuwa je wyłącznie jawne,
audytowane `drop … --confirm`, i to tylko dla elementów osieroconych i już niedeklarowanych.

**Pakiet usunięty bez `module:uninstall --hard`** — skasowany z zależności instancji — jest
obsługiwany przy następnym `migrate`: jego wiersze w rejestrze są oznaczane jako osierocone (a jego
generowany krok znika z historii migracji), więc `drop … --confirm` może po nim posprzątać. Ten
`migrate` niczego nie usuwa, a jeśli ten sam pakiet wróci, jego kolumny zostaną ponownie dołączone.
Start backendu nigdy nie zmienia rejestru; jedynie ostrzega o osieroconych kolumnach.
Odinstalowanie gospodarza, gdy twój moduł jest zainstalowany, jest odrzucane z
`dependents-block`.

## Czego migracja pakietu robić nie może

Deklaracja to jedyna droga do tabeli rdzenia. Każda migracja dostarczana przez zainstalowany
pakiet wykonuje się wewnątrz strażnika obcego schematu platformy, który odrzuca — i wycofuje
przebieg `migrate` — każdą instrukcję zapisującą tabelę, której właścicielem nie jest twój moduł:
`alter table "organizations"`, indeks na niej, `insert` do `orders`, politykę na niej. Strażnik
czyta każdą drogę zapisu, jaką ma migracja: to, co przekazuje do `addSql` i `execute`, bloki
`do $$ … $$`, ciała tworzonych przez nią funkcji, ciągi wykonywane przez `execute` w PL/pgSQL oraz
`getEntityManager()` — jego `flush`, skróty `insert*`, `upsert*`, `native*` i `execute`, buildery
zapytań, połączenie i rozwidlenia. `execute` w PL/pgSQL na obliczanym ciągu (`format(…)`, zmienna)
i surowe `getKnex()` menedżera encji nie dają się przypisać tabeli i są odrzucane.
`create table if not exists` na tabeli mapowanej przez encję innego modułu nie tworzy niczego, co
wolno ci potem zmieniać, a **żadna twoja migracja nie może usunąć, wyczyścić (`truncate`) ani
`alter … drop` tabeli mapowanej przez encję innego modułu — ani w `up()`, ani w `down()`,
niezależnie od tego, co sama utworzyła** — więc twardo odinstalowany pakiet nigdy nie zabierze ze
sobą tabeli innego modułu.

Tabela jest twoja, gdy mapuje ją jedna z twoich encji albo tworzy ją jedna z twoich migracji i nie
mapuje jej encja żadnego innego modułu. **Strażnik działa w trybie odmowy domyślnej**: tabela,
której nie da się przypisać twojemu modułowi, jest odrzucana, a nie dopuszczana — mapuj więc swoje
tabele encjami i twórz każdą używaną tabelę we własnych migracjach. Dozwolone są własne tabele, tabele platformy i uzupełnianie własnych kolumn
`x_<moduleId>_*` w zadeklarowanym gospodarzu; reguły są na stronie [Migracje](./migrations.md), w
sekcji *Strażnik obcego schematu*.

Aby przed aktualizacją sprawdzić, czego wydanie by odmówiło:

```bash
pnpm --filter backend run module:schema-extensions audit-packages
```

## Pakowanie

Pakietów lokalnych dla instancji jeszcze nie ma: zbuduj moduł, wykonaj `pnpm pack` i zainstaluj
archiwum w instancji, tak jak każdy inny pakiet modułu.
