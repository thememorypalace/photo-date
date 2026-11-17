/**
 * Reads the date fields from the metadata of a photo, without dependencies.
 *
 * Supported containers: JPEG (APP1 Exif and XMP), PNG (eXIf, iTXt/tEXt XMP,
 * tIME), HEIC/HEIF/AVIF (the Exif item found through meta > iinf and iloc,
 * including base offsets and idat storage), WebP (EXIF and XMP chunks) and
 * TIFF, including camera raw files built on TIFF such as DNG.
 *
 * The format is detected from the first bytes, never from the file name or
 * MIME type. Only the parts of the file that hold metadata are read.
 *
 * Everything is best effort: an unknown format, a damaged file or a file
 * without metadata gives empty fields, never an exception.
 */
import { type ByteSource, latin1, readAscii } from "./source.js";

/** The first bytes of a file. The JPEG APP1 segment is almost always within them. */
const HEAD_BYTES = 256 * 1024;
/** Upper bound for a single metadata block we are willing to read. */
const MAX_BLOCK = 4 * 1024 * 1024;

const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_DATETIME = 0x0132;
const TAG_OFFSET_TIME = 0x9010;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_OFFSET_TIME_DIGITIZED = 0x9012;
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_SOFTWARE = 0x0131;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;

const ASCII_TAGS = new Set([
  TAG_DATETIME_ORIGINAL,
  TAG_DATETIME_DIGITIZED,
  TAG_DATETIME,
  TAG_OFFSET_TIME,
  TAG_OFFSET_TIME_ORIGINAL,
  TAG_OFFSET_TIME_DIGITIZED,
  TAG_MAKE,
  TAG_MODEL,
  TAG_SOFTWARE,
]);

export type PhotoFormat = "jpeg" | "png" | "heif" | "webp" | "tiff" | "unknown";

/** Raw metadata values, exactly as they are stored in the file. */
export interface PhotoMetadata {
  format: PhotoFormat;
  /** EXIF DateTimeOriginal (0x9003): the moment the photo was taken, such as "2014:07:19 11:04:32". */
  dateTimeOriginal?: string;
  /** EXIF DateTimeDigitized (0x9004), also called CreateDate. For a scan this is the scan date. */
  dateTimeDigitized?: string;
  /** EXIF DateTime (0x0132), also called ModifyDate: the last time software wrote the file. */
  dateTime?: string;
  /** EXIF OffsetTimeOriginal (0x9011), such as "+02:00". */
  offsetTimeOriginal?: string;
  /** EXIF OffsetTimeDigitized (0x9012). */
  offsetTimeDigitized?: string;
  /** EXIF OffsetTime (0x9010). */
  offsetTime?: string;
  make?: string;
  model?: string;
  software?: string;
  /** True when the file has a GPS block. The location itself is never read. */
  hasGps: boolean;
  /** XMP exif:DateTimeOriginal, such as "2014-07-19T11:04:32+02:00". */
  xmpDateTimeOriginal?: string;
  /** XMP photoshop:DateCreated. */
  xmpDateCreated?: string;
  /** XMP xmp:CreateDate. */
  xmpCreateDate?: string;
  /** XMP xmp:ModifyDate. */
  xmpModifyDate?: string;
  /** PNG tIME chunk: the last modification of the image data, in UTC. ISO 8601 string. */
  pngTime?: string;
}

type ExifPart = Omit<PhotoMetadata, "format" | "hasGps" | "pngTime" | `xmp${string}`> & { hasGps: boolean };

