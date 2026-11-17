# Changelog

## 0.1.0 (2026-11-17)

First release.

- `readPhotoDate` reads the capture date from JPEG, HEIC/HEIF/AVIF, PNG, WebP and TIFF metadata (EXIF and XMP), with offsets where the file states them.
- File name fallbacks for camera apps, screenshots (Android, macOS, Windows) and messengers (WhatsApp, Signal, Telegram).
- Every date comes with a source, a confidence level and a short note on what it means.
- Zero dependencies, ESM and CommonJS builds, TypeScript types.
