---
title: Panel administracyjny — układ mobilny
---

# Panel administracyjny — układ mobilny

Funkcja **029** sprawia, że panel administracyjny Dostawcy jest użyteczny w przeglądarkach smartfonów. Nie ma osobnej aplikacji natywnej: ta sama aplikacja React SPA dostosowuje się poniżej **punktu przerwania `lg` (1024px)**.

## Punkty przerwania

| Viewport | Shell |
|----------|--------|
| ≥ 1024px | Stały sidebar (248px lub szyna 64px). `⌘B` / `Ctrl+B` przełącza tryb szyny. |
| &lt; 1024px | Układ jednokolumnowy. Hamburger otwiera nakładkę z szufladą nawigacji. |

## Listy i tabele

- **`ResponsiveTable`** — renderuje standardową tabelę na desktopie i **wiersze-karty** na mobile. Każda lista musi oznaczyć co najmniej jedną kolumnę jako **primary** dla nagłówka karty.
- **`b2b-table-scroll`** — opakowanie zapasowe, gdy szeroka tabela nie może jeszcze zostać zamieniona na karty. Przewijanie jest ograniczone do regionu tabeli; sama strona nie może przewijać się poziomo.

## Zmiana kolejności dotykiem

Powierzchnie zmieniające kolejność wierszy przez HTML5 drag udostępniają też przyciski **Move up / Move down** (`TouchReorderButtons`) z obszarami kliknięcia 44px.

## Page Builder (Puck)

Edytory CMS/Blog Puck są przewijalne na mobile. Precyzyjne przeciąganie może pozostać łatwiejsze na desktopie; dokumentuj znane luki podczas testów US4.

## Checklist QA

Ręczny smoke test: Chrome DevTools → iPhone 12 Pro (390px) lub własna szerokość 320px.
