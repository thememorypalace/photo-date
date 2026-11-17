/**
 * Builders for small synthetic image files with known metadata. They contain
 * only the structures the reader looks at, plus enough of the rest (markers,
 * chunks, boxes) to look like the real format.
 */

type Tag = [tag: number, value: string];

const enc = (s: string) => new TextEncoder().encode(s);

function concat(...parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

export interface TiffSpec {
  ifd0?: Tag[];
  exif?: Tag[];
  gps?: boolean;
  little?: boolean;
}

/** A TIFF structure: header, IFD0 (with optional Exif and GPS pointers), Exif sub-IFD, then the strings. */
export function tiff(spec: TiffSpec): Uint8Array<ArrayBuffer> {
  const little = spec.little ?? true;
  const ifd0 = [...(spec.ifd0 ?? [])];
  const exif = [...(spec.exif ?? [])];
  const buf = new Uint8Array(4096);
  const dv = new DataView(buf.buffer);
  const w16 = (o: number, v: number) => dv.setUint16(o, v, little);
  const w32 = (o: number, v: number) => dv.setUint32(o, v, little);
  buf.set(little ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  w16(2, 42);
  w32(4, 8);

  const ifd0Count = ifd0.length + (exif.length ? 1 : 0) + (spec.gps ? 1 : 0);
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifAt = 8 + ifd0Size;
  const exifSize = exif.length ? 2 + exif.length * 12 + 4 : 0;
  const gpsAt = exifAt + exifSize;
  const gpsSize = spec.gps ? 2 + 12 + 4 : 0;
  let data = gpsAt + gpsSize;

  const writeEntries = (at: number, tags: Tag[], extra: [number, number, number][]) => {
    const all: { tag: number; type: number; n: number; value: number | Uint8Array }[] = [
      ...tags.map(([tag, s]) => ({ tag, type: 2, n: s.length + 1, value: enc(s + "\0") })),
      ...extra.map(([tag, type, v]) => ({ tag, type, n: 1, value: v })),
    ].sort((a, b) => a.tag - b.tag);
    w16(at, all.length);
    all.forEach((e, i) => {
      const p = at + 2 + i * 12;
      w16(p, e.tag);
      w16(p + 2, e.type);
      w32(p + 4, e.n);
      if (typeof e.value === "number") w32(p + 8, e.value);
      else if (e.value.length <= 4) buf.set(e.value, p + 8);
      else {
        w32(p + 8, data);
        buf.set(e.value, data);
        data += e.value.length + (e.value.length & 1);
      }
    });
    w32(at + 2 + all.length * 12, 0);
  };

  const extra0: [number, number, number][] = [];
  if (exif.length) extra0.push([0x8769, 4, exifAt]);
  if (spec.gps) extra0.push([0x8825, 4, gpsAt]);
  writeEntries(8, ifd0, extra0);
  if (exif.length) writeEntries(exifAt, exif, []);
  if (spec.gps) writeEntries(gpsAt, [], [[0x0000, 1, 0x02020000]]);
  return buf.slice(0, data);
}

export const EXIF_PREFIX = enc("Exif\0\0");

function segment(marker: number, body: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat([0xff, marker], u16be(body.length + 2), body);
}

/** A JPEG with optional APP1 Exif and APP1 XMP segments and a few bytes of fake image data. */
export function jpeg(opts: { tiff?: Uint8Array; xmp?: string; app0?: boolean; padBefore?: number }): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [Uint8Array.from([0xff, 0xd8])];
  if (opts.app0 !== false) parts.push(segment(0xe0, concat(enc("JFIF\0"), [1, 1, 0, 0, 1, 0, 1, 0, 0])));
  if (opts.padBefore) parts.push(segment(0xe2, new Uint8Array(opts.padBefore)));
  if (opts.tiff) parts.push(segment(0xe1, concat(EXIF_PREFIX, opts.tiff)));
  if (opts.xmp) parts.push(segment(0xe1, concat(enc("http://ns.adobe.com/xap/1.0/\0"), enc(opts.xmp))));
  parts.push(segment(0xda, Uint8Array.from([1, 1, 0, 0, 0x3f, 0])));
  parts.push(Uint8Array.from([0x12, 0x34, 0x56, 0xff, 0xd9]));
  return concat(...parts);
}

function chunk(type: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(u32be(body.length), enc(type), body, [0, 0, 0, 0]); // CRC is not checked by the reader
}

/** A PNG with optional eXIf, XMP (iTXt) and tIME chunks. */
export function png(opts: { tiff?: Uint8Array; xmp?: string; time?: [number, number, number, number, number, number]; exifAfterIdat?: boolean }): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  parts.push(chunk("IHDR", Uint8Array.from([...u32be(1), ...u32be(1), 8, 2, 0, 0, 0])));
  if (opts.xmp) parts.push(chunk("iTXt", concat(enc("XML:com.adobe.xmp\0"), [0, 0], enc("\0\0"), enc(opts.xmp))));
  if (opts.time) {
    const [y, mo, d, h, mi, s] = opts.time;
    parts.push(chunk("tIME", Uint8Array.from([...u16be(y), mo, d, h, mi, s])));
  }
  const exif = opts.tiff ? chunk("eXIf", opts.tiff) : null;
  if (exif && !opts.exifAfterIdat) parts.push(exif);
  parts.push(chunk("IDAT", new Uint8Array(20)));
  if (exif && opts.exifAfterIdat) parts.push(exif);
  parts.push(chunk("IEND", new Uint8Array(0)));
  return concat(...parts);
}

