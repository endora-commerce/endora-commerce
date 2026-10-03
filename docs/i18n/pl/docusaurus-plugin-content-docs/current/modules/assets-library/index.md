---
title: Biblioteka mediów
description: Centralna biblioteka plików z wymiennymi adapterami przechowywania, usuwaniem miękkim i ochroną przed usunięciem używanych plików
---

# Biblioteka mediów

Biblioteka mediów (Assets Library) to warstwa plików cyfrowych platformy. Zapewnia:

- Centralny katalog plików (obrazów, wideo, PDF, dokumentów) wielokrotnie używanych w mediach
  produktów, załącznikach produktów, głównych obrazach kategorii i stronach CMS.
- Drzewo folderów do porządkowania plików.
- Wymienne mechanizmy przechowywania — lokalny system plików, Amazon S3, GCP Cloud Storage —
  konfigurowane w ustawieniach; aktywny jest zawsze dokładnie jeden.
- Widoczność publiczną albo prywatną ustawianą dla każdego pliku.
- Ochronę odwołań: plików używanych przez katalog lub CMS nie można usunąć, dopóki wszystkie
  odwołania nie zostaną usunięte.

## Szybki start

1. **Aktywny adapter** — otwórz Settings → Storage i wybierz `local`, `s3` albo `gcs`. Domyślnie
   `local`.
2. **Lokalny system plików** — ustaw `assets.local.base_dir` (domyślnie `var/assets`). Serwer
   tworzy strukturę katalogów przy przesyłaniu pliku. Ustaw `assets.local.public_url_base`, gdy
   backend działa za innym publicznym hostem (np. CDN lub odwrotnym serwerem pośredniczącym); jeśli
   zostawisz to pole puste, każdy adres jest budowany na podstawie publicznego adresu API tego
   wdrożenia.
3. **Amazon S3** — ustaw `assets.s3.bucket`, `assets.s3.region`, `assets.s3.access_key_id` i
   `assets.s3.secret_access_key`. Opcjonalnie: `assets.s3.endpoint` (dla usług zgodnych z S3, jak
   MinIO), `assets.s3.prefix`, `assets.s3.public_base_url` (bazowy adres CDN).
4. **GCP Cloud Storage** — ustaw `assets.gcs.bucket` oraz `assets.gcs.service_account_json` (wklej
   cały JSON) albo skorzystaj z danych uwierzytelniających dostępnych w środowisku. Opcjonalnie:
   `assets.gcs.prefix`, `assets.gcs.public_base_url`.
5. **Test połączenia** — `POST /api/v1/admin/assets/storage/self-check`. Zwraca `{ ok: true }` po
   powodzeniu albo `{ ok: false, reason: ... }` przy błędnej konfiguracji. Stan przechowywania
   pokazuje `GET /api/v1/admin/assets/storage/state`.

## Ograniczenia przesyłania

Przesyłanie plików kontrolują dwa ustawienia — oba są sprawdzane, zanim jakikolwiek bajt trafi do
aktywnego adaptera:

- `assets.allowed_file_types` — lista rozszerzeń plików albo typów MIME (np.
  `["jpg", "png", "image/jpeg", "application/pdf"]`). Specjalna wartość `["*"]` (domyślna) wyłącza
  to ograniczenie. Wzorce w rodzaju `image/*` pasują do każdego typu MIME z tym przedrostkiem.
  Sprawdzany jest zarówno zadeklarowany typ MIME, jak i typ wykryty na podstawie zawartości pliku
  (file-type); plik jest odrzucany, gdy którykolwiek z nich nie pasuje.
- `assets.max_file_size_mb` — limit rozmiaru w MB (liczba całkowita). `0` (domyślnie) wyłącza limit.

## Widoczność i adresy prywatne

Każdy plik ma `visibility ∈ {public, private}`. Adresy publiczne są stałe; adresy prywatne są ważne
krótko (TTL = `assets.private_url_ttl_sec`, domyślnie 300 s) i są wydawane na nowo przez panel lub
storefront przy każdym odczycie.