/** Walks one IFD and returns the ASCII fields we want plus the sub-IFD pointers. */
function readIfd(view: DataView, tiffStart: number, ifdOffset: number, little: boolean) {
  const ascii = new Map<number, string>();
  let exifIfd = 0;
  let gps = false;
  const base = tiffStart + ifdOffset;
  if (ifdOffset <= 0 || base + 2 > view.byteLength) return { ascii, exifIfd, gps };
  const count = view.getUint16(base, little);
  for (let i = 0; i < count; i++) {
    const entry = base + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const n = view.getUint32(entry + 4, little);
    if (tag === TAG_EXIF_IFD && (type === 4 || type === 13)) {
      exifIfd = view.getUint32(entry + 8, little);
      continue;
    }
    if (tag === TAG_GPS_IFD) {
      gps = view.getUint32(entry + 8, little) > 0;
      continue;
    }
    if (ASCII_TAGS.has(tag) && type === 2 && n > 0) {
      // ASCII values longer than 4 bytes live elsewhere; the entry then holds an offset.
      const at = n > 4 ? tiffStart + view.getUint32(entry + 8, little) : entry + 8;
      if (at + n <= view.byteLength) {
        const v = readAscii(view, at, n).trim();
        if (v) ascii.set(tag, v);
      }
    }
  }
  return { ascii, exifIfd, gps };
}

/** Reads the fields of a TIFF structure ("II*" or "MM*") that starts at `tiff`. */
export function exifFromTiff(view: DataView, tiff: number): ExifPart | null {
  if (tiff < 0 || tiff + 8 > view.byteLength) return null;
  const endian = view.getUint16(tiff, false);
  const little = endian === 0x4949;
  if (!little && endian !== 0x4d4d) return null;
  if (view.getUint16(tiff + 2, little) !== 42) return null;
  const ifd0 = readIfd(view, tiff, view.getUint32(tiff + 4, little), little);
  const exif = ifd0.exifIfd ? readIfd(view, tiff, ifd0.exifIfd, little) : null;
  // Dates belong in the Exif sub-IFD, but some software writes them to IFD0.
  const pick = (tag: number) => exif?.ascii.get(tag) ?? ifd0.ascii.get(tag);
  return {
    dateTimeOriginal: pick(TAG_DATETIME_ORIGINAL),
    dateTimeDigitized: pick(TAG_DATETIME_DIGITIZED),
    dateTime: ifd0.ascii.get(TAG_DATETIME) ?? exif?.ascii.get(TAG_DATETIME),
    offsetTimeOriginal: pick(TAG_OFFSET_TIME_ORIGINAL),
    offsetTimeDigitized: pick(TAG_OFFSET_TIME_DIGITIZED),
    offsetTime: pick(TAG_OFFSET_TIME),
    make: ifd0.ascii.get(TAG_MAKE),
    model: ifd0.ascii.get(TAG_MODEL),
    software: ifd0.ascii.get(TAG_SOFTWARE),
    hasGps: ifd0.gps,
  };
}

/** Pulls the date properties out of an XMP packet, in either attribute or element form. */
export function xmpDates(xml: string): Pick<PhotoMetadata, "xmpDateTimeOriginal" | "xmpDateCreated" | "xmpCreateDate" | "xmpModifyDate"> {
  const get = (name: string): string | undefined => {
    const esc = name.replace(":", "\\:");
    const attr = new RegExp(`${esc}\\s*=\\s*["']([^"']+)["']`).exec(xml);
    if (attr) return attr[1].trim();
    const el = new RegExp(`<${esc}>\\s*([^<]+?)\\s*</${esc}>`).exec(xml);
    return el ? el[1].trim() : undefined;
  };
  return {
    xmpDateTimeOriginal: get("exif:DateTimeOriginal"),
    xmpDateCreated: get("photoshop:DateCreated"),
    xmpCreateDate: get("xmp:CreateDate"),
    xmpModifyDate: get("xmp:ModifyDate"),
  };
}

const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";

