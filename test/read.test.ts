import { describe, expect, it } from "vitest";
import { readMetadata, readPhotoDate } from "../src/index.js";
import { T, heif, jpeg, png, tiff, webp, xmpPacket } from "./build.js";

const camera = tiff({
  ifd0: [
    [T.Make, "Canon"],
    [T.Model, "Canon EOS 5D"],
    [T.DateTime, "2015:01:02 09:00:00"],
  ],
  exif: [
    [T.DateTimeOriginal, "2014:07:19 11:04:32"],
    [T.DateTimeDigitized, "2014:07:19 11:04:32"],
    [T.OffsetTimeOriginal, "+02:00"],
  ],
  gps: true,
});

describe("JPEG", () => {
  it("reads DateTimeOriginal with offset, make, model and GPS presence", async () => {
    const r = await readPhotoDate(jpeg({ tiff: camera }));
    expect(r.metadata.format).toBe("jpeg");
    expect(r.metadata.make).toBe("Canon");
    expect(r.metadata.model).toBe("Canon EOS 5D");
    expect(r.metadata.hasGps).toBe(true);
    expect(r.best?.source).toBe("exif-original");
    expect(r.best?.confidence).toBe("high");
    expect(r.best?.local).toBe("2014-07-19T11:04:32");
    expect(r.best?.offset).toBe("+02:00");
    expect(r.best?.date.toISOString()).toBe("2014-07-19T09:04:32.000Z");
    expect(r.candidates.map((c) => c.source)).toEqual(["exif-original", "exif-digitized", "exif-modified"]);
  });

  it("reads big-endian TIFF inside the APP1 segment", async () => {
    const t = tiff({ little: false, exif: [[T.DateTimeOriginal, "2001:09:08 07:06:05"]] });
    const r = await readPhotoDate(jpeg({ tiff: t }));
    expect(r.best?.local).toBe("2001-09-08T07:06:05");
  });

  it("accepts dates written to IFD0 instead of the Exif sub-IFD", async () => {
    const t = tiff({ ifd0: [[T.DateTimeOriginal, "1999:12:31 23:59:59"]] });
    expect((await readPhotoDate(jpeg({ tiff: t }))).best?.local).toBe("1999-12-31T23:59:59");
  });

  it("falls back to XMP when there is no Exif block", async () => {
    const r = await readPhotoDate(jpeg({ xmp: xmpPacket('photoshop:DateCreated="2010-05-06"') }));
    expect(r.best?.source).toBe("xmp-date-created");
    expect(r.best?.confidence).toBe("medium");
    expect(r.best?.hasTime).toBe(false);
    expect(r.best?.local).toBe("2010-05-06");
  });

  it("reads XMP in element form with offset", async () => {
    const x = xmpPacket("").replace("/></rdf:RDF>", "><exif:DateTimeOriginal>2012-03-04T05:06:07+01:00</exif:DateTimeOriginal></rdf:Description></rdf:RDF>");
    const r = await readPhotoDate(jpeg({ xmp: x }));
    expect(r.best?.source).toBe("xmp-original");
    expect(r.best?.date.toISOString()).toBe("2012-03-04T04:06:07.000Z");
  });

  it("finds the Exif block behind a large APP2 segment", async () => {
    const r = await readPhotoDate(jpeg({ tiff: camera, padBefore: 60000 }));
    expect(r.best?.local).toBe("2014-07-19T11:04:32");
  });

  it("treats a scan (digitized only) as medium confidence", async () => {
    const t = tiff({ exif: [[T.DateTimeDigitized, "2023:02:01 10:00:00"]] });
    const r = await readPhotoDate(jpeg({ tiff: t }));
    expect(r.best?.source).toBe("exif-digitized");
    expect(r.best?.confidence).toBe("medium");
    expect(r.best?.note).toMatch(/scan/);
  });

  it("demotes the default date of a clock that was never set", async () => {
    const t = tiff({ exif: [[T.DateTimeOriginal, "2000:01:01 00:00:00"]] });
    const r = await readPhotoDate(jpeg({ tiff: t }), { name: "IMG_20180304_101112.jpg" });
    expect(r.best?.source).toBe("filename-camera");
    const exif = r.candidates.find((c) => c.source === "exif-original");
    expect(exif?.confidence).toBe("low");
  });

  it("ignores the 0000:00:00 placeholder", async () => {
    const t = tiff({ exif: [[T.DateTimeOriginal, "0000:00:00 00:00:00"]] });
    const r = await readPhotoDate(jpeg({ tiff: t }));
    expect(r.metadata.dateTimeOriginal).toBe("0000:00:00 00:00:00");
    expect(r.best).toBeNull();
  });
});

