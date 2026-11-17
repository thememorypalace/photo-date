import { describe, expect, it } from "vitest";
import { dateFromFilename, parseExifDate, parseXmpDate } from "../src/index.js";

const now = new Date(2026, 10, 17, 12);
const f = (name: string) => dateFromFilename(name, { now });

describe("dateFromFilename", () => {
  it.each([
    ["IMG-20190412-WA0003.jpg", "whatsapp", "messenger", "2019-04-12"],
    ["VID-20200101-WA0012.mp4", "whatsapp", "messenger", "2020-01-01"],
    ["WhatsApp Image 2021-03-04 at 12.34.56.jpeg", "whatsapp-desktop", "messenger", "2021-03-04T12:34:56"],
    ["WhatsApp Image 2021-03-04 at 9.05.01 PM.jpeg", "whatsapp-desktop", "messenger", "2021-03-04T21:05:01"],
    ["signal-2022-08-09-101112.jpg", "signal", "messenger", "2022-08-09T10:11:12"],
    ["signal-2022-08-09-10-11-12-345.jpg", "signal", "messenger", "2022-08-09T10:11:12"],
    ["photo_2021-03-04_12-34-56.jpg", "telegram", "messenger", "2021-03-04T12:34:56"],
    ["Screenshot_20210704-153012.png", "android-screenshot", "screenshot", "2021-07-04T15:30:12"],
    ["Screenshot_2021-07-04-15-30-12-123_com.example.app.jpg", "android-screenshot", "screenshot", "2021-07-04T15:30:12"],
    ["Screenshot 2023-01-05 at 14.22.10.png", "macos-screenshot", "screenshot", "2023-01-05T14:22:10"],
    ["Screen Shot 2019-05-01 at 9.41.22 AM.png", "macos-screenshot", "screenshot", "2019-05-01T09:41:22"],
    ["Screen Shot 2019-05-01 at 12.10.00 AM.png", "macos-screenshot", "screenshot", "2019-05-01T00:10:00"],
    ["Screenshot 2024-02-03 101112.png", "windows-screenshot", "screenshot", "2024-02-03T10:11:12"],
    ["IMG_20210704_153012.jpg", "android-camera", "camera", "2021-07-04T15:30:12"],
    ["PXL_20210704_153012345.jpg", "android-camera", "camera", "2021-07-04T15:30:12"],
    ["MVIMG_20190102_030405.jpg", "android-camera", "camera", "2019-01-02T03:04:05"],
    ["20210704_153012.jpg", "samsung-camera", "camera", "2021-07-04T15:30:12"],
    ["my screenshot from 2020.06.07.png", "screenshot", "screenshot", "2020-06-07"],
    ["scan-1998-05-06.jpg", "date-in-name", "other", "1998-05-06"],
    ["holiday_20180809.jpg", "date-in-name", "other", "2018-08-09"],
    ["C:\\Users\\someone\\Pictures\\IMG_20210704_153012.jpg", "android-camera", "camera", "2021-07-04T15:30:12"],
  ])("%s", (name, pattern, kind, local) => {
    const r = f(name);
    expect(r?.pattern).toBe(pattern);
    expect(r?.kind).toBe(kind);
    expect(r?.local).toBe(local);
  });

  it.each([
    "IMG_1234.JPG",
    "DSC01234.jpg",
    "photo.png",
    "IMG-20190231-WA0001.jpg", // 31 February
    "IMG_20991231_101010.jpg", // future
    "20211340_101010.jpg", // month 13
    "12020210704.jpg", // digits run on
  ])("no date in %s", (name) => {
    expect(f(name)).toBeNull();
  });
});

describe("parsers", () => {
  it("parses EXIF dates", () => {
    expect(parseExifDate("2014:07:19 11:04:32")?.local).toBe("2014-07-19T11:04:32");
    expect(parseExifDate("2014:07:19 11:04")?.local).toBe("2014-07-19T11:04:00");
    expect(parseExifDate("2014:07:19 11:04:32", "-05:00")?.date.toISOString()).toBe("2014-07-19T16:04:32.000Z");
    expect(parseExifDate("0000:00:00 00:00:00")).toBeNull();
    expect(parseExifDate("1800:01:01 00:00:00")).toBeNull();
    expect(parseExifDate("2014:02:30 10:00:00")).toBeNull();
    expect(parseExifDate("    :  :     :  :  ")).toBeNull();
  });

  it("parses XMP dates", () => {
    expect(parseXmpDate("2014-07-19")?.hasTime).toBe(false);
    expect(parseXmpDate("2014-07-19T11:04:32.25Z")?.date.toISOString()).toBe("2014-07-19T11:04:32.000Z");
    expect(parseXmpDate("2014-07")).toBeNull();
    expect(parseXmpDate("yesterday")).toBeNull();
  });
});