function jpegBlocks(view: DataView): { exif: ExifPart | null; xmp: string | null } {
  let exif: ExifPart | null = null;
  let xmp: string | null = null;
  let p = 2;
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) {
      p++; // fill byte or junk: move on
      continue;
    }
    const marker = view.getUint8(p + 1);
    if (marker === 0xff) {
      p++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // image data starts: nothing for us after this
    const size = view.getUint16(p + 2, false);
    if (size < 2) break;
    if (marker === 0xe1) {
      const body = p + 4;
      if (!exif && readAscii(view, body, 6).startsWith("Exif")) {
        exif = exifFromTiff(new DataView(view.buffer, view.byteOffset + body + 6, Math.max(0, Math.min(size - 8, view.byteLength - body - 6))), 0);
      } else if (!xmp && latin1(view, body, XMP_NS.length) === XMP_NS) {
        xmp = latin1(view, body + XMP_NS.length, size - 2 - XMP_NS.length);
      }
    }
    p += 2 + size;
  }
  return { exif, xmp };
}

async function pngBlocks(src: ByteSource): Promise<{ exif: ExifPart | null; xmp: string | null; time?: string }> {
  let exif: ExifPart | null = null;
  let xmp: string | null = null;
  let time: string | undefined;
  let offset = 8;
  for (let guard = 0; guard < 1024 && offset + 8 <= src.size; guard++) {
    const head = await src.read(offset, offset + 8);
    if (head.byteLength < 8) break;
    const size = head.getUint32(0, false);
    const type = readAscii(head, 4, 4);
    const body = offset + 8;
    if (type === "IEND") break;
    if (type === "IDAT") {
      // Image data; metadata after it is allowed, so skip without reading.
    } else if (type === "eXIf" && !exif && size <= MAX_BLOCK) {
      const v = await src.read(body, body + size);
      // Some writers keep the JPEG "Exif\0\0" prefix.
      exif = exifFromTiff(v, readAscii(v, 0, 4) === "Exif" ? 6 : 0);
    } else if (type === "tIME" && size === 7) {
      const v = await src.read(body, body + 7);
      const y = v.getUint16(0, false);
      const pad = (n: number) => String(n).padStart(2, "0");
      time = `${y}-${pad(v.getUint8(2))}-${pad(v.getUint8(3))}T${pad(v.getUint8(4))}:${pad(v.getUint8(5))}:${pad(v.getUint8(6))}Z`;
    } else if ((type === "iTXt" || type === "tEXt") && !xmp && size <= MAX_BLOCK) {
      const v = await src.read(body, body + size);
      const text = latin1(v);
      if (text.startsWith("XML:com.adobe.xmp\0")) {
        // iTXt: keyword, NUL, compression flag, method, language NUL, translated keyword NUL, text.
        // Compressed XMP (flag 1) needs inflate, which we leave out to stay dependency free.
        if (type === "tEXt" || text.charCodeAt(18) === 0) xmp = text;
      }
    }
    offset = body + size + 4;
  }
  return { exif, xmp, time };
}

async function webpBlocks(src: ByteSource): Promise<{ exif: ExifPart | null; xmp: string | null }> {
  let exif: ExifPart | null = null;
  let xmp: string | null = null;
  let offset = 12;
  for (let guard = 0; guard < 128 && offset + 8 <= src.size; guard++) {
    const head = await src.read(offset, offset + 8);
    if (head.byteLength < 8) break;
    const fourcc = readAscii(head, 0, 4);
    const size = head.getUint32(4, true);
    const body = offset + 8;
    if (fourcc === "EXIF" && size <= MAX_BLOCK) {
      const v = await src.read(body, body + size);
      exif = exifFromTiff(v, readAscii(v, 0, 4) === "Exif" ? 6 : 0);
    } else if (fourcc === "XMP " && size <= MAX_BLOCK) {
      xmp = latin1(await src.read(body, body + size));
    }
    offset = body + size + (size & 1);
  }
  return { exif, xmp };
}

function uintN(view: DataView, offset: number, size: number): number {
  if (size === 0) return 0;
  if (size === 1) return view.getUint8(offset);
  if (size === 2) return view.getUint16(offset, false);
  if (size === 4) return view.getUint32(offset, false);
  if (size === 8) return view.getUint32(offset, false) * 2 ** 32 + view.getUint32(offset + 4, false);
  throw new RangeError("bad integer size");
}

type Box = { type: string; start: number; end: number; boxStart: number };