function riffChunk(fourcc: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const size = body.length;
  const le = [size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff];
  return concat(enc(fourcc), le, body, size & 1 ? [0] : []);
}

/** A WebP (extended format) with an EXIF chunk after the image data. */
export function webp(opts: { tiff?: Uint8Array; xmp?: string; exifPrefix?: boolean }): Uint8Array<ArrayBuffer> {
  const body = concat(
    enc("WEBP"),
    riffChunk("VP8X", new Uint8Array(10)),
    riffChunk("VP8 ", new Uint8Array(15)),
    opts.tiff ? riffChunk("EXIF", opts.exifPrefix ? concat(EXIF_PREFIX, opts.tiff) : opts.tiff) : new Uint8Array(0),
    opts.xmp ? riffChunk("XMP ", enc(opts.xmp)) : new Uint8Array(0),
  );
  const n = body.length;
  return concat(enc("RIFF"), [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff], body);
}

function box(type: string, ...body: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const inner = concat(...body);
  return concat(u32be(inner.length + 8), enc(type), inner);
}

/**
 * A HEIF file in the layout iPhones use: ftyp, then meta (hdlr, pitm, iinf,
 * iloc), then mdat with the Exif item. `mode` picks how iloc points at it:
 * an absolute offset (iPhone), a base offset plus a relative extent (libheif),
 * or construction method 1 with the data inside idat.
 */
export function heif(opts: { tiff: Uint8Array; mode?: "absolute" | "base-offset" | "idat"; brand?: string }): Uint8Array<ArrayBuffer> {
  const mode = opts.mode ?? "absolute";
  const exifItem = concat(u32be(6), EXIF_PREFIX, opts.tiff);
  const ftyp = box("ftyp", enc(opts.brand ?? "heic"), u32be(0), enc("mif1"), enc(opts.brand ?? "heic"));
  const hdlr = box("hdlr", u32be(0), u32be(0), enc("pict"), new Uint8Array(12), [0]);
  const pitm = box("pitm", u32be(0), u16be(1));
  const infe = (id: number, type: string) => box("infe", [2, 0, 0, 0], u16be(id), u16be(0), enc(type), [0]);
  const iinf = box("iinf", u32be(0), u16be(2), infe(1, "hvc1"), infe(2, "Exif"));

  const buildIloc = (exifOffset: number, base: number, method: number) =>
    box(
      "iloc",
      [1, 0, 0, 0], // version 1
      [0x44, 0x40], // offset_size 4, length_size 4, base_offset_size 4, index_size 0
      u16be(2),
      // item 1: the image, 0 extents for brevity
      u16be(1), u16be(0), u16be(0), u32be(0), u16be(0),
      // item 2: Exif
      u16be(2), u16be(method), u16be(0), u32be(base), u16be(1), u32be(exifOffset), u32be(exifItem.length),
    );

  if (mode === "idat") {
    const idat = box("idat", exifItem);
    const iloc = buildIloc(0, 0, 1);
    const meta = box("meta", u32be(0), hdlr, pitm, iinf, iloc, idat);
    return concat(ftyp, meta, box("mdat", new Uint8Array(32)));
  }
  // Two passes: the offset of mdat depends on the size of meta, which does not change.
  const probeMeta = box("meta", u32be(0), hdlr, pitm, iinf, buildIloc(0, 0, 0));
  const mdatData = ftyp.length + probeMeta.length + 8 + 16; // 16 bytes of fake image data first
  const iloc = mode === "absolute" ? buildIloc(mdatData, 0, 0) : buildIloc(16, ftyp.length + probeMeta.length + 8, 0);
  const meta = box("meta", u32be(0), hdlr, pitm, iinf, iloc);
  return concat(ftyp, meta, box("mdat", new Uint8Array(16), exifItem));
}

export const xmpPacket = (props: string) =>
  `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" ${props}/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

export const T = {
  DateTimeOriginal: 0x9003,
  DateTimeDigitized: 0x9004,
  DateTime: 0x0132,
  OffsetTimeOriginal: 0x9011,
  Make: 0x010f,
  Model: 0x0110,
};
