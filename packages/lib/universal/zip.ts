/**
 * A tiny, dependency-free ZIP archive writer.
 *
 * Files are stored uncompressed (the "store" method). This is intentional:
 * the only consumer bundles already-compressed PDFs, where deflate would add
 * CPU cost for virtually no size benefit. Keeping this dependency-free avoids
 * pulling a zip library into the server bundle.
 *
 * Limitations: no ZIP64, so the archive and each individual entry must be
 * smaller than 4GB. This is well within the bounds of bundling signed PDFs.
 */

export type ZipFile = {
  /** The name (including any directory path) the file should have inside the archive. */
  name: string;
  /** The raw file contents. */
  data: Uint8Array;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;

  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
};

// Fixed DOS timestamp (1980-01-01 00:00:00). The modification time is not
// meaningful for these archives, so a constant keeps the output deterministic.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

// General purpose bit 11 flags that file names are UTF-8 encoded.
const FLAG_UTF8 = 0x0800;

type ZipEntry = {
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
};

/**
 * Builds a ZIP archive (store method) from the provided files and returns the
 * raw bytes.
 */
export const createZip = (files: ZipFile[]): Uint8Array => {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [];

  const localParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true); // Version needed to extract
    view.setUint16(6, FLAG_UTF8, true); // General purpose bit flag
    view.setUint16(8, 0, true); // Compression method (0 = store)
    view.setUint16(10, DOS_TIME, true); // Last mod file time
    view.setUint16(12, DOS_DATE, true); // Last mod file date
    view.setUint32(14, crc, true); // CRC-32
    view.setUint32(18, file.data.length, true); // Compressed size
    view.setUint32(22, file.data.length, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true); // Extra field length
    header.set(nameBytes, 30);

    entries.push({ nameBytes, data: file.data, crc, offset });

    localParts.push(header, file.data);
    offset += header.length + file.data.length;
  }

  const centralStart = offset;
  const centralParts: Uint8Array[] = [];

  for (const entry of entries) {
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x02014b50, true); // Central directory file header signature
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed to extract
    view.setUint16(8, FLAG_UTF8, true); // General purpose bit flag
    view.setUint16(10, 0, true); // Compression method
    view.setUint16(12, DOS_TIME, true); // Last mod file time
    view.setUint16(14, DOS_DATE, true); // Last mod file date
    view.setUint32(16, entry.crc, true); // CRC-32
    view.setUint32(20, entry.data.length, true); // Compressed size
    view.setUint32(24, entry.data.length, true); // Uncompressed size
    view.setUint16(28, entry.nameBytes.length, true); // File name length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // File comment length
    view.setUint16(34, 0, true); // Disk number start
    view.setUint16(36, 0, true); // Internal file attributes
    view.setUint32(38, 0, true); // External file attributes
    view.setUint32(42, entry.offset, true); // Relative offset of local header
    header.set(entry.nameBytes, 46);

    centralParts.push(header);
    offset += header.length;
  }

  const centralSize = offset - centralStart;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);

  eocdView.setUint32(0, 0x06054b50, true); // End of central directory signature
  eocdView.setUint16(4, 0, true); // Number of this disk
  eocdView.setUint16(6, 0, true); // Disk where central directory starts
  eocdView.setUint16(8, entries.length, true); // Number of entries on this disk
  eocdView.setUint16(10, entries.length, true); // Total number of entries
  eocdView.setUint32(12, centralSize, true); // Size of central directory
  eocdView.setUint32(16, centralStart, true); // Offset of central directory
  eocdView.setUint16(20, 0, true); // Comment length

  const totalSize = offset + eocd.length;
  const output = new Uint8Array(totalSize);

  let cursor = 0;

  for (const part of [...localParts, ...centralParts, eocd]) {
    output.set(part, cursor);
    cursor += part.length;
  }

  return output;
};