/** The boxes in [from, to) of an ISO-BMFF structure, one level deep. */
function childBoxes(view: DataView, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = view.getUint32(p, false);
    const type = readAscii(view, p + 4, 4);
    let header = 8;
    if (size === 1) {
      if (p + 16 > to) break;
      size = uintN(view, p + 8, 8);
      header = 16;
    } else if (size === 0) {
      size = to - p;
    }
    if (size < header) break;
    boxes.push({ type, start: p + header, end: Math.min(p + size, to), boxStart: p });
    p += size;
  }
  return boxes;
}

/**
 * HEIC, HEIF and AVIF: find the "Exif" item through meta > iinf (which item)
 * and meta > iloc (where it is stored), then read its TIFF structure.
 */
async function heifBlocks(src: ByteSource, head: DataView): Promise<{ exif: ExifPart | null; xmp: string | null }> {
  const none = { exif: null, xmp: null };
  const top = childBoxes(head, 0, head.byteLength);
  const metaBox = top.find((b) => b.type === "meta");
  if (!metaBox) return none;
  let meta = head;
  let metaStart = metaBox.start;
  let metaEnd = metaBox.end;
  const declared = head.getUint32(metaBox.boxStart, false);
  if (metaBox.boxStart + declared > head.byteLength && head.byteLength < src.size) {
    // The meta box is longer than the head we read: read it on its own.
    if (declared < 16 || declared > 16 * 1024 * 1024) return none;
    meta = await src.read(metaBox.boxStart, metaBox.boxStart + declared);
    metaStart = 8;
    metaEnd = meta.byteLength;
  }
  // meta is a FullBox: 4 bytes of version and flags before the children.
  const kids = childBoxes(meta, metaStart + 4, metaEnd);
  const iinf = kids.find((b) => b.type === "iinf");
  const iloc = kids.find((b) => b.type === "iloc");
  const idat = kids.find((b) => b.type === "idat");
  if (!iinf || !iloc) return none;

  // iinf: which item IDs hold Exif and XMP?
  const iinfVersion = meta.getUint8(iinf.start);
  const infeFrom = iinf.start + 4 + (iinfVersion === 0 ? 2 : 4);
  let exifId = -1;
  let xmpId = -1;
  for (const infe of childBoxes(meta, infeFrom, iinf.end)) {
    if (infe.type !== "infe") continue;
    const v = meta.getUint8(infe.start);
    if (v < 2) continue;
    const idSize = v === 3 ? 4 : 2;
    const id = uintN(meta, infe.start + 4, idSize);
    const itemType = readAscii(meta, infe.start + 4 + idSize + 2, 4);
    if (itemType === "Exif" && exifId < 0) exifId = id;
    if (itemType === "mime" && xmpId < 0) {
      // item_name NUL content_type NUL: XMP is stored as application/rdf+xml.
      const rest = latin1(meta, infe.start + 4 + idSize + 6, infe.end - (infe.start + 4 + idSize + 6));
      if (rest.includes("application/rdf+xml")) xmpId = id;
    }
  }
  if (exifId < 0 && xmpId < 0) return none;

  // iloc: where are those items stored?
  const v = meta.getUint8(iloc.start);
  let p = iloc.start + 4;
  const sizes1 = meta.getUint8(p++);
  const sizes2 = meta.getUint8(p++);
  const offsetSize = sizes1 >> 4;
  const lengthSize = sizes1 & 0xf;
  const baseOffsetSize = sizes2 >> 4;
  const indexSize = v === 1 || v === 2 ? sizes2 & 0xf : 0;
  const idWidth = v < 2 ? 2 : 4;
  const itemCount = uintN(meta, p, idWidth);
  p += idWidth;
  const found = new Map<number, DataView>();
  for (let i = 0; i < itemCount && p < iloc.end; i++) {
    const id = uintN(meta, p, idWidth);
    p += idWidth;
    let method = 0;
    if (v === 1 || v === 2) {
      method = meta.getUint16(p, false) & 0xf;
      p += 2;
    }
    p += 2; // data_reference_index
    const base = uintN(meta, p, baseOffsetSize);
    p += baseOffsetSize;
    const extentCount = meta.getUint16(p, false);
    p += 2;
    const extentLen = indexSize + offsetSize + lengthSize;
    if ((id !== exifId && id !== xmpId) || extentCount < 1) {
      p += extentCount * extentLen;
      continue;
    }
    const extOffset = uintN(meta, p + indexSize, offsetSize);
    const extLength = uintN(meta, p + indexSize + offsetSize, lengthSize);
    p += extentCount * extentLen;
    if (extLength < 1 || extLength > MAX_BLOCK) continue;
    if (method === 0) {
      const at = base + extOffset;
      found.set(id, await src.read(at, at + extLength));
    } else if (method === 1 && idat) {
      const at = idat.start + base + extOffset;
      if (at + extLength <= meta.byteLength) found.set(id, new DataView(meta.buffer, meta.byteOffset + at, extLength));
    }
  }
  let exif: ExifPart | null = null;
  const exifData = found.get(exifId);
  if (exifData && exifData.byteLength >= 12) {
    // The Exif item starts with a 4-byte offset to the TIFF header (usually 6, past "Exif\0\0").
    exif = exifFromTiff(exifData, 4 + exifData.getUint32(0, false));
  }
  const xmpData = found.get(xmpId);
  return { exif, xmp: xmpData ? latin1(xmpData) : null };
}

