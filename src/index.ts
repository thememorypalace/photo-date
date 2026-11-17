/**
 * @thememorypalace/photo-date
 *
 * Reads when a photo was taken from its metadata (JPEG, HEIC/HEIF/AVIF, PNG,
 * WebP, TIFF), falls back to the date in the file name (camera apps,
 * screenshots, WhatsApp and other messengers) and to the file date, and says
 * how far each answer can be trusted. Zero dependencies; runs in browsers,
 * web workers, Node 18+, Deno and Bun. Nothing is uploaded or sent anywhere.
 */
import { type ParsedDate, isClockNotSet, parseExifDate, parseXmpDate, makeDate } from "./dates.js";
import { type FilenameDate, type FilenameKind, dateFromFilename } from "./filename.js";
import { type PhotoFormat, type PhotoMetadata, readMetadataFrom } from "./metadata.js";
import { type PhotoInput, toSource } from "./source.js";

export type { ParsedDate, FilenameDate, FilenameKind, PhotoFormat, PhotoMetadata, PhotoInput };
export { parseExifDate, parseXmpDate, dateFromFilename, isClockNotSet };

export type Confidence = "high" | "medium" | "low";

export type DateSource =
  | "exif-original"
  | "xmp-original"
  | "xmp-date-created"
  | "filename-camera"
  | "exif-digitized"
  | "xmp-create-date"
  | "filename-screenshot"
  | "exif-modified"
  | "xmp-modified"
  | "filename-messenger"
  | "png-time"
  | "filename-other"
  | "file-modified";

export interface DateCandidate extends ParsedDate {
  source: DateSource;
  confidence: Confidence;
  /** One sentence in English on what this date means. */
  note: string;
  /** The raw value as found, such as "2014:07:19 11:04:32" or the file name. */
  raw: string;
  /** For file name dates: the pattern that matched, such as "whatsapp" or "android-screenshot". */
  pattern?: string;
}

export interface PhotoDateResult {
  /** The most trustworthy date found, or null when there is none. */
  best: DateCandidate | null;
  /** Every date found, most trustworthy first. */
  candidates: DateCandidate[];
  /** The raw metadata fields. */
  metadata: PhotoMetadata;
}

export interface PhotoDateOptions {
  /** File name, for the file name fallback. Taken from a File when not given. */
  name?: string;
  /** Last modified time of the file (ms or Date). Taken from a File when not given. */
  lastModified?: number | Date;
  /** Leave out the file date as a last resort. Default false. */
  ignoreFileDate?: boolean;
  /** Reference moment for rejecting future dates. Default: now. */
  now?: Date;
}

const ORDER: DateSource[] = [
  "exif-original",
  "xmp-original",
  "xmp-date-created",
  "filename-camera",
  "exif-digitized",
  "xmp-create-date",
  "filename-screenshot",
  "exif-modified",
  "xmp-modified",
  "filename-messenger",
  "png-time",
  "filename-other",
  "file-modified",
];

const NOTES: Record<DateSource, string> = {
  "exif-original": "EXIF DateTimeOriginal, written by the camera or phone at the moment the photo was taken.",
  "xmp-original": "XMP exif:DateTimeOriginal, the moment the photo was taken as recorded by the camera or carried over by editing software.",
  "xmp-date-created": "XMP photoshop:DateCreated, the date the content was created. Usually the capture date, but it can be set by hand.",
  "filename-camera": "Date in a camera app file name. Normally the moment of capture, but renaming or copying can change it.",
  "exif-digitized": "EXIF DateTimeDigitized. For a camera photo this is the capture time; for a scan it is the day of scanning, not the day on the photo.",
  "xmp-create-date": "XMP xmp:CreateDate, when the digital file was created. For a scan this is the scan date.",
  "filename-screenshot": "Date in a screenshot file name: when the screenshot was made, not when what it shows was photographed.",
  "exif-modified": "EXIF DateTime, the last time software wrote the file. It may be much later than the photo.",
  "xmp-modified": "XMP xmp:ModifyDate, the last time software changed the file.",
  "filename-messenger": "Date in a messaging app file name: the day the file was sent or saved, not the day the photo was taken.",
  "png-time": "PNG tIME chunk, the last time the image data was changed, in UTC.",
  "filename-other": "A date somewhere in the file name. What it stands for is unknown.",
  "file-modified": "File modification date from the file system. This is the date of this copy, often the day it was downloaded, copied or scanned.",
};

const FILENAME_SOURCE: Record<FilenameKind, DateSource> = {
  camera: "filename-camera",
  screenshot: "filename-screenshot",
  messenger: "filename-messenger",
  other: "filename-other",
};

