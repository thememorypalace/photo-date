/**
 * A small random-access reader over the input, so large files are never read
 * whole. A Blob (or File) is read in slices; bytes in memory are viewed in place.
 */

/** Anything the library can read: a File or Blob, an ArrayBuffer, or a typed array such as a Node Buffer. */
export type PhotoInput = Blob | ArrayBufferLike | ArrayBufferView;

export interface ByteSource {
  readonly size: number;
  /** Bytes in [start, end), clipped to the size of the input. */
  read(start: number, end: number): Promise<DataView>;
}

function isBlob(input: unknown): input is Blob {
  return typeof Blob !== "undefined" && input instanceof Blob;
}

export function toSource(input: PhotoInput): ByteSource {
  if (isBlob(input)) {
    const blob = input;
    return {
      size: blob.size,
      async read(start, end) {
        const s = Math.max(0, start);
        const e = Math.min(blob.size, end);
        if (e <= s) return new DataView(new ArrayBuffer(0));
        return new DataView(await blob.slice(s, e).arrayBuffer());
      },
    };
  }
  let view: DataView;
  if (ArrayBuffer.isView(input)) view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  else if (input && typeof (input as ArrayBufferLike).byteLength === "number") view = new DataView(input as ArrayBufferLike);
  else throw new TypeError("photo-date: expected a Blob, File, ArrayBuffer or typed array");
  return {
    size: view.byteLength,
    async read(start, end) {
      const s = Math.max(0, start);
      const e = Math.min(view.byteLength, end);
      if (e <= s) return new DataView(view.buffer, view.byteOffset, 0);
      return new DataView(view.buffer, view.byteOffset + s, e - s);
    },
  };
}

export function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  const end = Math.min(view.byteLength, offset + length);
  for (let i = offset; i < end; i++) {
    const c = view.getUint8(i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

/** Latin-1 view of a byte range, used to search for XMP packets. */
export function latin1(view: DataView, offset = 0, length = view.byteLength - offset): string {
  let out = "";
  const end = Math.min(view.byteLength, offset + length);
  for (let i = offset; i < end; i++) out += String.fromCharCode(view.getUint8(i));
  return out;
}
