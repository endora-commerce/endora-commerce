---
title: Asystent AI (Prompt Actions)
description: Polecenia w języku naturalnym w palecie poleceń panelu administracyjnego, z jawnym podglądem i potwierdzeniem przed każdą zmianą
---

# Asystent AI (Prompt Actions)

Moduł `prompt_actions` dodaje do palety poleceń panelu administracyjnego (`⌘K` / `Ctrl+K`) tryb
poleceń w języku naturalnym. Operator opisuje, czego chce, po polsku albo po angielsku — platforma
interpretuje polecenie, pokazuje dokładnie, co zamierza zmienić, i wykonuje to dopiero po wyraźnym
potwierdzeniu.

Przykładowe polecenia:

- *Dla produktu „Bolts 0193" zwiększ stan magazynowy w magazynie „Default" na 120 sztuk*
- *Assign every product with "Helmets" in its name to the "Helmets" category*

## Jak to działa (z perspektywy operatora)

1. Otwórz paletę i wybierz **Ask the assistant…** (widoczne tylko wtedy, gdy funkcja jest włączona
   i skonfigurowana, a ty masz uprawnienie *Use the prompt assistant*).
2. Wpisz polecenie i wyślij. Asystent zamienia nazwy („Bolts 0193", „Default”) na konkretne
   rekordy, korzystając wyłącznie z wyszukiwań tylko do odczytu.
3. Pojawia się **karta planu**: dokładne operacje, bieżąca wartość, liczba rekordów, których dotyczy
   zmiana, i próbka przy zmianach masowych. Na tym etapie nic jeszcze nie zostało zmienione.
4. **Confirm** wykonuje plan, **Cancel** niczego nie zmienia. Niepotwierdzone plany wygasają po 10
   minutach.
5. Wynik jest raportowany dla każdej pozycji osobno. Operacje masowe obejmujące ponad 50 rekordów
   działają w tle; jeśli zamkniesz paletę, przy następnym otwarciu zobaczysz powiadomienie, dopóki
   nie obejrzysz wyniku.

Gdy polecenie jest niejednoznaczne, asystent zadaje jedno pytanie doprecyzowujące (z konkretnymi
propozycjami), zamiast zgadywać. Nieobsługiwane prośby i brak uprawnień są zgłaszane wprost — nic
się wtedy nie zmienia.

## Bezpieczeństwo

- Model może wywoływać tylko **wybrany katalog narzędzi** zarejestrowany w kodzie — nie może
  uruchamiać SQL, wywoływać dowolnych endpointów ani wymyślać operacji. Narzędzia, do których
  operator nie ma uprawnień, w ogóle nie są pokazywane modelowi.
- Zmiany **nigdy nie są wykonywane podczas interpretacji**: trafiają do planu, a każda operacja z
  planu w chwili wykonania ponownie sprawdza bieżące uprawnienia operatora.
- Wszystko na karcie planu **oblicza serwer** (nazwy, liczby, bieżące wartości). Tekst wygenerowany
  przez model nigdy nie jest wyświetlany, a wyniki narzędzi są traktowane wyłącznie jako dane —
  produkt nazwany jak polecenie nie może zmienić zachowania asystenta.
- Każde wykonanie zapisuje wpisy audytu: podsumowanie `prompt_action.execute` (z oryginalnym
  poleceniem, dostawcą i modelem) oraz własne wpisy audytu modułów, które wykonały zmianę (np.
  `stock_level.adjust`). Odmowy z powodu uprawnień audytuje `prompt_action.refused`. Wykonania
  pojawiają się też na karcie Recent Activity na pulpicie.

## Konfiguracja (administrator platformy)

Ustawienia → grupa **Prompt actions (AI assistant)**:

| Ustawienie | Wartość domyślna | Znaczenie |
|---------|---------|---------|
| `prompt_actions.enabled` | `false` | Główny wyłącznik w platformie. Gdy wyłączony, paleta działa tak, jakby modułu nie było. |
| `prompt_actions.provider` | `anthropic` | Dostawca modelu językowego: `anthropic` (Claude), `google` (Gemini) albo `openai` (GPT). |
| `prompt_actions.model` | `claude-sonnet-4-6` | Identyfikator modelu u wybranego dostawcy. |
| `prompt_actions.api_key` | *(nieustawione)* | Dane uwierzytelniające u dostawcy. **Sekret tylko do zapisu**: szyfrowany w bazie i nigdy nie zwracany przez API ustawień po zapisaniu. |
| `prompt_actions.bulk_limit` | `500` | Największa liczba rekordów, które może zmienić jedno polecenie; większe plany są blokowane już na etapie podglądu. |

Zmiany konfiguracji obowiązują od następnego polecenia — bez restartu. Aby zapisać klucz API, backend
potrzebuje w środowisku zmiennej `SETTINGS_SECRET_ENCRYPTION_KEY` (zobacz główny README, sekcja
*Environment variables*).

Przyznaj operatorom uprawnienie **Use the prompt assistant** (`prompt_actions:use`) na ekranie ról.
Każda zaplanowana operacja wymaga dodatkowo tego samego uprawnienia co odpowiadająca jej czynność
ręczna (np. `catalog:write` przy zmianie stanu magazynowego), więc asystent nigdy nie zrobi więcej,
niż operator mógłby zrobić ręcznie.

## Rozszerzanie katalogu (dla autorów modułów)

Moduły dodają narzędzia podczas kompozycji przez port `PromptActionToolRegistry` — ten sam wzorzec
rejestru adapterów co przy dostawcach płatności i wysyłki. Narzędzie deklaruje:

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

Reguły (egzekwowane przy rejestracji, tam gdzie to możliwe): identyfikator z kropką i przedrostkiem
modułu-właściciela; narzędzia wyszukujące nie mają skutków ubocznych i ograniczają liczbę wyników
(≤ 20); narzędzia zmieniające dane muszą implementować `preview()` z rzetelnymi liczbami i próbkami
obliczonymi przez serwer; narzędzia wyłączonych modułów automatycznie znikają z katalogu.

## Katalog narzędzi w wersji 1

| Narzędzie | Rodzaj | Uprawnienie |
|------|------|------------|
| `catalog.search_products` | wyszukiwanie | `catalog:read` |
| `catalog.search_categories` | wyszukiwanie | `catalog:read` |
| `inventory.search_warehouses` | wyszukiwanie | `catalog:read` |
| `inventory.set_stock_level` | zmiana | `catalog:write` |
| `catalog.assign_products_to_category` | zmiana | `catalog:write` |

Masowe przypisania do kategorii obejmujące ponad 50 produktów trafiają do istniejącej kolejki
`catalog.bulk-operation` (ten sam worker co ekran masowej edycji), więc duże polecenia nigdy nie
blokują procesu API.