function baseConfidence(source: DateSource): Confidence {
  switch (source) {
    case "exif-original":
    case "xmp-original":
      return "high";
    case "xmp-date-created":
    case "filename-camera":
    case "exif-digitized":
    case "xmp-create-date":
    case "filename-screenshot":
      return "medium";
    default:
      return "low";
  }
}

function isFile(input: unknown): input is File {
  return typeof File !== "undefined" && input instanceof File;
}

/**
 * Builds the list of candidates from metadata, a file name and a file date.
 * Exposed for callers that read metadata elsewhere.
 */
export function rankDates(
  metadata: PhotoMetadata,
  options: Omit<PhotoDateOptions, "lastModified"> & { lastModified?: number | Date } = {},
): DateCandidate[] {
  const now = options.now ?? new Date();
  const out: DateCandidate[] = [];
  const add = (source: DateSource, parsed: ParsedDate | null, raw: string, pattern?: string) => {
    if (!parsed) return;
    let confidence = baseConfidence(source);
    let note = NOTES[source];
    if (isClockNotSet(parsed)) {
      confidence = "low";
      note += " This value looks like the default of a clock that was never set.";
    } else if (parsed.date.getTime() > now.getTime() + 36 * 3600 * 1000) {
      confidence = "low";
      note += " This value lies in the future, so the clock of the device was probably wrong.";
    }
    out.push({ ...parsed, source, confidence, note, raw, ...(pattern ? { pattern } : {}) });
  };

  const m = metadata;
  if (m.dateTimeOriginal) add("exif-original", parseExifDate(m.dateTimeOriginal, m.offsetTimeOriginal), m.dateTimeOriginal);
  if (m.xmpDateTimeOriginal) add("xmp-original", parseXmpDate(m.xmpDateTimeOriginal), m.xmpDateTimeOriginal);
  if (m.xmpDateCreated) add("xmp-date-created", parseXmpDate(m.xmpDateCreated), m.xmpDateCreated);
  if (m.dateTimeDigitized) add("exif-digitized", parseExifDate(m.dateTimeDigitized, m.offsetTimeDigitized), m.dateTimeDigitized);
  if (m.xmpCreateDate) add("xmp-create-date", parseXmpDate(m.xmpCreateDate), m.xmpCreateDate);
  if (m.dateTime) add("exif-modified", parseExifDate(m.dateTime, m.offsetTime), m.dateTime);
  if (m.xmpModifyDate) add("xmp-modified", parseXmpDate(m.xmpModifyDate), m.xmpModifyDate);
  if (m.pngTime) add("png-time", parseXmpDate(m.pngTime), m.pngTime);

  if (options.name) {
    const f = dateFromFilename(options.name, { now });
    if (f) {
      const { kind, pattern, ...parsed } = f;
      add(FILENAME_SOURCE[kind], parsed, options.name, pattern);
    }
  }

  if (!options.ignoreFileDate && options.lastModified !== undefined) {
    const t = options.lastModified instanceof Date ? options.lastModified.getTime() : options.lastModified;
    if (Number.isFinite(t) && t > Date.UTC(1971, 0, 1)) {
      const d = new Date(t);
      const parsed = makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), {
        h: d.getHours(),
        mi: d.getMinutes(),
        s: d.getSeconds(),
      });
      if (parsed) add("file-modified", { ...parsed, date: d }, d.toISOString());
    }
  }

  const rank = (c: DateCandidate) => (c.confidence === "high" ? 0 : c.confidence === "medium" ? 100 : 200) + ORDER.indexOf(c.source);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Reads the raw date-related metadata of a photo. Never throws on bad or unknown input. */
export async function readMetadata(input: PhotoInput): Promise<PhotoMetadata> {
  return readMetadataFrom(toSource(input));
}

/**
 * Reads when a photo was taken.
 *
 * ```ts
 * const { best } = await readPhotoDate(file);
 * if (best) console.log(best.local, best.confidence, best.note);
 * ```
 *
 * Accepts a File or Blob (browser), a Buffer, Uint8Array or ArrayBuffer (Node).
 * With a File, the name and last modified date are used as fallbacks.
 */
export async function readPhotoDate(input: PhotoInput, options: PhotoDateOptions = {}): Promise<PhotoDateResult> {
  const metadata = await readMetadata(input);
  const name = options.name ?? (isFile(input) ? input.name : undefined);
  const lastModified = options.lastModified ?? (isFile(input) && input.lastModified ? input.lastModified : undefined);
  const candidates = rankDates(metadata, { ...options, name, lastModified });
  return { best: candidates[0] ?? null, candidates, metadata };
}
