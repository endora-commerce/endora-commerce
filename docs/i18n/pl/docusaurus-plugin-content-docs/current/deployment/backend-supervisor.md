---
title: Nadzorca procesu backendu
sidebar_label: Nadzorca backendu
description: Jak obraz backendu restartuje API, które działa, ale przestało odpowiadać, jak czysto się zatrzymuje i jakie zmienne to stroją.
---

# Nadzorca procesu backendu

Obraz backendu nie uruchamia API bezpośrednio. Jego poleceniem jest mały proces nadzorujący,
`backend/scripts/supervise.mjs`, który uruchamia `dist/index.js` jako proces potomny i go obserwuje.
To ten sam nadzorca, którego używa obraz storefrontu — zobacz
[Nadzorca procesu storefrontu](./storefront-supervisor.md) — z własnym adresem, portem, zmiennymi
i czasem zatrzymania backendu.

## Dlaczego istnieje

Polityka `restart: unless-stopped` w Dockerze restartuje kontener, którego główny proces się
**zakończył**. Nie robi nic z kontenerem, który jest jedynie `unhealthy`. Backend, którego proces
działa, ale przestał odpowiadać — bo jego pętla zdarzeń jest zablokowana albo każde żądanie
utknęło — zostaje oznaczony jako `unhealthy` i pozostaje niedostępny, dopóki ktoś tego nie
zauważy. W domyślnym `BACKEND_ROLE=all` konsumenci kolejek działają w tym samym procesie, więc
zawieszone API zatrzymuje też każde zadanie w tle.

Serwer nie może pilnować sam siebie: timer w zablokowanym procesie nigdy się nie uruchamia, a proces
będący PID 1 swojego kontenera nie może zabić sam siebie sygnałem `SIGKILL`. Osobny proces
nadrzędny ma własną pętlę zdarzeń i zawsze może zabić proces potomny.

## Co robi

1. Uruchamia `dist/index.js` jako proces potomny. Wyjście API trafia do logu kontenera jak dotąd.
2. Po okresie startowym wysyła w stałych odstępach żądanie HTTP `GET` na `/api/v1/_health`, zawsze
   jedno naraz.
3. Traktuje **każdą odpowiedź HTTP** jako odpowiedź, niezależnie od statusu. Trasa zdrowia
   odpowiada `503`, gdy baza danych, Redis albo Meilisearch nie działa; oznacza to, że API żyje,
   a restart nie przywróciłby zależności. Za niepowodzenie uznawane jest tylko odrzucone
   połączenie, zerwane połączenie albo brak odpowiedzi w limicie czasu.
4. Po ustawionej liczbie **kolejnych** niepowodzeń wysyła do API `SIGTERM`, a jeśli API nadal
   działa po upływie czasu na zakończenie — `SIGKILL`, i kończy pracę z kodem `1`. Polityka
   restartu uruchamia wtedy nowy kontener.
5. Przekazuje do API sygnały `SIGTERM`, `SIGINT` i `SIGHUP` i kończy pracę z kodem wyjścia API, więc
   `docker stop` działa jak dotąd. Podczas zatrzymywania nie jest wykonywane żadne zapytanie.

Każda decyzja jest zapisywana jako jedna linia zaczynająca się od `backend-supervisor:`, na
przykład:

```text
backend-supervisor: probe failed (3/3): no answer within 5000 ms
backend-supervisor: the server did not answer 3 consecutive probes of http://127.0.0.1:3001/api/v1/_health; sending SIGTERM
backend-supervisor: the server was ended by SIGKILL after it stopped answering; exiting with 1
```

Udane zapytania nie są logowane, z wyjątkiem pierwszego i pierwszego po niepowodzeniu.

## Czyste zatrzymanie

Po `SIGTERM` backend zamyka serwer HTTP i pozwala konsumentom kolejek dokończyć zadania, które
właśnie wykonują. Nadzorca czeka na to do **25 sekund**, zanim wyśle `SIGKILL`, i rezygnuje
5 sekund później. Własny limit czasu zatrzymania w Dockerze to 10 sekund, o ile usługa nie
ustawia innego, dlatego dostarczane przykłady compose ustawiają w usłudze backendu
`stop_grace_period: 30s`. Jeśli zwiększysz `BACKEND_SUPERVISOR_KILL_GRACE_SECONDS`, zwiększ
`stop_grace_period` co najmniej do tej wartości plus 5 sekund, inaczej Docker zabije kontener,
zanim konsumenci skończą.