describe("PNG", () => {
  it("reads the eXIf chunk", async () => {
    const r = await readPhotoDate(png({ tiff: camera }));
    expect(r.metadata.format).toBe("png");
    expect(r.best?.local).toBe("2014-07-19T11:04:32");
  });

  it("reads eXIf after the image data", async () => {
    const r = await readPhotoDate(png({ tiff: camera, exifAfterIdat: true }));
    expect(r.best?.source).toBe("exif-original");
  });

  it("reads XMP from iTXt and the tIME chunk", async () => {
    const r = await readPhotoDate(png({ xmp: xmpPacket('photoshop:DateCreated="2023-01-05T14:22:10"'), time: [2023, 1, 6, 8, 0, 0] }));
    expect(r.best?.source).toBe("xmp-date-created");
    expect(r.best?.local).toBe("2023-01-05T14:22:10");
    const t = r.candidates.find((c) => c.source === "png-time");
    expect(t?.confidence).toBe("low");
    expect(t?.date.toISOString()).toBe("2023-01-06T08:00:00.000Z");
  });

  it("gives no date for a plain PNG without a usable name", async () => {
    const r = await readPhotoDate(png({}), { name: "image.png" });
    expect(r.best).toBeNull();
  });
});

describe("HEIC / HEIF / AVIF", () => {
  it("reads the Exif item at an absolute offset (iPhone layout)", async () => {
    const r = await readPhotoDate(heif({ tiff: camera }));
    expect(r.metadata.format).toBe("heif");
    expect(r.metadata.make).toBe("Canon");
    expect(r.best?.local).toBe("2014-07-19T11:04:32");
  });

  it("honours iloc base_offset (libheif layout)", async () => {
    const r = await readPhotoDate(heif({ tiff: camera, mode: "base-offset" }));
    expect(r.best?.local).toBe("2014-07-19T11:04:32");
  });

  it("reads an Exif item stored in idat", async () => {
    const r = await readPhotoDate(heif({ tiff: camera, mode: "idat", brand: "avif" }));
    expect(r.best?.local).toBe("2014-07-19T11:04:32");
  });
});

describe("WebP and TIFF", () => {
  it("reads the EXIF chunk of a WebP, with and without the Exif prefix", async () => {
    expect((await readPhotoDate(webp({ tiff: camera }))).best?.local).toBe("2014-07-19T11:04:32");
    const r = await readPhotoDate(webp({ tiff: camera, exifPrefix: true }));
    expect(r.metadata.format).toBe("webp");
    expect(r.best?.local).toBe("2014-07-19T11:04:32");
  });

  it("reads a bare TIFF file", async () => {
    const r = await readPhotoDate(camera);
    expect(r.metadata.format).toBe("tiff");
    expect(r.best?.local).toBe("2014-07-19T11:04:32");
  });
});

describe("inputs and robustness", () => {
  it("accepts ArrayBuffer, Uint8Array, Buffer and Blob", async () => {
    const bytes = jpeg({ tiff: camera });
    const inputs = [bytes, bytes.buffer, Buffer.from(bytes), new Blob([bytes])];
    for (const input of inputs) {
      expect((await readPhotoDate(input)).best?.local).toBe("2014-07-19T11:04:32");
    }
  });

  it("uses the name and lastModified of a File", async () => {
    const f = new File([png({})], "IMG-20190412-WA0003.png", { lastModified: Date.UTC(2020, 0, 2, 12) });
    const r = await readPhotoDate(f);
    expect(r.best?.source).toBe("filename-messenger");
    expect(r.best?.local).toBe("2019-04-12");
    expect(r.candidates[r.candidates.length - 1]?.source).toBe("file-modified");
  });

  it("can leave out the file date", async () => {
    const r = await readPhotoDate(png({}), { lastModified: Date.now() - 1000, ignoreFileDate: true });
    expect(r.candidates).toEqual([]);
  });

  it("never throws on junk, truncated or empty input", async () => {
    const full = jpeg({ tiff: camera });
    const samples = [new Uint8Array(0), new Uint8Array(5), Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256), full.slice(0, 40), heif({ tiff: camera }).slice(0, 120), png({ tiff: camera }).slice(0, 50)];
    for (const s of samples) {
      const r = await readPhotoDate(s);
      expect(Array.isArray(r.candidates)).toBe(true);
    }
    expect((await readMetadata(new Uint8Array(3))).format).toBe("unknown");
  });

  it("flags a capture date in the future", async () => {
    const t = tiff({ exif: [[T.DateTimeOriginal, "2030:01:01 10:00:00"]] });
    const r = await readPhotoDate(jpeg({ tiff: t }), { now: new Date(Date.UTC(2026, 10, 17)) });
    expect(r.best?.confidence).toBe("low");
    expect(r.best?.note).toMatch(/future/);
  });
});