W adapterze **lokalnego systemu plików** adresy prywatne podpisuje backend kodem HMAC. Klucz
podpisujący pochodzi ze zmiennej środowiskowej `ASSETS_LIBRARY_HMAC_KEY` (wygeneruj go poleceniem
`openssl rand -hex 32`); zmiana klucza unieważnia wszystkie jeszcze ważne adresy prywatne.

W **S3** i **GCS** adresy prywatne podpisuje (V4) SDK dostawcy; backend nie potrzebuje niczego poza
danymi uwierzytelniającymi.

## Usuwanie miękkie i trwałe

Usuwanie przebiega w dwóch etapach:

1. `DELETE /api/v1/admin/assets/:id` → usunięcie miękkie. Ustawia `deletedAt` i
   `purgeAfterAt = now + assets.soft_delete_retention_days` (domyślnie 30). Plik znika z list i list
   wyboru, ale można go przywrócić przez `POST /api/v1/admin/assets/:id/restore`.
2. Powtarzające się zadanie `HardDeleteAssetWorker` kończy usuwanie po `purgeAfterAt`: usuwa wiersz i
   prosi adapter o usunięcie pliku źródłowego. Gdy backend nie może usunąć pliku (zasób tylko do
   odczytu, unieważnione dane uwierzytelniające, problem z siecią), wiersz zostaje, `pendingCleanup`
   przyjmuje wartość `true`, a zadanie ponawia próbę w następnym cyklu.

## Ochrona odwołań {#asset-reference-registry}

Usunięcie miękkie jest odrzucane z `409 ASSET_REFERENCED`, gdy do pliku odwołuje się którekolwiek z
poniższych:

- `gallery_items.asset_id` (galeria produktu)
- `product_attachments.asset_id` (załączniki produktu)
- `products.download_asset_id` (produkty do pobrania)
- `categories.main_image_asset_id` (główny obraz kategorii)
- `cms_pages.body` zawierające węzeł `{ type: "asset_ref", assetId }`

Lista odwołań jest dołączana do tablicy `details` w odpowiedzi z błędem, aby panel mógł pokazać, gdzie
plik jest używany.

## Wymienne adaptery przechowywania

Każdy mechanizm przechowywania implementuje interfejs `StorageAdapter` w
`packages/modules/assets_library/src/backend/services/storage/`. Dodanie czwartego mechanizmu (Azure
Blob, Backblaze B2, …) polega na dodaniu nowej klasy implementującej:

```ts
selfCheck(): Promise<{ ok: boolean; reason?: string }>;
newLocator({ assetId, originalFilename }): string;
put({ locator, mimeType, visibility, stream, sizeBytes }): Promise<void>;
resolveUrl({ locator, visibility, ttlSec? }): Promise<{ url; expiresAt }>;
open({ locator }): Promise<NodeJS.ReadableStream>;
delete({ locator }): Promise<void>;
setVisibility?({ locator, visibility }): Promise<void>;
```

…i zarejestrowaniu jej w `AdapterRegistry.build`. Jako wzór posłużą istniejące
`LocalFsStorageAdapter`, `S3StorageAdapter` i `GcsStorageAdapter`.

## Wyjątek dla starszych plików

Istniejące wcześniej wiersze `assets`, których `storage_url` był adresem niewydanym przez tę
platformę, są przy migracji oznaczane jako `storage_backend = 'legacy'`. Mechanizm odczytu dla
starszych plików zwraca dla plików `public` adres dosłownie — przenosząc go na publiczny adres API,
gdy zapisana wartość jest względna wobec hosta — i odmawia przełączenia ich na `private` (nie możemy
podpisywać adresów, których nie wydaliśmy), co w panelu pojawia się jako
`409 ASSET_LEGACY_LOCATOR_CANNOT_HARDEN`. Aby przenieść taki plik do nowego mechanizmu, prześlij go
ponownie przez aktywny adapter.
