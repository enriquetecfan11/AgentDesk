/**
 * Minimal ZIP writer.
 *
 * The Markdown export has to leave the container as a single download that can
 * be unzipped into an Obsidian vault, and Node ships no ZIP library. Rather
 * than pull a dependency in, this writes the archive by hand with the STORE
 * method (no compression).
 *
 * The archives are small — a few hundred Markdown files — so skipping deflate
 * costs nothing that matters and removes both a dependency and a compression
 * bomb surface on the import side.
 */

export type ZipEntry = {
  /** Path inside the archive. Forward slashes only. */
  name: string;
  content: string;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return { time, date: day };
}

/** UTF-8 flagged, so notes with accents keep their names. */
const FLAG_UTF8 = 0x0800;
const VERSION = 20;
const METHOD_STORE = 0;

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number) {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number) {
    this.push(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  string(value: string) {
    this.push(new TextEncoder().encode(value));
  }

  get size() {
    return this.length;
  }

  concat(): Uint8Array {
    const output = new Uint8Array(this.length);
    let offset = 0;

    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }

    return output;
  }
}

export function createZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(now);
  const body = new ByteWriter();
  const central = new ByteWriter();
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = new TextEncoder().encode(entry.content);
    const checksum = crc32(data);

    // Local file header.
    body.u32(0x04034b50);
    body.u16(VERSION);
    body.u16(FLAG_UTF8);
    body.u16(METHOD_STORE);
    body.u16(time);
    body.u16(date);
    body.u32(checksum);
    body.u32(data.length);
    body.u32(data.length);
    body.u16(name.length);
    body.u16(0);
    body.push(name);
    body.push(data);

    // Central directory entry.
    central.u32(0x02014b50);
    central.u16(VERSION);
    central.u16(VERSION);
    central.u16(FLAG_UTF8);
    central.u16(METHOD_STORE);
    central.u16(time);
    central.u16(date);
    central.u32(checksum);
    central.u32(data.length);
    central.u32(data.length);
    central.u16(name.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(offset);
    central.push(name);

    offset += 30 + name.length + data.length;
  }

  const output = new ByteWriter();
  output.push(body.concat());
  const centralOffset = output.size;
  output.push(central.concat());
  const centralSize = output.size - centralOffset;

  // End of central directory.
  output.u32(0x06054b50);
  output.u16(0);
  output.u16(0);
  output.u16(entries.length);
  output.u16(entries.length);
  output.u32(centralSize);
  output.u32(centralOffset);
  output.u16(0);

  return output.concat();
}