## Konfiguracja

Każda zmienna jest opcjonalna; ustawienia domyślne nie wymagają konfiguracji. Ustawia się je
w bloku `environment` usługi `backend`. Wartość, której nadzorca nie potrafi odczytać, zatrzymuje
kontener przy starcie z komunikatem wskazującym zmienną — nigdy nie jest zgadywana.

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `BACKEND_SUPERVISOR_PROBE` | `on` | `off` (albo `false`, `0`, `no`) wyłącza zapytania. Nadzorca nadal przekazuje sygnały i kod wyjścia. |
| `BACKEND_SUPERVISOR_PROBE_URL` | `http://127.0.0.1:${PORT}/api/v1/_health` | Odpytywany adres. Musi być bezwzględnym adresem `http` lub `https`. |
| `BACKEND_SUPERVISOR_INTERVAL_SECONDS` | `10` | Przerwa między końcem jednego zapytania a początkiem następnego. |
| `BACKEND_SUPERVISOR_TIMEOUT_SECONDS` | `5` | Jak długo jedno zapytanie czeka na odpowiedź. |
| `BACKEND_SUPERVISOR_FAILURES` | `3` | Liczba kolejnych niepowodzeń, po której API zostaje zakończone. Każda odpowiedź zeruje licznik. |
| `BACKEND_SUPERVISOR_START_GRACE_SECONDS` | `30` | Niepowodzenia w tym oknie po starcie nie są liczone. Okno kończy się też przy pierwszej odpowiedzi. |
| `BACKEND_SUPERVISOR_KILL_GRACE_SECONDS` | `25` | Po jakim czasie od `SIGTERM` API zostaje zabite sygnałem `SIGKILL`. Utrzymuj tę wartość co najmniej 5 sekund poniżej `stop_grace_period` usługi. |

Dopuszczalne są ułamki sekund. `PORT` to ta sama zmienna, na której nasłuchuje API (`3001`
w obrazie).

### Czego zapytanie nie obejmuje

`/api/v1/_health` sprawdza bazę danych bez własnego limitu czasu. Baza, która przyjmuje połączenie,
ale nie odpowiada na zapytanie dłużej niż wynosi limit czasu zapytania nadzorcy, wygląda więc jak
zawieszone API, a trzy takie zapytania z rzędu restartują backend. Jeśli zdarza się to na twoim
serwerze, zwiększ `BACKEND_SUPERVISOR_TIMEOUT_SECONDS`, zamiast wyłączać zapytania.

### Ile trwa przywrócenie

Przy ustawieniach domyślnych API, które przestało odpowiadać, zostaje zakończone w ciągu około
`FAILURES × (INTERVAL + TIMEOUT) + KILL_GRACE` = 3 × (10 + 5) + 25 = **70 sekund**, plus czas
ponownego startu kontenera.

## Uruchamiaj z procesem init

Bez procesu init nadzorca jest PID 1 kontenera. Obsługuje sygnały, które przekazuje, więc
`docker stop` działa. Nie zbiera natomiast procesów osieroconych przez API — to zadanie procesu
init. Dlatego dostarczane przykłady compose ustawiają `init: true` w usłudze backendu. Dla
kontenera uruchamianego ręcznie użyj `docker run --init`.

## Co nie jest nadzorowane

- **Zadania jednorazowe.** `backend-migrate` i `backend-install` nadpisują polecenie własnym
  (`node dist/db/migrate.js up`, `node dist/lifecycle/scripts/install.js --all`). Ich kod wyjścia
  jest ich wynikiem i działają bez nadzorcy.
- **Osobna warstwa workerów.** Gdy API działa z `BACKEND_ROLE=api`, konsumenci kolejek działają
  we własnej usłudze z `command: ['node', 'dist/worker.js']`. Ten proces nigdy nie nasłuchuje, więc
  zapytanie mogłoby się tylko nie powieść; działa bez nadzorcy, a gdy się zakończy, obejmuje go
  polityka restartu. Zobacz [Konsumenci kolejek](../operations/queue-consumers.md).
