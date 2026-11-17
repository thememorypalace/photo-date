/** Parsing of the date notations found in photo metadata and file names. */

export interface ParsedDate {
  /** The wall-clock time as written, without offset: "2014-07-19T11:04:32" or "2014-07-19". */
  local: string;
  /** UTC offset such as "+02:00", when the source states one. */
  offset?: string;
  /** False when only a day is known. */
  hasTime: boolean;
  /**
   * A Date for this moment. With a known offset it is exact. Without one, the
   * wall-clock time is interpreted in the time zone of the runtime, because
   * EXIF itself does not say where the photo was taken.
   */
  date: Date;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Earliest year we accept: the oldest surviving photograph is from 1826 or 1827. */
export const MIN_YEAR = 1826;

function normOffset(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (s === "Z") return "+00:00";
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(s);
  if (!m) return undefined;
  const h = Number(m[2]);
  const mi = Number(m[3]);
  if (h > 14 || mi > 59) return undefined;
  return `${m[1]}${m[2]}:${m[3]}`;
}

/** Builds a ParsedDate after checking that every part exists in the calendar. */
export function makeDate(
  y: number,
  mo: number,
  d: number,
  time?: { h: number; mi: number; s: number },
  offset?: string,
): ParsedDate | null {
  if (!Number.isInteger(y) || y < MIN_YEAR || y > 2200) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null; // such as 31 April
  let local = `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
  if (time) {
    const { h, mi, s } = time;
    if (h > 23 || mi > 59 || s > 59 || h < 0 || mi < 0 || s < 0) return null;
    local += `T${pad(h)}:${pad(mi)}:${pad(s)}`;
  }
  const off = normOffset(offset);
  let date: Date;
  if (off) {
    date = new Date(`${local}${time ? "" : "T00:00:00"}${off}`);
  } else {
    date = new Date(y, mo - 1, d, time?.h ?? 0, time?.mi ?? 0, time?.s ?? 0);
  }
  if (Number.isNaN(date.getTime())) return null;
  return { local, offset: off, hasTime: !!time, date };
}

/**
 * Parses an EXIF date such as "2014:07:19 11:04:32". Placeholders such as
 * "0000:00:00 00:00:00" and dates before 1826 give null.
 */
export function parseExifDate(value: string, offset?: string): ParsedDate | null {
  const m = /^\s*(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) return null;
  const time = m[4] !== undefined ? { h: Number(m[4]), mi: Number(m[5]), s: Number(m[6] ?? 0) } : undefined;
  return makeDate(Number(m[1]), Number(m[2]), Number(m[3]), time, offset);
}

/**
 * Parses an XMP date (ISO 8601 subset): "2014", "2014-07", "2014-07-19",
 * "2014-07-19T11:04", "2014-07-19T11:04:32.12+02:00". A year or month alone
 * gives null, because a day is needed to place a photo.
 */
export function parseXmpDate(value: string): ParsedDate | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?\s*$/.exec(value);
  if (!m) return null;
  const time = m[4] !== undefined ? { h: Number(m[4]), mi: Number(m[5]), s: Number(m[6] ?? 0) } : undefined;
  return makeDate(Number(m[1]), Number(m[2]), Number(m[3]), time, time ? m[7] : undefined);
}

/**
 * True for the default dates that cameras and phones write when their clock
 * was never set: midnight on 1 January 1970, 1980 or 2000.
 */
export function isClockNotSet(p: ParsedDate): boolean {
  return /^(1970|1980|2000)-01-01(T00:00:0\d)?$/.test(p.local);
}
