/**
 * Dates in file names. Phones, messaging apps and screenshot tools put a date
 * in the names they give files, and that date survives when the metadata is
 * stripped. What the date means depends on who wrote the name, so each pattern
 * says what kind of date it is.
 */
import { type ParsedDate, makeDate } from "./dates.js";

export type FilenameKind =
  /** Camera apps: IMG_20210704_153012.jpg, PXL_20210704_153012345.jpg, 20210704_153012.jpg. Moment of capture. */
  | "camera"
  /** Screenshots: Screenshot_20210704-153012.png, Screenshot 2021-07-04 at 15.30.12.png. Moment of the screenshot, not of what it shows. */
  | "screenshot"
  /** WhatsApp, Signal, Telegram: IMG-20210704-WA0003.jpg. Day the file was sent or saved, not taken. */
  | "messenger"
  /** Any other date in the name, such as scan-2021-07-04.jpg. Meaning unknown. */
  | "other";

export interface FilenameDate extends ParsedDate {
  kind: FilenameKind;
  /** Short name of the pattern that matched, such as "whatsapp" or "android-camera". */
  pattern: string;
}

export interface FilenameOptions {
  /** Dates after this moment are rejected. Default: now. */
  now?: Date;
}

type Hit = { y: string; mo: string; d: string; h?: string; mi?: string; s?: string; ampm?: string };

interface Pattern {
  name: string;
  kind: FilenameKind;
  re: RegExp;
  pick: (m: RegExpExecArray) => Hit;
}

const D8 = "((?:19|20)\\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])";
const T6 = "([01]\\d|2[0-3])([0-5]\\d)([0-5]\\d)";
const ISO_D = "((?:19|20)\\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])";

const seq = (m: RegExpExecArray, i: number): Hit => ({ y: m[i], mo: m[i + 1], d: m[i + 2], h: m[i + 3], mi: m[i + 4], s: m[i + 5] });

/** Ordered from most to least specific. The first match wins. */
const PATTERNS: Pattern[] = [
  // WhatsApp on phones: IMG-20190412-WA0003.jpg, VID-20190412-WA0003.mp4
  { name: "whatsapp", kind: "messenger", re: new RegExp(`^(?:IMG|VID|AUD|PTT|STK|DOC)-${D8}-WA\\d+`, "i"), pick: (m) => seq(m, 1) },
  // WhatsApp desktop and web: "WhatsApp Image 2021-03-04 at 12.34.56.jpeg"
  {
    name: "whatsapp-desktop",
    kind: "messenger",
    re: new RegExp(`^WhatsApp (?:Image|Video) ${ISO_D} at (\\d{1,2})\\.(\\d{2})\\.(\\d{2})(?:\\s*([AP]M))?`, "i"),
    pick: (m) => ({ ...seq(m, 1), ampm: m[7] }),
  },
  // Signal: signal-2021-03-04-123456.jpg, signal-2021-03-04-12-34-56-789.jpg
  {
    name: "signal",
    kind: "messenger",
    re: new RegExp(`^signal-${ISO_D}-([01]\\d|2[0-3])-?([0-5]\\d)-?([0-5]\\d)`, "i"),
    pick: (m) => seq(m, 1),
  },
  // Telegram desktop: photo_2021-03-04_12-34-56.jpg
  {
    name: "telegram",
    kind: "messenger",
    re: new RegExp(`^photo_${ISO_D}_([01]\\d|2[0-3])-([0-5]\\d)-([0-5]\\d)`, "i"),
    pick: (m) => seq(m, 1),
  },
  // Android: Screenshot_20210704-153012.png, Screenshot_2021-07-04-15-30-12-123_com.app.jpg
  {
    name: "android-screenshot",
    kind: "screenshot",
    re: new RegExp(`^Screenshot_(?:${D8}[-_]${T6}|${ISO_D}-([01]\\d|2[0-3])-([0-5]\\d)-([0-5]\\d))`, "i"),
    pick: (m) => (m[1] ? seq(m, 1) : seq(m, 7)),
  },
  // macOS: "Screenshot 2023-01-05 at 14.22.10.png", "Screen Shot 2019-05-01 at 9.41.22 AM.png"
  {
    name: "macos-screenshot",
    kind: "screenshot",
    re: new RegExp(`^Screen ?[Ss]hot ${ISO_D} at (\\d{1,2})\\.(\\d{2})\\.(\\d{2})(?:\\s*([AP]M))?`, "i"),
    pick: (m) => ({ ...seq(m, 1), ampm: m[7] }),
  },
  // Windows Snipping Tool: "Screenshot 2024-02-03 101112.png"
  {
    name: "windows-screenshot",
    kind: "screenshot",
    re: new RegExp(`^Screenshot ${ISO_D} ${T6}`, "i"),
    pick: (m) => seq(m, 1),
  },
  // Camera apps on Android and others: IMG_20210704_153012.jpg, VID_..., PXL_20210704_153012345.jpg, MVIMG_, PANO_
  {
    name: "android-camera",
    kind: "camera",
    re: new RegExp(`^(?:IMG|VID|PXL|MVIMG|PANO|BURST\\d*|LRG|TRIM)_${D8}_${T6}`, "i"),
    pick: (m) => seq(m, 1),
  },
  // Samsung and others: 20210704_153012.jpg
  { name: "samsung-camera", kind: "camera", re: new RegExp(`^${D8}_${T6}(?:\\D|$)`), pick: (m) => seq(m, 1) },
  // Screenshots from other tools, with any date in the name.
  {
    name: "screenshot",
    kind: "screenshot",
    re: new RegExp(`screen ?shot.*?((?:19|20)\\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\\d|3[01])`, "i"),
    pick: (m) => seq(m, 1),
  },
  // Anything else: a date with optional time, bounded by non-digits.
  {
    name: "date-in-name",
    kind: "other",
    re: new RegExp(
      `(?:^|\\D)((?:19|20)\\d{2})([-_.]?)(0[1-9]|1[0-2])\\2(0[1-9]|[12]\\d|3[01])(?:[-_ T.]?([01]\\d|2[0-3])[-_.:]?([0-5]\\d)[-_.:]?([0-5]\\d))?(?:\\D|$)`,
    ),
    pick: (m) => ({ y: m[1], mo: m[3], d: m[4], h: m[5], mi: m[6], s: m[7] }),
  },
];

function baseName(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] ?? name;
}

/**
 * Finds a date in a file name. Returns null when there is none, when the date
 * does not exist in the calendar, or when it lies in the future.
 */
export function dateFromFilename(name: string, options: FilenameOptions = {}): FilenameDate | null {
  const base = baseName(name);
  const now = options.now ?? new Date();
  for (const p of PATTERNS) {
    const m = p.re.exec(base);
    if (!m) continue;
    const hit = p.pick(m);
    let time: { h: number; mi: number; s: number } | undefined;
    if (hit.h !== undefined && hit.mi !== undefined) {
      let h = Number(hit.h);
      if (hit.ampm) {
        const pm = hit.ampm.toUpperCase() === "PM";
        if (h < 1 || h > 12) continue;
        if (pm && h < 12) h += 12;
        if (!pm && h === 12) h = 0;
      }
      time = { h, mi: Number(hit.mi), s: Number(hit.s ?? 0) };
    }
    const parsed = makeDate(Number(hit.y), Number(hit.mo), Number(hit.d), time);
    if (!parsed) continue;
    // A day in the future cannot be a capture date. Compare by day to stay clear of time zones.
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (parsed.local.slice(0, 10) > today) continue;
    return { ...parsed, kind: p.kind, pattern: p.name };
  }
  return null;
}
