---
title: Panel administracyjny — układ mobilny
---

# Panel administracyjny — układ mobilny

Z panelu administracyjnego Dostawcy można korzystać w przeglądarce smartfona. Nie ma osobnej
aplikacji natywnej: ta sama aplikacja React dostosowuje układ poniżej **progu `lg` (1024 px)**.

## Progi szerokości

| Szerokość ekranu | Układ |
|----------|--------|
| ≥ 1024px | Stały pasek boczny (248 px albo zwinięty pasek ikon 64 px). `⌘B` / `Ctrl+B` przełącza tryb zwinięty. |
| &lt; 1024px | Układ jednokolumnowy. Przycisk menu otwiera wysuwany panel nawigacji. |

## Listy i tabele

- **`ResponsiveTable`** — na komputerze wyświetla zwykłą tabelę, a na telefonie **wiersze w postaci
  kart**. Każda lista musi oznaczyć co najmniej jedną kolumnę jako **primary**, która staje się
  nagłówkiem karty.
- **`b2b-table-scroll`** — opakowanie awaryjne dla szerokiej tabeli, której jeszcze nie da się
  zamienić na karty. Przewijanie jest ograniczone do obszaru tabeli; sama strona nie może przewijać
  się w poziomie.

## Zmiana kolejności na ekranie dotykowym

Ekrany, na których kolejność wierszy zmienia się przeciąganiem (HTML5 drag), mają też przyciski
**Move up / Move down** (`TouchReorderButtons`) z polem dotyku 44 px.

## Page Builder (Puck)

Edytory Puck w CMS i blogu można przewijać na telefonie. Precyzyjne przeciąganie może pozostać
wygodniejsze na komputerze; znane problemy znalezione podczas testów ręcznych należy dokumentować.

## Lista kontrolna testów

Ręczny test podstawowy: Chrome DevTools → iPhone 12 Pro (390 px) albo własna szerokość 320 px.
