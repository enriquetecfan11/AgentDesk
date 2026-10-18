import { describe, expect, it } from 'vitest';

import { crc32, createZip } from '@/lib/zip';

describe('crc32', () => {
  it('matches the standard check value', () => {
    // The classic CRC-32 test vector.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('handles UTF-8 bytes above 0x7f', () => {
    const bytes = new TextEncoder().encode('ñandú');
    expect(crc32(bytes)).toBeGreaterThan(0);
    expect(crc32(bytes)).toBe(crc32(new TextEncoder().encode('ñandú')));
  });
});

describe('createZip', () => {
  const entries = [
    { name: 'Gestión de incidencias.md', content: '# Hola\n\nCon acentos: ñ.\n' },
    { name: 'Otra nota.md', content: 'ver [[Gestión de incidencias]]' },
  ];

  it('writes the local file header signature first', () => {
    const zip = createZip(entries);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('ends with the end-of-central-directory record', () => {
    const zip = createZip(entries);
    const tail = [...zip.slice(zip.length - 22, zip.length - 18)];
    expect(tail).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it('declares one entry per file, with offsets pointing inside the archive', () => {
    const zip = createZip(entries);

    // End of central directory: entries, size, offset.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    const count = view.getUint16(end + 10, true);
    const centralSize = view.getUint32(end + 12, true);
    const centralOffset = view.getUint32(end + 16, true);

    expect(count).toBe(2);
    expect(centralOffset + centralSize).toBe(end);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
  });

  it('embeds the file contents uncompressed', () => {
    const zip = createZip(entries);
    const text = new TextDecoder().decode(zip);

    expect(text).toContain('Con acentos: ñ.');
    expect(text).toContain('Gestión de incidencias.md');
  });

  it('produces a valid empty archive', () => {
    const zip = createZip([]);
    expect(zip.length).toBe(22);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
