---
title: Zawieszona blokada cyklu życia modułu
---

# Zawieszona blokada cyklu życia modułu

Polecenia cyklu życia modułu (`pnpm module:install`, `pnpm module:uninstall`, `pnpm module:enable`,
`pnpm module:disable`) wykonują operacje zmieniające stan po kolei, pilnując tego jednym kluczem w
Redis. Awaria procesu może zostawić ten klucz (albo wiersz rejestru, który chroni) w stanie
blokującym kolejne polecenia. Ta instrukcja opisuje, jak to wykryć i naprawić.

## Objawy

- Polecenie cyklu życia kończy się kodem **75** i komunikatem *"lifecycle lock is held by another process"*.
- Ponowienie polecenia (po kilku minutach) nadal kończy się kodem 75, choć żaden inny operator nie
  powinien niczego uruchamiać.
- `pnpm module:status --json | jq '.modules[] | select(.state == "installing")'` wypisuje jeden
  lub więcej modułów, które utknęły w stanie `installing`.

## Wykrywanie

```bash
# Inspect the lock directly.
redis-cli get b2b:module:lifecycle:lock
redis-cli ttl b2b:module:lifecycle:lock
```

Możliwe wyniki:

| Wynik | Diagnoza |
| --- | --- |
| `(nil)` | Blokada jest wolna. Kod 75 musi wynikać z przeterminowanego wiersza rejestru w stanie `installing` — zobacz „Wiersz rejestru, który utknął w stanie `installing`” niżej. |
| Wartość niepusta, TTL > 0 (np. `283`) | Blokadę prawidłowo trzyma inny proces. Poczekaj, aż TTL wygaśnie albo proces się zakończy. |
| Wartość niepusta, TTL `-1` (brak TTL) | Nieprawidłowość — klucz ustawiono bez terminu wygaśnięcia. Można go bezpiecznie usunąć ręcznie. |
| Wartość niepusta, TTL > 300 sekund | Nieprawidłowość — dzierżawę przedłużono ponad skonfigurowany limit. Traktuj blokadę jako zawieszoną. |

Skonfigurowany TTL to **5 minut**, odświeżany co 60 sekund, dopóki polecenie działa. Wartość
obecna dłużej niż ok. 6 minut oznacza, że proces trzymający blokadę uległ awarii.

## Naprawa — zawieszona blokada w Redis

**Warunek wstępny**: upewnij się, że żaden operator nie uruchamia teraz polecenia cyklu życia.

```bash
# 1. Check active sessions on the box that runs the backend.
ps -ef | grep -E "tsx.*_lifecycle/scripts" | grep -v grep

# 2. If no live process, delete the stale key.
redis-cli del b2b:module:lifecycle:lock
```

Po usunięciu klucza uruchom ponownie pierwotne polecenie cyklu życia.

## Naprawa — wiersz rejestru, który utknął w stanie `installing`

Wiersz w `module_registrations` ze `state='installing'` oznacza polecenie, które się rozpoczęło, ale
nie doszło ani do `installed`, ani do `uninstalled`. Polecenia cyklu życia odmawiają działania na
module w tym stanie (kod 75 z komunikatem „stale `installing` record”).

```bash
# Identify the offending row(s).
psql "$DATABASE_URL" -c \
  "select module_id, state, last_install_failed_at, last_install_error
   from module_registrations
   where state = 'installing';"
```

Jeśli `last_install_failed_at` w wierszu jest świeże (sprzed kilku minut), daj mechanizmowi cyklu
życia czas na wycofanie własnej transakcji — sprawdź ponownie po kilku sekundach.

Jeśli wiersz pozostaje w stanie `installing` bez końca:

```bash
# 1. Audit-log the cause if possible.
psql "$DATABASE_URL" -c \
  "select created_at, action, object_id, state_after
   from audit_log_entries
   where object_id = '<module-id>'
     and action like 'module.%'
   order by created_at desc
   limit 5;"

# 2. Either re-attempt install (the orchestrator's rollback will
#    cover the partial state on its own) ...
pnpm --filter backend run module:install <module-id>

# 3. ... OR, if the rollback never runs, manually flip the row to
#    'uninstalled' so a fresh install can take it from there.
psql "$DATABASE_URL" -c \
  "update module_registrations
      set state = 'uninstalled',
          last_state_change_at = now()
    where module_id = '<module-id>'
      and state = 'installing';"
```

Następnie uruchom ponownie `pnpm --filter backend run module:install <module-id>`. Instalacja jest
idempotentna — wykonane już migracje są pomijane, ustawienia są uzgadniane z manifestem, a wiersz
rejestru przechodzi w stan `installed`.

## Zapobieganie

Mechanizm cyklu życia obsługuje już znane rodzaje awarii (transakcyjna instalacja z wycofaniem
migracji po błędzie, błędy hooka odinstalowania, naruszenie zależności). Pozostaje ryzyko, że proces
zostanie zakończony w trakcie hooka (np. SIGKILL, brak pamięci). Aby je ograniczyć:

- Uruchamiaj polecenia cyklu życia na maszynie z co najmniej udokumentowaną ilością pamięci
  (`README.md` § Hardware & system requirements).
- Nie uruchamiaj `module:install` modułu, którego hook instalacyjny wykonuje ciężką pracę,
  równolegle z innymi ciężkimi operacjami.
- W modułach, których hooki trwają dłużej niż ok. 30 sekund, dodawaj ciężką pracę do kolejki jako
  zadanie BullMQ, zamiast wykonywać ją bezpośrednio w hooku instalacyjnym.

## Eskalacja

Jeśli powyższe kroki nie pomogą, zbierz:

- Wynik `redis-cli get b2b:module:lifecycle:lock` i `redis-cli ttl b2b:module:lifecycle:lock`.
- Pełny wiersz `module_registrations` dla danego modułu.
- Ostatnie 20 wpisów dziennika audytu dla tego modułu (`object_id = '<module-id>'`).
- Logi backendu z okresu wokół czasu uruchomienia polecenia, które utknęło.

Zgłoś problem zespołowi platformy, dołączając te informacje.
