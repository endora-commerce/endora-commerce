---
title: Zablokowana blokada cyklu życia modułu
---

# Zablokowana blokada cyklu życia modułu

CLI cyklu życia modułu (`pnpm module:install`, `pnpm module:uninstall`, `pnpm module:enable`,
`pnpm module:disable`) serializuje każdą operację zmieniającą stan przez jeden klucz Redis.
Crash procesu może zostawić ten klucz (albo wiersz rejestru pod spodem) w stanie blokującym
kolejne polecenia. Ten runbook opisuje wykrywanie i odzyskiwanie.

## Objawy

- Polecenie cyklu życia kończy się kodem **75** i komunikatem *"lifecycle lock is held by another process"*.
- Ponowienie polecenia (po kilku minutach) nadal daje ten sam błąd exit-75, choć żaden inny
  operator nie powinien nic uruchamiać.
- `pnpm module:status --json | jq '.modules[] | select(.state == "installing")'` listuje
  jeden lub więcej modułów utkniętych w `installing`.

## Wykrywanie

```bash
# Inspect the lock directly.
redis-cli get b2b:module:lifecycle:lock
redis-cli ttl b2b:module:lifecycle:lock
```

Możliwe wyniki:

| Wynik | Diagnoza |
| --- | --- |
| `(nil)` | Blokada wolna. Exit-75 musi pochodzić ze stale wiersza rejestru `installing` — zob. „Utknięty wiersz rejestru” poniżej. |
| Niepusta wartość, TTL > 0 (np. `283`) | Inny proces legalnie trzyma blokadę. Poczekaj na wygaśnięcie TTL albo zakończenie holdera. |
| Niepusta wartość, TTL `-1` (brak TTL) | Anomalia — klucz ustawiony bez wygaśnięcia. Ręczne usunięcie jest bezpieczne. |
| Niepusta wartość, TTL > 300 sekund | Anomalia — lease przedłużony ponad skonfigurowany sufit. Traktuj jako utknięty. |

Skonfigurowany TTL to **5 minut**, odświeżany co 60 sekund podczas działania polecenia.
Wartość obecna dłużej niż ~6 minut wskazuje na crash holdera.

## Odzyskiwanie — utknięta blokada Redis

**Warunek wstępny**: potwierdź, że żaden operator nie uruchamia aktualnie polecenia cyklu życia.

```bash
# 1. Check active sessions on the box that runs the backend.
ps -ef | grep -E "tsx.*_lifecycle/scripts" | grep -v grep

# 2. If no live process, delete the stale key.
redis-cli del b2b:module:lifecycle:lock
```

Po usunięciu ponów oryginalne polecenie cyklu życia.

## Odzyskiwanie — utknięty wiersz rejestru `installing`

Wiersz w `module_registrations` ze `state='installing'` oznacza polecenie, które
wystartowało, ale nie doszło do `installed` ani `uninstalled`. Polecenia cyklu życia
odmawiają operacji na module w tym stanie (exit 75 z „stale `installing` record”).

```bash
# Identify the offending row(s).
psql "$DATABASE_URL" -c \
  "select module_id, state, last_install_failed_at, last_install_error
   from module_registrations
   where state = 'installing';"
```

Jeśli `last_install_failed_at` wiersza jest świeże (w ciągu minut), daj orchestratorowi
szansę na rollback własnej transakcji — sprawdź ponownie po kilku sekundach.

Jeśli wiersz zostaje w `installing` w nieskończoność:

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

Następnie ponownie uruchom `pnpm --filter backend run module:install <module-id>`. Ścieżka
install jest idempotentna — już zastosowane migracje są pomijane, ustawienia uzgadniają się z
manifestem, a wiersz rejestru przechodzi na `installed`.

## Zapobieganie

Orchestrator już obejmuje znane tryby crash (transakcyjny install z revert migracji przy
błędzie, błędy hooka uninstall, naruszenia zależności). Pozostaje ryzyko zakończenia procesu
podczas hooka (np. SIGKILL, OOM). Aby je ograniczyć:

- Uruchamiaj polecenia cyklu życia na hoście z co najmniej udokumentowanym budżetem pamięci
  (`README.md` § Hardware & system requirements).
- Unikaj równoległego `module:install` modułu, którego hook install robi ciężką pracę, z
  innymi ciężkimi operacjami.
- Dla modułów z hookami dłuższymi niż ~30 sekund preferuj enqueue ciężkiej pracy jako job
  BullMQ zamiast uruchamiania jej bezpośrednio w hooku install.

## Eskalacja

Jeśli powyższe kroki nie odzyskują systemu, zbierz:

- Wynik `redis-cli get b2b:module:lifecycle:lock` i `redis-cli ttl b2b:module:lifecycle:lock`.
- Pełny wiersz `module_registrations` dla dotkniętego modułu.
- Ostatnie 20 wpisów audit log dla tego modułu (`object_id = '<module-id>'`).
- Logi aplikacji backend wokół timestampu utkniętego polecenia.

Otwórz ticket do zespołu platformy z tym pakietem.
