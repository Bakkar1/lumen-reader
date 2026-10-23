// Draws Lumen Reader's placeholder icon (our own design: a rounded amber tile
// with three sound bars) as PNGs into public/. No image dependencies.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const TILE = [0xe0, 0x8a, 0x1e]; // amber
const BAR = [0xff, 0xfb, 0xf2]; // warm white

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pixel(x, y, n) {
  // Coordinates in a 0..1 unit square, sampled at the pixel centre.
  const u = (x + 0.5) / n;
  const v = (y + 0.5) / n;
  const r = 0.22;
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
  const bars = [
    { cx: 0.3, h: 0.3 },
    { cx: 0.5, h: 0.56 },
    { cx: 0.7, h: 0.4 },
  ];
  for (const { cx, h } of bars) {
    if (Math.abs(u - cx) < 0.065 && Math.abs(v - 0.5) < h / 2) return [...BAR, 255];
  }
  return [...TILE, 255];
}

function png(n) {
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    for (let x = 0; x < n; x++) {
      Buffer.from(pixel(x, y, n)).copy(raw, y * (n * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
for (const n of SIZES) writeFileSync(`public/icon-${n}.png`, png(n));
console.log(`wrote ${SIZES.map((n) => `public/icon-${n}.png`).join(', ')}`);
