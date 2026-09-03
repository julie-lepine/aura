/**
 * Génère l’icône d’app (fond #07070c, halo rose → lavande).
 * Source : assets/app-icon.svg
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const BG = [7, 7, 12];
const ROSE = [244, 201, 214];
const LAVENDER = [220, 201, 239];
const CORE = [255, 248, 252];

const SIZES = {
  mdpi: { launcher: 48, foreground: 108 },
  hdpi: { launcher: 72, foreground: 162 },
  xhdpi: { launcher: 96, foreground: 216 },
  xxhdpi: { launcher: 144, foreground: 324 },
  xxxhdpi: { launcher: 192, foreground: 432 },
};

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writePng(filePath, width, height, rgba) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encodePng(width, height, rgba));
}

function addGlow(buf, size, cx, cy, radius, rgb, strength, sharpness = 2.15) {
  const r2 = radius * radius;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 * 4) continue;
      const falloff = Math.exp((-d2 / r2) * sharpness);
      const a = falloff * strength;
      if (a < 0.002) continue;
      const i = (y * size + x) * 4;
      const srcA = buf[i + 3] / 255;
      const outA = srcA + a * (1 - srcA);
      if (outA <= 0) continue;
      buf[i] = Math.round((buf[i] * srcA + rgb[0] * a * (1 - srcA)) / outA);
      buf[i + 1] = Math.round((buf[i + 1] * srcA + rgb[1] * a * (1 - srcA)) / outA);
      buf[i + 2] = Math.round((buf[i + 2] * srcA + rgb[2] * a * (1 - srcA)) / outA);
      buf[i + 3] = Math.round(Math.min(255, outA * 255));
    }
  }
}

function renderGlow(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const mist = [
    Math.round((ROSE[0] + LAVENDER[0]) / 2),
    Math.round((ROSE[1] + LAVENDER[1]) / 2),
    Math.round((ROSE[2] + LAVENDER[2]) / 2),
  ];
  addGlow(buf, size, c, c, size * 0.46, mist, 0.22, 1.45);
  addGlow(buf, size, c * 0.9, c * 0.93, size * 0.34, ROSE, 0.82, 1.85);
  addGlow(buf, size, c * 1.1, c * 1.07, size * 0.32, LAVENDER, 0.8, 1.85);
  addGlow(buf, size, c, c, size * 0.16, mist, 0.68, 2.15);
  addGlow(buf, size, c, c, size * 0.07, CORE, 1, 2.7);
  addGlow(buf, size, c, c, size * 0.028, [255, 255, 255], 0.9, 3.6);
  return buf;
}

function compositeOnBg(glow, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const o = i * 4;
    const a = glow[o + 3] / 255;
    out[o] = Math.round(BG[0] * (1 - a) + glow[o] * a);
    out[o + 1] = Math.round(BG[1] * (1 - a) + glow[o + 1] * a);
    out[o + 2] = Math.round(BG[2] * (1 - a) + glow[o + 2] * a);
    out[o + 3] = 255;
  }
  return out;
}

function scaleNearestBox(src, srcSize, destSize) {
  const dest = Buffer.alloc(destSize * destSize * 4);
  const scale = srcSize / destSize;
  for (let y = 0; y < destSize; y += 1) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, Math.min(srcSize, Math.floor((y + 1) * scale)));
    for (let x = 0; x < destSize; x += 1) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.min(srcSize, Math.floor((x + 1) * scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * srcSize + sx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n += 1;
        }
      }
      const o = (y * destSize + x) * 4;
      dest[o] = Math.round(r / n);
      dest[o + 1] = Math.round(g / n);
      dest[o + 2] = Math.round(b / n);
      dest[o + 3] = Math.round(a / n);
    }
  }
  return dest;
}

const MASTER = 1024;
const glow = renderGlow(MASTER);
const full = compositeOnBg(glow, MASTER);

writePng(path.join(ROOT, "assets", "icon.png"), MASTER, MASTER, full);
writePng(path.join(ROOT, "assets", "icon-foreground.png"), MASTER, MASTER, glow);
writePng(path.join(ROOT, "assets", "icon-512.png"), 512, 512, scaleNearestBox(full, MASTER, 512));

const androidRes = path.join(ROOT, "android", "app", "src", "main", "res");
for (const [density, sizes] of Object.entries(SIZES)) {
  const dir = path.join(androidRes, `mipmap-${density}`);
  const launcher = scaleNearestBox(full, MASTER, sizes.launcher);
  const foreground = scaleNearestBox(glow, MASTER, sizes.foreground);
  writePng(path.join(dir, "ic_launcher.png"), sizes.launcher, sizes.launcher, launcher);
  writePng(path.join(dir, "ic_launcher_round.png"), sizes.launcher, sizes.launcher, launcher);
  writePng(path.join(dir, "ic_launcher_foreground.png"), sizes.foreground, sizes.foreground, foreground);
}

console.log("icône aura générée (assets/icon.png + mipmaps android)");
