// Gera os ícones PNG provisórios (garfo sobre adesivo amarelo). Uso: node tools/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const NAVY = [27, 30, 43];
const YELLOW = [255, 210, 63];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function roundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function isFork(x, y) {
  const tines = [0.385, 0.475, 0.565];
  for (const t of tines) if (roundRect(x, y, t, 0.24, t + 0.05, 0.5, 0.025)) return true;
  if (roundRect(x, y, 0.385, 0.44, 0.615, 0.56, 0.05)) return true;
  return roundRect(x, y, 0.465, 0.5, 0.535, 0.8, 0.035);
}

function pixel(x, y, padded) {
  const r = padded ? 0.36 : 0.42;
  const s = padded ? 0.82 : 1;
  const d = (x - 0.5) ** 2 + (y - 0.5) ** 2;
  if (d > r * r) return NAVY;
  const fx = (x - 0.5) / s + 0.5, fy = (y - 0.5) / s + 0.5;
  return isFork(fx, fy) ? NAVY : YELLOW;
}

function png(size, padded) {
  const ss = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = pixel((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, padded);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (ss * ss));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('icons/icon-192.png', png(192, false));
writeFileSync('icons/icon-512.png', png(512, false));
writeFileSync('icons/icon-maskable-512.png', png(512, true));
writeFileSync('icons/apple-touch-icon.png', png(180, false));
