# photo-date

Find out when a photo was taken. `photo-date` reads the capture date from the metadata of JPEG, HEIC, PNG, WebP and TIFF files, falls back to the date in the file name (camera apps, screenshots, WhatsApp, Signal, Telegram) and to the file date, and tells you how far each answer can be trusted.

- Zero runtime dependencies, about 25 KB unminified.
- Runs in browsers, web workers, Node 18+, Deno and Bun. Nothing is uploaded or sent anywhere.
- Reads only the parts of a file that hold metadata, so a folder of large photos stays fast.
- ESM and CommonJS builds, TypeScript types included.

There is a free online version of the same logic at [thememorypalace.ai/photo-date](https://www.thememorypalace.ai/photo-date), where you can drop in a photo and see every date it carries.

## Install

```sh
npm install @thememorypalace/photo-date
```

## Usage

### In the browser

```ts
import { readPhotoDate } from "@thememorypalace/photo-date";

input.addEventListener("change", async () => {
  for (const file of input.files ?? []) {
    const { best, candidates } = await readPhotoDate(file);
    if (best === null) {
      console.log(file.name, "no date found");
      continue;
    }
    console.log(file.name, best.local, best.confidence, best.source);
    // IMG_0412.HEIC 2019-04-12T15:30:12 high exif-original
    // IMG-20190412-WA0003.jpg 2019-04-12 low filename-messenger
  }
});
```

With a `File`, its name and last modified date are used as fallbacks.

### In Node

```ts
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { readPhotoDate } from "@thememorypalace/photo-date";

const path = "photos/Screenshot_20210704-153012.png";
const result = await readPhotoDate(await readFile(path), {
  name: basename(path),
  lastModified: (await stat(path)).mtimeMs,
});

console.log(result.best);
// {
//   local: '2021-07-04T15:30:12',
//   hasTime: true,
//   date: 2021-07-04T13:30:12.000Z, (when the runtime is in Brussels time)
//   source: 'filename-screenshot',
//   confidence: 'medium',
//   pattern: 'android-screenshot',
//   raw: 'Screenshot_20210704-153012.png',
//   note: 'Date in a screenshot file name: when the screenshot was made, not when what it shows was photographed.'
// }
```

Any `Blob`, `File`, `ArrayBuffer`, `Uint8Array` or Node `Buffer` works as input.

### The result

`readPhotoDate(input, options?)` returns:

| Field | Meaning |
| --- | --- |
| `best` | The most trustworthy date, or `null` when there is none. |
| `candidates` | Every date found, most trustworthy first. Useful when the dates disagree. |
| `metadata` | The raw fields, such as `dateTimeOriginal: "2014:07:19 11:04:32"`, `make`, `model` and `hasGps`. |

Each candidate has:

| Field | Meaning |
| --- | --- |
| `local` | Wall-clock time as written, such as `2014-07-19T11:04:32`, or `2014-07-19` when only the day is known. |
| `offset` | UTC offset such as `+02:00`, when the file states one (EXIF `OffsetTimeOriginal`, XMP). |
| `hasTime` | `false` when only the day is known. |
| `date` | A `Date`. Exact when there is an offset; otherwise the wall-clock time is read in the time zone of the runtime. |
| `source` | Where the date comes from (see below). |
| `confidence` | `high`, `medium` or `low`. |
| `note` | One sentence in English on what this date means. |
| `raw` | The value as found in the file or the name. |
| `pattern` | For file name dates, the pattern that matched, such as `whatsapp`. |

Options: `{ name?, lastModified?, ignoreFileDate?, now? }`. `now` is the reference for rejecting dates in the future and mainly helps in tests.

### Sources and confidence

| Source | Confidence | What the date is |
| --- | --- | --- |
| `exif-original` | high | EXIF `DateTimeOriginal`, written by the camera at the moment of capture. |
| `xmp-original` | high | XMP `exif:DateTimeOriginal`. |
| `xmp-date-created` | medium | XMP `photoshop:DateCreated`. Usually the capture date, but it can be set by hand. |
| `filename-camera` | medium | `IMG_20210704_153012.jpg`, `PXL_...`, `20210704_153012.jpg`. Capture time, unless the file was renamed. |
| `exif-digitized` | medium | EXIF `DateTimeDigitized`. For a scan this is the day of scanning. |
| `xmp-create-date` | medium | XMP `xmp:CreateDate`. For a scan this is the scan date. |
| `filename-screenshot` | medium | `Screenshot_20210704-153012.png`, `Screenshot 2023-01-05 at 14.22.10.png`. When the screenshot was made, not when its content was photographed. |
| `exif-modified` | low | EXIF `DateTime`, the last time software wrote the file. |
| `xmp-modified` | low | XMP `xmp:ModifyDate`. |
| `filename-messenger` | low | `IMG-20190412-WA0003.jpg`, `signal-...`, `photo_..._...`. The day the file was sent or saved. |
| `png-time` | low | PNG `tIME` chunk, last change of the image data. |
| `filename-other` | low | Any other date in the name. Meaning unknown. |
| `file-modified` | low | File system date: the date of this copy. |

A date that looks like an unset camera clock (1 January 1970, 1980 or 2000 at midnight) or that lies in the future is moved down to `low`, with a remark in `note`.

### Smaller pieces

```ts
import { readMetadata, dateFromFilename, parseExifDate, rankDates } from "@thememorypalace/photo-date";

await readMetadata(bytes);                 // raw fields only
dateFromFilename("IMG-20190412-WA0003.jpg"); // { local: "2019-04-12", kind: "messenger", pattern: "whatsapp", ... }
parseExifDate("2014:07:19 11:04:32", "+02:00");
rankDates(metadataFromElsewhere, { name }); // rank fields you read with another tool
```

## Supported formats

| Format | Where the date is read |
| --- | --- |
| JPEG | APP1 Exif, APP1 XMP |
| HEIC, HEIF, AVIF | The `Exif` and XMP items, located through `iinf` and `iloc`, including base offsets and `idat` storage |
| PNG | `eXIf` chunk, uncompressed XMP in `iTXt` or `tEXt`, `tIME` |
| WebP | `EXIF` and `XMP ` chunks |
| TIFF, DNG | IFD0 and the Exif sub-IFD |

The format is detected from the first bytes of the file, never from the extension.

## Limits

Be aware of what a file can and cannot tell you:

- **Many files carry no capture date at all.** WhatsApp, Messenger, most social networks and many e-mail programs strip metadata when they send a photo. Downloads from social media and most screenshots are new files without the original details. For those, the best this library can do is the file name or the file date, and it says so with `low` confidence.
- **A scan carries the date of the scan**, not the date of the photo on paper. No library can read that from the file; it takes the photo itself (clothing, cars, print borders, handwriting on the back).
- **EXIF has no time zone** unless the camera also wrote `OffsetTimeOriginal`. Without it, `local` is exact and `date` is an interpretation in the time zone of the runtime.
- **The camera clock may be wrong.** Wrong time zones, daylight saving time and clocks that were never set are common. The library catches the obvious defaults, not a clock that was a few hours or a year off.
- **Not supported yet:** compressed XMP in PNG (`zTXt`, compressed `iTXt`), EXIF stored as hex text in PNG ("Raw profile type exif"), Extended XMP in JPEG, video files (MP4, MOV), most camera raw formats that are not TIFF based (CR3, RAF), and GPS coordinates (the library only reports whether a GPS block exists, never the location).
- The HEIC, WebP and PNG readers are tested with synthetic files that follow the specifications, plus real JPEGs. If you find a real file that gives the wrong answer, please open an issue with the output of `readMetadata`. Please do not attach private photos; a copy with the image data removed is enough.

## About

Made by the small team behind [The Memory Palace](https://www.thememorypalace.ai) in Leuven, Belgium. The library is extracted from the code behind the free [photo date tool](https://www.thememorypalace.ai/photo-date) on that site. See also [gedcom-tools](https://github.com/thememorypalace/gedcom-tools) for GEDCOM family tree files.

## License

MIT. See [LICENSE](LICENSE).
