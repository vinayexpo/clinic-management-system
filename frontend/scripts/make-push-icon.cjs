// Generates the push notification icon (192x192 PNG) for the Carehaven service worker.
const zlib = require("zlib");
const fs = require("fs");

const SIZE = 192;
const TEAL = [0x0b, 0x6b, 0x68];
const WHITE = [0xff, 0xff, 0xff];

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

// Rounded square background with a white medical cross.
const radius = SIZE * 0.22;
const armThickness = SIZE * 0.13;
const armLength = SIZE * 0.52;

function insideRoundedSquare(x, y) {
  const inset = 4;
  const left = inset;
  const right = SIZE - inset;
  const top = inset;
  const bottom = SIZE - inset;
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insideCross(x, y) {
  const centre = SIZE / 2;
  const halfArm = armLength / 2;
  const halfThickness = armThickness / 2;
  const inVertical = Math.abs(x - centre) <= halfThickness && Math.abs(y - centre) <= halfArm;
  const inHorizontal = Math.abs(y - centre) <= halfThickness && Math.abs(x - centre) <= halfArm;
  return inVertical || inHorizontal;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let offset = 0;
for (let y = 0; y < SIZE; y += 1) {
  raw[offset] = 0; // no filter
  offset += 1;
  for (let x = 0; x < SIZE; x += 1) {
    let colour = [0, 0, 0, 0];
    if (insideRoundedSquare(x + 0.5, y + 0.5)) {
      colour = insideCross(x + 0.5, y + 0.5) ? [...WHITE, 255] : [...TEAL, 255];
    }
    raw[offset] = colour[0];
    raw[offset + 1] = colour[1];
    raw[offset + 2] = colour[2];
    raw[offset + 3] = colour[3];
    offset += 4;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const target = process.argv[2];
fs.writeFileSync(target, png);
console.log(`wrote ${target} (${png.length} bytes)`);
