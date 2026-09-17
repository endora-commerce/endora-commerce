---
title: Assets Library
description: Centralna biblioteka zasobów cyfrowych z wymiennymi adapterami storage, soft-delete i strażnikami ochrony referencji
---

# Assets Library

Assets Library to substrat zasobów cyfrowych platformy. Posiada:

- Centralny katalog plików (obrazy, wideo, PDF, dokumenty) wielokrotnie używanych
  w mediach produktu, załącznikach produktu, głównych obrazach kategorii i stronach CMS.
- Drzewo folderów do organizacji assetów.
- Wymienne backendy storage — lokalny filesystem, Amazon S3, GCP Cloud
  Storage — konfigurowane z Settings, dokładnie jeden aktywny naraz.
- Widoczność public/private per asset.
- Ochronę referencji: assetów używanych przez Catalog lub CMS nie można usunąć,
  dopóki każda referencja nie zostanie odłączona.

## Szybki start

1. **Aktywny adapter** — otwórz Settings → Storage i wybierz jeden z `local`, `s3`
   lub `gcs`. Domyślnie `local`.
2. **Local FS** — ustaw `assets.local.base_dir` (domyślnie `var/assets`). Serwer admin
   tworzy drzewo katalogów w czasie uploadu. Ustaw
   `assets.local.public_url_base`, gdy backend stoi za innym publicznym hostem (np. CDN lub reverse proxy); zostaw puste, a każdy
   URL budowany jest na publicznym origin API tego wdrożenia.
3. **Amazon S3** — ustaw `assets.s3.bucket`, `assets.s3.region`,
   `assets.s3.access_key_id`, `assets.s3.secret_access_key`. Opcjonalnie:
   `assets.s3.endpoint` (dla providerów kompatybilnych z S3 jak MinIO),
   `assets.s3.prefix`, `assets.s3.public_base_url` (prefiks bazowego URL CDN).
4. **GCP Cloud Storage** — ustaw `assets.gcs.bucket` i albo
   `assets.gcs.service_account_json` (wklej pełny JSON), albo polegaj na
   ambient credentials. Opcjonalnie: `assets.gcs.prefix`,
   `assets.gcs.public_base_url`.
5. **Test połączenia** — `POST /api/v1/admin/assets/storage/self-check`.
   Zwraca `{ ok: true }` przy sukcesie lub `{ ok: false, reason: ... }` przy
   błędnej konfiguracji. Dashboard jest pod `GET /api/v1/admin/assets/storage/state`.

## Ograniczenia uploadu

Dwa ustawienia bramkują uploady — oba sprawdzane, zanim jakikolwiek bajt dotrze do aktywnego
adaptera:

- `assets.allowed_file_types` — lista rozszerzeń plików lub typów MIME
  (np. `["jpg", "png", "image/jpeg", "application/pdf"]`). Sentinel
  `["*"]` (domyślnie) wyłącza bramkę. Wildcardi jak `image/*` pasują do każdego
  MIME pod tym prefiksem. Sprawdzenie uwzględnia zarówno zadeklarowane MIME, jak i
  MIME wykryte magic-number (file-type) i odrzuca, gdy którekolwiek zawiedzie.
- `assets.max_file_size_mb` — integer cap w MB. `0` (domyślnie) wyłącza
  cap.

## Widoczność i prywatne URL-e

Każdy asset ma `visibility ∈ {public, private}`. Publiczne URL-e są stabilne;
prywatne URL-e są krótkotrwałe (TTL = `assets.private_url_ttl_sec`, domyślnie
300s) i ponownie wydawane przez admin lub storefront przy każdym odczycie.

Dla adaptera **local FS** prywatne URL-e są podpisywane HMAC przez backend.
Klucz podpisu pochodzi ze zmiennej env `ASSETS_LIBRARY_HMAC_KEY`
(wygeneruj przez `openssl rand -hex 32`); rotacja unieważnia każdy
wygasający prywatny URL.

Dla **S3** i **GCS** prywatne URL-e są podpisywane V4 przez vendor SDK;
backend nie wymaga nic poza credentials.

## Soft-delete i hard-delete

Usunięcia przechodzą dwuetapowy cykl życia:

1. `DELETE /api/v1/admin/assets/:id` → soft-delete. Ustawia `deletedAt` i
   `purgeAfterAt = now + assets.soft_delete_retention_days` (domyślnie 30).
   Asset znika z list i pickerów, ale pozostaje odzyskiwalny
   przez `POST /api/v1/admin/assets/:id/restore`.
2. Powtarzający się `HardDeleteAssetWorker` finalizuje po `purgeAfterAt`:
   usuwa wiersz i prosi adapter o usunięcie pliku źródłowego.
   Gdy backend nie może usunąć pliku (read-only mount, unieważnione
   credentials, partycja sieci), wiersz zostaje, a `pendingCleanup` ustawia się na
   `true`; worker ponawia przy następnym ticku.

## Ochrona referencji (FR-030) {#asset-reference-registry}

Soft-delete jest odrzucany z `409 ASSET_REFERENCED`, gdy którykolwiek z poniższych wskazuje asset:

- `gallery_items.asset_id` (galeria produktu)
- `product_attachments.asset_id` (załączniki produktu)
- `products.download_asset_id` (produkty virtual-download)
- `categories.main_image_asset_id` (główny obraz kategorii)
- `cms_pages.body` zawierający węzeł `{ type: "asset_ref", assetId }`

Lista referencji jest dołączona do tablicy `details` envelope błędu, żeby
UI admina mogło pokazać monity „używany przez”.

## Wymienne adaptery storage

Każdy backend implementuje SPI `StorageAdapter` w
`packages/modules/assets_library/src/backend/services/storage/`. Dodanie czwartego
backendu (Azure Blob, Backblaze B2, …) to dodanie nowej
klasy implementującej:

```ts
selfCheck(): Promise<{ ok: boolean; reason?: string }>;
newLocator({ assetId, originalFilename }): string;
put({ locator, mimeType, visibility, stream, sizeBytes }): Promise<void>;
resolveUrl({ locator, visibility, ttlSec? }): Promise<{ url; expiresAt }>;
open({ locator }): Promise<NodeJS.ReadableStream>;
delete({ locator }): Promise<void>;
setVisibility?({ locator, visibility }): Promise<void>;
```

…i rejestracja w `AdapterRegistry.build`. Zob. istniejące
`LocalFsStorageAdapter`, `S3StorageAdapter` i `GcsStorageAdapter` jako
szablony.

## Legacy escape hatch

Wiersze `assets` sprzed 013, których `storage_url` był URL-em, którego ta platforma nie
wydała, są tagowane `storage_backend = 'legacy'` w czasie migracji. Legacy
resolver zwraca URL verbatim dla assetów `public` — rebazując go na
publicznym origin API, gdy zapisana wartość jest host-relative — i odmawia przełączenia
ich na `private` (nie możemy podpisać URL-i, których nie wydaliśmy), co na adminie
powierzchnia się jako
`409 ASSET_LEGACY_LOCATOR_CANNOT_HARDEN`. Prze-uploaduj przez
aktywny adapter, żeby zupgrade'ować.
