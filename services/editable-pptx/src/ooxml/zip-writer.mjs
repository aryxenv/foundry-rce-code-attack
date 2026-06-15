import { deflateRawSync } from "node:zlib";

const crcTable = new Uint32Array(256);

for (let i = 0; i < 256; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[i] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { dosDate, dosTime };
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

export class ZipWriter {
  #files = [];

  addFile(name, content, options = {}) {
    const source = Buffer.isBuffer(content)
      ? content
      : Buffer.from(String(content), "utf8");
    const compress = options.compress ?? true;
    const data = compress ? deflateRawSync(source) : source;

    this.#files.push({
      name: name.replaceAll("\\", "/"),
      data,
      sourceSize: source.length,
      compressedSize: data.length,
      crc: crc32(source),
      method: compress ? 8 : 0,
    });
  }

  toBuffer() {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { dosDate, dosTime } = dosDateTime();

    for (const file of this.#files) {
      const name = Buffer.from(file.name, "utf8");
      const localHeader = Buffer.concat([
        writeUInt32(0x04034b50),
        writeUInt16(20),
        writeUInt16(0),
        writeUInt16(file.method),
        writeUInt16(dosTime),
        writeUInt16(dosDate),
        writeUInt32(file.crc),
        writeUInt32(file.compressedSize),
        writeUInt32(file.sourceSize),
        writeUInt16(name.length),
        writeUInt16(0),
        name,
      ]);

      localParts.push(localHeader, file.data);

      const centralHeader = Buffer.concat([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0),
        writeUInt16(file.method),
        writeUInt16(dosTime),
        writeUInt16(dosDate),
        writeUInt32(file.crc),
        writeUInt32(file.compressedSize),
        writeUInt32(file.sourceSize),
        writeUInt16(name.length),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(offset),
        name,
      ]);

      centralParts.push(centralHeader);
      offset += localHeader.length + file.data.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const endOfCentralDirectory = Buffer.concat([
      writeUInt32(0x06054b50),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(this.#files.length),
      writeUInt16(this.#files.length),
      writeUInt32(centralDirectory.length),
      writeUInt32(offset),
      writeUInt16(0),
    ]);

    return Buffer.concat([
      ...localParts,
      centralDirectory,
      endOfCentralDirectory,
    ]);
  }
}

