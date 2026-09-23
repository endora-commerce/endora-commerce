---
title: Jak czytać cytowania specs/NNN
description: Czym są odwołania specs/NNN rozsiane po tej dokumentacji i dlaczego są zwykłym tekstem, a nie odnośnikami
---

# Jak czytać cytowania specs/NNN

Po przeczytaniu kilku stron tej witryny natrafisz na krótkie odwołania wyglądające jak ścieżki do
plików: `specs/016-blog/spec.md`, `specs/133-docs-site-publication/`, czasem samo *feature 100* albo
identyfikator decyzji w rodzaju `D-198`. To nie są literówki i celowo nie są odnośnikami. Ta strona
wyjaśnia, czym one są, żebyś mógł je czytać ze zrozumieniem, zamiast szukać adresu, który i tak by
się nie otworzył.

## Co nazywa takie cytowanie

Endora Commerce powstaje feature po feature, a każdy z nich jest opisany, zanim zostanie
zaprogramowany. Każdy dostaje numerowany katalog — `specs/NNN-slug/` — zawierający specyfikację,
plan implementacji, listę zadań i kontrakty API uzgodnione dla tej pracy. Cytowanie takie jak
`specs/016-blog/spec.md` nazywa jeden z tych dokumentów. `D-198` nazywa zapisaną decyzję
inżynierską, a *feature 100* to to samo odwołanie zapisane nieformalnie. W całej witrynie występuje
około sześćdziesięciu takich cytowań w postaci zwykłego tekstu.

Ich rolą jest podanie źródła. Kiedy strona stwierdza, że obowiązuje jakaś reguła, cytowanie mówi,
gdzie i w ramach której pracy została ona ustalona — to dokumentacyjny odpowiednik przypisu.
Jest to odpowiedź na pytanie „kto to zdecydował i kiedy”, a nie zachęta do kliknięcia.

## Dlaczego żadne z nich nie jest odnośnikiem

Część cytowanych katalogów jest publikowana razem ze źródłami projektu; te starsze znajdują się w
prywatnym repozytorium historycznym, którego nigdy nie opublikowano. Ta witryna nie próbuje ich
rozróżniać, ponieważ odwołanie, które działa dla osób utrzymujących projekt, a zawodzi dla
wszystkich pozostałych, jest gorsze niż brak odwołania: zapowiada drzwi, a potem odmawia ich
otwarcia. Dlatego każde z tych odwołań jest zapisane jako zwykły tekst, a te, które kiedyś były
prawdziwymi odnośnikami, zostały przekonwertowane. Nigdy nie zaproponujemy Ci odnośnika do drzewa,
do którego nie masz dostępu.

Sam adres nadal warto podać. Czytelnik, który ma dostęp do prywatnej historii — albo który patrzy
na katalog feature publikowany razem ze źródłami — dostaje dokładny wskaźnik, a czytelnik, który go
nie ma, traci jedynie martwe kliknięcie. Jeśli chcesz o coś takiego zapytać, po prostu przytocz to
odwołanie: slug jednoznacznie identyfikuje pracę dla każdego, kto może ją zobaczyć.

## Dlaczego publikowanie tych cytowań jest bezpieczne

Ten projekt filtruje to, co publikuje, według spisanej reguły — `specs/conventions/commercial-data.md`
— a sama reguła jest publiczna, bo filtr o tajnych kryteriach jest filtrem, którego nikt z zewnątrz
nie może zakwestionować. Jej §4(a), *wskaźnik to nie ładunek*, jest klauzulą obejmującą te
cytowania: odwołanie postaci `specs/016-blog/spec.md` ujawnia, że istnieje wewnętrzny dokument i
mniej więcej czego dotyczy — i nic ponadto. Odtworzenie z niego jakiegokolwiek faktu handlowego
wymagałoby samego dokumentu, którego odwołanie nie niesie. Dlatego cytowania zostają w
opublikowanym tekście w takiej postaci, zamiast zostać usunięte — usunięcie ich skasowałoby ślad
audytowy i niczego by nie ukryło.

## Co możesz otworzyć zamiast tego

Materiał, którego faktycznie potrzebuje osoba współtworząca projekt, jest publikowany razem ze
źródłami: konwencje inżynierskie w `specs/conventions/`, konstytucja projektu w
`.specify/memory/constitution.md` oraz sama ta witryna dokumentacyjna. Tam, gdzie strona wymaga od
Ciebie zastosowania reguły, podaje tę regułę; cytowanie `specs/NNN` obok niej zapisuje jedynie, skąd
ona pochodzi. Jeśli któraś strona każe Ci sięgnąć po cytowany dokument, żeby móc za nią podążyć,
jest to defekt tej strony — zgłoś go, a brakująca treść zostanie tutaj dopisana.