const hasDate = (e: ExifPart | null): boolean => !!e && !!(e.dateTimeOriginal || e.dateTimeDigitized || e.dateTime);

/**
 * Reads the date-related metadata of a photo. Never throws on bad input:
 * an unreadable file gives `{ format: "unknown", hasGps: false }`.
 */
export async function readMetadataFrom(src: ByteSource): Promise<PhotoMetadata> {
  const empty: PhotoMetadata = { format: "unknown", hasGps: false };
  try {
    const head = await src.read(0, HEAD_BYTES);
    if (head.byteLength < 12) return empty;
    const b0 = head.getUint16(0, false);
    let format: PhotoFormat = "unknown";
    let exif: ExifPart | null = null;
    let xmp: string | null = null;
    let pngTime: string | undefined;
    if (b0 === 0xffd8) {
      format = "jpeg";
      ({ exif, xmp } = jpegBlocks(head));
      if (!exif && !xmp && src.size > head.byteLength) {
        // Rare: very large APP segments in front of the Exif block. Read further, within bounds.
        ({ exif, xmp } = jpegBlocks(await src.read(0, Math.min(src.size, 4 * HEAD_BYTES))));
      }
    } else if (readAscii(head, 0, 4) === "RIFF" && readAscii(head, 8, 4) === "WEBP") {
      format = "webp";
      ({ exif, xmp } = await webpBlocks(src));
    } else if (readAscii(head, 4, 4) === "ftyp") {
      format = "heif";
      ({ exif, xmp } = await heifBlocks(src, head));
    } else if (head.getUint32(0, false) === 0x89504e47) {
      format = "png";
      ({ exif, xmp, time: pngTime } = await pngBlocks(src));
    } else if (b0 === 0x4949 || b0 === 0x4d4d) {
      format = "tiff";
      exif = exifFromTiff(head, 0);
      if (!hasDate(exif) && src.size > head.byteLength) {
        // TIFF can store its IFDs anywhere. Read the whole file when it is reasonably small.
        if (src.size <= 64 * 1024 * 1024) exif = exifFromTiff(await src.read(0, src.size), 0);
      }
    } else {
      return empty;
    }
    const out: PhotoMetadata = { format, hasGps: false, ...(exif ?? {}) };
    if (xmp) Object.assign(out, xmpDates(xmp));
    if (pngTime) out.pngTime = pngTime;
    for (const k of Object.keys(out) as (keyof PhotoMetadata)[]) if (out[k] === undefined) delete out[k];
    return out;
  } catch {
    return empty;
  }
}
