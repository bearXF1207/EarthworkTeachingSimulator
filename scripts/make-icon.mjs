import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * 生成应用图标 build/icon.ico（256×256，PNG 载荷的 ICO 容器）。
 * 图案：绿色场地中央的开挖基坑截面（梯形坑 + 土层底色），纯像素绘制，无外部资源。
 * 一次性生成并提交到版本库；只有改图案时才需要重跑：node scripts/make-icon.mjs
 */

const SIZE = 256;

const pixels = Buffer.alloc(SIZE * SIZE * 4);
const set = (x, y, r, g, b) => {
  const offset = (y * SIZE + x) * 4;
  pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = b; pixels[offset + 3] = 255;
};

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const isPitTop = y >= 92 && y < 100;                       // 开口边界的深色描边
    const depth = (y - 100) / (208 - 100);                     // 0（坑顶）→ 1（坑底）
    const inPit = y >= 100 && y <= 208
      && x >= 128 - 84 + 44 * depth && x <= 128 + 84 - 44 * depth;
    if (inPit) {
      // 坑内土层：上浅下深的棕色渐变
      set(x, y, Math.round(150 - 40 * depth), Math.round(105 - 30 * depth), Math.round(66 - 20 * depth));
    } else if (isPitTop) {
      set(x, y, 32, 78, 50);                                   // 开口轮廓
    } else {
      set(x, y, 74, 148, 96);                                  // 场地绿
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});
const crc32 = buffer => {
  let c = 0xFFFFFFFF;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

const chunk = (type, data) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0; // 无过滤
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ICO 目录项布局：width,height,colors,reserved(各1字节，0 表示 256) planes,bpp(各2字节) size(4) offset(4)
const dir = Buffer.alloc(22);
dir.writeUInt16LE(0, 0);                       // reserved
dir.writeUInt16LE(1, 2);                       // type: icon
dir.writeUInt16LE(1, 4);                       // count
dir[6] = 0; dir[7] = 0; dir[8] = 0; dir[9] = 0;
dir.writeUInt16LE(1, 10);                      // planes
dir.writeUInt16LE(32, 12);                     // bpp
dir.writeUInt32LE(png.length, 14);
dir.writeUInt32LE(22, 18);

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'build');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([dir, png]));
console.log(`build/icon.ico 已生成（${png.length + 22} 字节，256×256）`);
process.exit(0);
