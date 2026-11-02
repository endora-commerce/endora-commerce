---
title: Nadzorca procesu storefrontu
sidebar_label: Nadzorca storefrontu
description: Jak obraz storefrontu restartuje serwer, który działa, ale przestał odpowiadać, i jakie zmienne to stroją.
---

# Nadzorca procesu storefrontu

Obraz storefrontu nie uruchamia serwera Next.js bezpośrednio. Jego poleceniem jest mały proces
nadzorujący, `storefront/scripts/supervise.mjs`, który uruchamia serwer jako proces potomny
i go obserwuje. Ta strona wyjaśnia, dlaczego tak jest, co nadzorca robi oraz jak go dostroić
lub wyłączyć.

## Dlaczego istnieje

Polityka `restart: unless-stopped` w Dockerze restartuje kontener, którego główny proces się
**zakończył**. Nie robi nic z kontenerem, który jest jedynie `unhealthy`. Storefront, którego proces
działa, ale przestał odpowiadać — bo jego pętla zdarzeń jest zablokowana albo każde żądanie
utknęło — zostaje oznaczony jako `unhealthy` i pozostaje niedostępny, dopóki ktoś tego nie
zauważy.

Serwer nie może pilnować sam siebie: licznik czasu w zablokowanym procesie nigdy się nie
uruchamia, a proces będący PID 1 kontenera nie może zabić sam siebie sygnałem `SIGKILL`. Osobny
proces nadrzędny ma własną pętlę zdarzeń i zawsze może zabić proces potomny.

## Co robi

1. Uruchamia `storefront/server.js` jako proces potomny. Wyjście serwera trafia do logu kontenera
   tak jak wcześniej.
2. Po okresie rozruchu wysyła w stałych odstępach żądanie HTTP `GET` na adres sondy — zawsze
   jedno naraz.
3. Traktuje **każdą odpowiedź HTTP** jako odpowiedź, niezależnie od statusu. `503`, bo backend
   nie działa, albo `500` z powodu błędu oznaczają, że proces żyje, a restart nie naprawiłby
   żadnego z nich. Za niepowodzenie uznaje się tylko odrzucone połączenie, zerwane połączenie lub
   brak odpowiedzi w limicie czasu.
4. Po ustawionej liczbie **kolejnych** niepowodzeń wysyła do serwera `SIGTERM`, a jeśli serwer
   nadal działa po okresie na zatrzymanie — `SIGKILL`, i kończy działanie z kodem `1`. Polityka
   restartu uruchamia wtedy nowy kontener.
5. Przekazuje serwerowi sygnały `SIGTERM`, `SIGINT` i `SIGHUP` i kończy działanie z kodem wyjścia
   serwera, więc `docker stop` działa jak dotąd. Serwer, który nie zatrzyma się w okresie na
   zatrzymanie, jest zabijany. W trakcie zamykania sonda nie działa.

Każda decyzja trafia do logu jako jeden wiersz zaczynający się od `storefront-supervisor:`, na
przykład:

```text
storefront-supervisor: probe failed (3/3): no answer within 5000 ms
storefront-supervisor: the server did not answer 3 consecutive probes of http://127.0.0.1:3000/robots.txt; sending SIGTERM
storefront-supervisor: the server was ended by SIGKILL after it stopped answering; exiting with 1
```

Udane sondy nie są logowane, z wyjątkiem pierwszej oraz pierwszej po niepowodzeniu.

## Konfiguracja

Każda zmienna jest opcjonalna; wartości domyślne nie wymagają żadnej konfiguracji. Ustawia się je
w bloku `environment` usługi `storefront`. Wartość, której nadzorca nie potrafi odczytać,
zatrzymuje kontener przy starcie z komunikatem wskazującym zmienną — nigdy nie jest zgadywana.

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `STOREFRONT_SUPERVISOR_PROBE` | `on` | `off` (albo `false`, `0`, `no`) wyłącza sondę. Nadzorca nadal przekazuje sygnały i kod wyjścia. |
| `STOREFRONT_SUPERVISOR_PROBE_URL` | `http://127.0.0.1:${PORT}/robots.txt` | Adres sondy. Musi być bezwzględnym adresem URL `http` lub `https`. |
| `STOREFRONT_SUPERVISOR_INTERVAL_SECONDS` | `10` | Przerwa między końcem jednej sondy a początkiem następnej. |
| `STOREFRONT_SUPERVISOR_TIMEOUT_SECONDS` | `5` | Jak długo jedna sonda czeka na odpowiedź. |
| `STOREFRONT_SUPERVISOR_FAILURES` | `3` | Liczba kolejnych niepowodzeń, po której serwer zostaje zakończony. Każda odpowiedź zeruje licznik. |
| `STOREFRONT_SUPERVISOR_START_GRACE_SECONDS` | `30` | Niepowodzenia w tym czasie od startu nie są liczone. Okres kończy się też przy pierwszej odpowiedzi. |
| `STOREFRONT_SUPERVISOR_KILL_GRACE_SECONDS` | `5` | Po jakim czasie od `SIGTERM` serwer jest zabijany sygnałem `SIGKILL`. Utrzymuj tę wartość poniżej limitu zatrzymania Dockera (domyślnie 10 sekund). |

Dopuszczalne są ułamki sekund. `PORT` to ta sama zmienna, na której nasłuchuje serwer.

### Dlaczego `/robots.txt`

To ścieżka, którą obsługuje każdy storefront, renderowana przy każdym żądaniu, więc angażuje działający
serwer. Jej jedyny odczyt z backendu jest ograniczony limitem czasu i buforowany, dlatego wolny
backend nie wygląda jak zawieszony storefront. Healthcheck w compose nadal odpytuje `/` i to on
decyduje o stanie zdrowia widocznym w `docker ps`; nadzorca go nie czyta.

Jeśli Twój storefront nie obsługuje już `/robots.txt` albo przez `HOSTNAME` nasłuchuje na konkretnym
interfejsie, ustaw `STOREFRONT_SUPERVISOR_PROBE_URL` na adres, na który serwer odpowiada wewnątrz
kontenera.

### Ile trwa przywrócenie

Przy wartościach domyślnych serwer, który przestał odpowiadać, zostaje zakończony w ciągu około
`FAILURES × (INTERVAL + TIMEOUT) + KILL_GRACE` = 3 × (10 + 5) + 5 = **50 sekund**, do czego
dochodzi czas ponownego startu kontenera.

## Uruchamiaj go z procesem init

Bez procesu init nadzorca jest PID 1 kontenera. Obsługuje sygnały, które przekazuje, więc
`docker stop` działa. Nie zbiera natomiast procesów osieroconych przez serwer — to zadanie procesu
init. Dlatego dostarczane przykłady compose ustawiają `init: true` w usłudze storefrontu. Dla
kontenera uruchamianego ręcznie użyj `docker run --init`.

## Backend i panel administracyjny

Obraz backendu uruchamia `node dist/index.js` bezpośrednio i ma tę samą słabość: backend, który
działa, ale nie odpowiada, nie jest restartowany. Śledzi to
[zgłoszenie #596](https://github.com/endora-commerce/endora-commerce/issues/596). Obraz panelu
administracyjnego to pliki statyczne serwowane przez nginx, którego proces główny sam restartuje
swoje procesy robocze; nadzorca nie jest mu potrzebny.
