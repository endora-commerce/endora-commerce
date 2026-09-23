---
sidebar_position: 1
title: Moduły backendu
---

# Moduły backendu

Każdy moduł backendu odpowiada za jedną zdolność biznesową i nigdy nie sięga do
wnętrza innego modułu (Zasada I konstytucji). To, gdzie leży kod modułu, jest
odpowiedzią platformy, a nie ścieżką wartą zapisania: większość modułów to
pakiety workspace w `packages/modules/<id>/`, kilka należy do hosta, a
[mapa modułów](./module-map.generated.md) wskazuje pakiet, z którego pochodzi
każdy z nich. Poniższe strony opisują poszczególne moduły tak, aby mogły z nich
korzystać dwie grupy odbiorców:

- **Programiści**, którzy chcą rozszerzyć moduł — wewnętrzne encje, serwisy
  i punkty rozszerzeń, w które mogą się wpiąć.
- **Product Ownerzy**, którzy chcą zrozumieć, *co* moduł robi i *które
  przepływy* obsługuje, bez czytania kodu.

Dokument OpenAPI pod `GET /api/v1/_openapi.json` jest żywym kontraktem każdej
powierzchni HTTP wymienionej tutaj; sposób korzystania z niego opisują
[Kontrakty API](../contracts/).

## Mapa modułów

Mapa jest **generowana** — jeden wiersz na każdy moduł zarejestrowany przez
platformę, ze zdolnością pobraną z front matter `description` danej strony i
pakietem, z którego moduł pochodzi. Zobacz
[Mapę modułów](./module-map.generated.md).

## Strony referencyjne

Obok strony opisowej każdego modułu witryna niesie **stronę referencyjną**,
również generowaną: uprawnienia deklarowane przez moduł wraz z ich etykietami,
akcje palety poleceń i ekran, który każda z nich otwiera, ustawienia, które
moduł posiada, informację, czy operator może go wyłączyć i jaka jest wartość
domyślna tej kontrolki, od czego moduł zależy oraz pakiet, z którego pochodzi.
Wszystko to znajduje się w manifeście samego modułu, więc strona referencyjna
jest renderowana z manifestu i z niczego napisanego ręcznie — dlatego nie może
być sprzeczna z platformą. Nawigacja prowadzi do niej z wpisu samego modułu, a
moduł, o którym nikt jeszcze nie napisał prozy, ma tam swoją stronę
referencyjną pod własnym identyfikatorem.

Pisz prozę o tym, co moduł *robi*; to, co *deklaruje*, zostaw stronie
referencyjnej, zamiast powtarzać to ponownie. Powtórzona deklaracja to zdanie,
które dezaktualizuje się przy najbliższej edycji manifestu, a nic tego nie
zgłosi.

Mapa jest generowana, ponieważ była błędna. Trzy utrzymywane ręcznie listy
opisywały jedną populację — ta tabela, boczne menu i strony na dysku — i
wszystkie trzy były sprzeczne z platformą i ze sobą nawzajem: 23 zarejestrowane
moduły nie miały tutaj wiersza, osiem napisanych stron nie było osiągalnych z
żadnej nawigacji, a nic w repozytorium nie potrafiło tego zauważyć. Dodanie
modułu nie dotyka dziś żadnego pliku w `docs/` poza stroną samego modułu.
