---
title: Prompt Actions (AI assistant)
description: Tryb poleceń naturalnych w palecie poleceń admina, z jawnym krokiem podglądu i potwierdzenia przed każdą zmianą
---

# Prompt Actions (AI assistant)

Moduł `prompt_actions` dodaje tryb poleceń naturalnych do palety poleceń
admina (`⌘K` / `Ctrl+K`). Operator opisuje, czego chce, po polsku lub
po angielsku — platforma interpretuje instrukcję, pokazuje dokładnie, co
zamierza zmienić, i wykonuje to dopiero po wyraźnym potwierdzeniu.

Przykładowe prompty:

- *Dla produktu „Bolts 0193" zwiększ stan magazynowy w magazynie „Default" na 120 sztuk*
- *Assign every product with "Helmets" in its name to the "Helmets" category*

## Jak to działa (widok operatora)

1. Otwórz paletę i wybierz **Ask the assistant…** (widoczne tylko gdy funkcja
   jest włązczona, skonfigurowana i masz uprawnienie *Use the prompt
   assistant*).
2. Wpisz instrukcję i wyślij. Asystent rozwiązuje nazwy („Bolts
   0193", „Default") do konkretnych rekordów przez wyszukiwania read-only.
3. Pojawia się **karta planu**: dokładne operacje, bieżąca wartość, liczba
   dotkniętych rekordów i próbka dla zmian masowych. Nic jeszcze nie zostało
   zmienione.
4. **Confirm** wykonuje plan, **Cancel** zostawia wszystko nietknięte. Plany
   wygasają po 10 minutach bez potwierdzenia.
5. Wynik raportuje per-item. Uruchomienia masowe powyżej 50 rekordów idą w
   tle; jeśli zamkniesz paletę, przy następnym otwarciu pojawi się notice,
   dopóki nie zobaczysz wyniku.

Gdy instrukcja jest niejednoznaczna, asystent zadaje jedno pytanie doprecyzowujące
(z konkretnymi kandydatami) zamiast zgadywać. Nieobsługiwane prośby i brak
uprawnień są raportowane wprost — nic się nie zmienia.

## Model bezpieczeństwa

- Model może wołać tylko **kurated tool catalogue** zarejestrowany w kodzie —
  nie może uruchamiać SQL, dowolnych endpointów ani wymyślać operacji. Narzędzia,
  do których operator nie ma uprawnienia, w ogóle nie są pokazywane modelowi.
- Mutacje **nigdy nie są wykonywane podczas interpretacji**: trafiają do planu;
  każda operacja planu ponownie sprawdza live permission operatora w momencie
  wykonania.
- Wszystko na karcie planu jest **server-computed** (nazwy, liczniki, bieżące
  wartości). Proza modelu nigdy nie jest wyświetlana, a wyniki narzędzi traktuje
  się ściśle jako dane — produkt nazwany jak instrukcja nie może zmienić
  zachowania asystenta.
- Każde wykonanie zapisuje wpisy audytu: podsumowanie `prompt_action.execute`
  (z oryginalnym promptem, providerem i modelem) plus własne wiersze audytu
  modułów pod spodem (np. `stock_level.adjust`). Odmowy uprawnień audytuje
  `prompt_action.refused`. Wykonania pojawiają się też na karcie Recent Activity
  dashboardu.

## Konfiguracja (administrator platformy)

Settings → grupa **Prompt actions (AI assistant)**:

| Setting | Default | Meaning |
|---------|---------|---------|
| `prompt_actions.enabled` | `false` | Kill switch platformy. Gdy off, paleta zachowuje się jak bez modułu. |
| `prompt_actions.provider` | `anthropic` | Provider LLM: `anthropic` (Claude), `google` (Gemini) lub `openai` (GPT). |
| `prompt_actions.model` | `claude-sonnet-4-6` | ID modelu dla wybranego providera. |
| `prompt_actions.api_key` | *(unset)* | Credential providera. **Write-only secret**: szyfrowany at rest, nigdy nie zwracany przez API settings po zapisie. |
| `prompt_actions.bulk_limit` | `500` | Maksymalna liczba rekordów, które jeden prompt może dotknąć; większe plany są blokowane na podglądzie. |

Zmiany konfiguracji obowiązują przy następnym prompcie — bez restartu. Backend
potrzebuje `SETTINGS_SECRET_ENCRYPTION_KEY` w środowisku, żeby przechować klucz
API (patrz root README, *Environment variables*).

Przyznaj operatorom uprawnienie **Use the prompt assistant** (`prompt_actions:use`)
na ekranie Roles. Każda planowana operacja wymaga dodatkowo tego samego uprawnienia
co ręczna akcja (np. `catalog:write` przy zmianie stocku), więc asystent nigdy
nie przekroczy tego, co operator mógłby zrobić ręcznie.

## Rozszerzanie katalogu (autorzy modułów)

Moduły dokładają narzędzia w czasie kompozycji przez port
`PromptActionToolRegistry` — ten sam wzorzec adapter registry co u providerów
płatności i wysyłki. Narzędzie deklaruje:

```ts
{
  id: '<moduleId>.<snake_case_name>',   // e.g. 'inventory.set_stock_level'
  moduleId: 'inventory',
  kind: 'resolver' | 'mutation',
  description: '…',                      // English; the LLM's only documentation
  requiredPermission: 'catalog:write',   // MUST mirror the manual route's permission
  paramsSchema: zodSchema,               // validates LLM args + becomes the JSON Schema
  execute(params, ctx) { … },            // resolvers run during interpretation;
                                         // mutations only at confirm time
  preview(params, ctx) { … },            // mutations only — server-computed facts
}
```

Reguły (egzekwowane przy rejestracji, gdzie możliwe): kropkowe id z prefiksem
modułu właściciela; resolvery są side-effect-free i capują wyniki (≤ 20);
mutacje muszą implementować `preview()` z uczciwymi, server-computed
licznikami i próbkami; narzędzia wyłączonych modułów znikają z katalogu
automatycznie. Pełny kontrakt contribution i HTTP API:
`specs/043-admin-prompt-actions/contracts/prompt-actions-api.md`.

## Katalog narzędzi v1

| Tool | Kind | Permission |
|------|------|------------|
| `catalog.search_products` | resolver | `catalog:read` |
| `catalog.search_categories` | resolver | `catalog:read` |
| `inventory.search_warehouses` | resolver | `catalog:read` |
| `inventory.set_stock_level` | mutation | `catalog:write` |
| `catalog.assign_products_to_category` | mutation | `catalog:write` |

Masowe przypisania kategorii powyżej 50 produktów idą istniejącą kolejką
`catalog.bulk-operation` (ten sam worker co ekran bulk-edit), więc duże prompty
nigdy nie blokują procesu API.
