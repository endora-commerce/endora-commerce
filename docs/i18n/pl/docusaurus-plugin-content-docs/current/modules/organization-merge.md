---
title: Scalanie zduplikowanych organizacji
description: Jak operator scala zduplikowaną organizację z tą, która zostaje, śledzi scalanie i wznawia scalanie wymagające uwagi.
---

# Scalanie zduplikowanych organizacji

Gdy ta sama firma występuje dwukrotnie — import z ERP utworzył drugą organizację albo kupujący
zarejestrował się ponownie — scal duplikat z organizacją, która zostaje. Członkowie, adresy,
zamówienia, zapytania ofertowe, faktury i wszystkie inne rekordy duplikatu przechodzą do
organizacji, która zostaje, a duplikat zostaje zarchiwizowany ze wskazaniem na nią.

**Scalenia nie można cofnąć.** Nie ma operacji odwrotnej. Przed rozpoczęciem sprawdź podgląd.

## Kto może scalać {#who-can-merge}

- Potrzebujesz uprawnienia **Scalanie zduplikowanych organizacji** (`organizations:merge`). Nie
  należy ono do predefiniowanej roli przedstawiciela handlowego; nadaje je administrator na
  ekranie ról.
- Musisz mieć dostęp do **obu** organizacji. Organizacji przypisanej innemu przedstawicielowi
  handlowemu nie da się wybrać.
- Organizacja osobista (B2C) nigdy nie jest scalana. Aby przenieść osobę do firmy, zmień jej
  członkostwo.

## Rozpoczynanie scalania {#starting-a-merge}

Otwórz organizację, która **zostaje**, i wybierz **Więcej → Scal duplikat z tą organizacją…**.
Możesz też nacisnąć ⌘K / CTRL+K i wybrać **Scal organizacje** — wtedy najpierw wskazujesz
organizację, która zostaje.

Scalanie ma trzy kroki:

1. **Wybierz duplikat.** Wyszukaj po nazwie lub NIP. Lista zawiera tylko organizacje firmowe,
   do których masz dostęp.
2. **Przejrzyj i wybierz wartości.** Podgląd pokazuje dla każdego obszaru, ile rekordów
   zostanie przeniesionych, ewentualne konflikty i sposób ich rozwiązania oraz ostrzeżenia (na
   przykład zadłużenie powyżej limitu kredytowego po scaleniu). Tam, gdzie organizacje mają
   różne wartości — nazwa, nazwa prawna, NIP, status VAT, adres rejestrowy, grupa klientów, tryb
   dziedziczenia limitu kredytowego, strategia kompletacji i pola niestandardowe — wybierz
   wartość do zachowania. Organizacja, która zostaje, zachowuje własną wartość, chyba że
   wybierzesz inaczej, a wartość, której nie miała, przejmuje od duplikatu. Adresy e-mail do
   potwierdzeń zamówień są zawsze łączone.
3. **Potwierdź.** Zaznacz *Rozumiem, że scalenia nie można cofnąć* i wybierz **Rozpocznij
   scalanie**. Otworzy się ekran postępu scalania.

### Gdy scalanie zostaje odrzucone {#when-the-merge-is-refused}

Podgląd wyjaśnia słowami, dlaczego dwóch organizacji nie można scalić, zanim cokolwiek zostanie
zapisane:

| Komunikat | Co zrobić |
| --- | --- |
| Rekordu nie można scalić z nim samym | Wybierz duplikat, a nie organizację, która zostaje. |
| Jeden z rekordów jest usunięty, już scalony lub odrzucony | Nic; tej organizacji nie można już scalić. |
| Organizacji osobistej nie można scalić | Zamiast tego zmień członkostwo osoby. |
| Duplikat jest w drzewie powyżej organizacji, która zostaje | Scal je w odwrotnym kierunku albo najpierw przenieś jedną z nich. |
| Organizacje należą do różnych drzew | Najpierw przenieś jedną do drzewa drugiej, potem scal. |
| Inne scalanie obejmuje już jeden z rekordów | Poczekaj na jego zakończenie albo wznów je, jeśli wymaga uwagi. |
| **Scalanie nie jest jeszcze dostępne** | Zobacz niżej. |

**Scalanie nie jest jeszcze dostępne** wymienia obszary platformy, które nie potrafią jeszcze
przenieść swoich rekordów do organizacji, która zostaje. Dopóki każdy obszar przechowujący
rekordy organizacji tego nie umożliwi, podgląd działa, a rozpoczęcie scalania jest odrzucane.
Podgląd niczego nie zmienia; rozpocznij scalanie, gdy komunikat zniknie.

## Śledzenie scalania {#following-a-merge}

Scalanie działa w tle, w fazach: struktura, konfiguracja, adresy, członkowie, rekordy
i finalizacja. Ekran postępu (**Scalenia organizacji** albo odnośnik na ekranie każdej z obu
organizacji) pokazuje każdy krok, liczbę przeniesionych rekordów i liczbę ukończonych kroków.
W trakcie scalania:

- duplikatu nie można zmieniać — ani Ty, ani jego kupujący, ani integracja;
- organizacja, która zostaje, działa normalnie;
- ekrany obu organizacji informują o trwającym scalaniu i prowadzą do niego.

Scalanie możesz **anulować** na ekranie postępu (**Więcej → Anuluj scalanie**) tylko zanim
zostanie przeniesiony jakikolwiek rekord. Później może się już tylko zakończyć.

Obszar wyłączony w chwili, gdy scalanie do niego dotrze, jest pomijany i oznaczony jako
*Odłożone*; jego rekordy zostaną przeniesione automatycznie po ponownym włączeniu.

## Gdy scalanie wymaga uwagi {#when-a-merge-needs-attention}

Krok, który stale się nie udaje, jest ponawiany, a potem scalanie zatrzymuje się w stanie
**Wymaga uwagi**. Każdy administrator, który może scalać i ma dostęp do obu organizacji,
otrzymuje powiadomienie z odnośnikiem do scalania. Otwórz **Scalenia organizacji** (⌘K →
*Scalenia organizacji*) — na początku listy są scalenia wymagające uwagi — i wybierz **Wznów**.
Ukończone kroki nie są powtarzane.

Po zakończeniu scalania powiadomienie otrzymuje administrator, który je rozpoczął.

## Po scaleniu {#after-the-merge}

- Duplikat jest **zarchiwizowany**: nie pojawia się na żadnej liście, w wyszukiwarce ani
  w polach wyboru. Jego ekran pokazuje *Scalono z … (data), scalił(-a): …*, prowadzi do
  organizacji, która została, i jest tylko do odczytu.
- Organizacja, która została, wymienia go w sekcji **Scalone organizacje** na karcie Przegląd,
  z odnośnikiem do scalania.
- Dziennik audytu zawiera wpisy rozpoczęcia i finalizacji, a każda zmiana wprowadzona przez
  scalanie zawiera identyfikator scalania. Do dziennika trafiają tylko nazwy wybranych pól,
  nigdy ich wartości.
- Integracje otrzymują jedno zdarzenie i webhook `organization.merged.v1`. Żądanie, które nadal
  wskazuje identyfikator duplikatu, jest odrzucane z identyfikatorem organizacji, która została.
