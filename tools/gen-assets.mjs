#!/usr/bin/env node
/**
 * 生成项目所需的图片资源（纯 Node 实现，无第三方依赖）：
 *  1. frontend/resources/icon.png / icon-32.png —— 应用图标 + 托盘图标（黄色笑脸）
 *  2. backend/src/main/resources/static/emojis/*.png —— 128x128 占位表情包（纯色底 + 简单图案）
 *
 * 用途：保证前后端在没有任何外部图片资源的情况下也能直接跑起来做联调。
 * 真实表情包上线后替换 static/emojis 目录即可，代码无需改动。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- PNG 编码（手写，最小实现） ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 绘制一张 RGBA 像素图并编码为 PNG */
function encodePng(width, height, pixelAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function savePng(file, width, height, pixelAt) {
  const buf = encodePng(width, height, pixelAt);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  console.log('generated', file, `(${buf.length} bytes)`);
}

/* ---------------- 颜色工具 ---------------- */

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** 由 HSV 转 RGB */
function hsv(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [clamp(r * 255), clamp(g * 255), clamp(b * 255)];
}

/* ---------------- 图案绘制 ---------------- */

/** 画一个笑脸：黄色底 + 黑色眼睛 + 黑色嘴弧 */
function drawSmiley(x, y, s, mode) {
  const cx = x / s, cy = y / s; // 归一化 0..1
  const bg = [250, 204, 21, 255]; // 黄
  // 嘴弧：位于中心下方的半圆环
  const inMouth = Math.abs((cx - 0.5) ** 2 + (cy - 0.62) ** 2 - 0.085) < 0.018 && cy > 0.55;
  // 眼睛
  const eyeL = (cx - 0.33) ** 2 + (cy - 0.38) ** 2 < 0.006;
  const eyeR = (cx - 0.67) ** 2 + (cy - 0.38) ** 2 < 0.006;
  if (inMouth || eyeL || eyeR) return [40, 40, 40, 255];
  return bg;
}

/**
 * 画占位表情：彩色底 + 中央白色圆形 + 对角白色条纹，不同表情用不同色相区分。
 * mode 0=圆点  1=对角条纹  2=棋盘格  3=中心方块
 */
function drawPlaceholder(x, y, s, hue, mode) {
  const cx = x / s, cy = y / s;
  const [r, g, b] = hsv(hue, 0.62, 0.92);
  let white = false;
  switch (mode % 4) {
    case 0: white = (cx - 0.5) ** 2 + (cy - 0.5) ** 2 < 0.16; break;
    case 1: white = Math.abs(cx - cy) < 0.1; break;
    case 2: white = (Math.floor(cx * 4) + Math.floor(cy * 4)) % 2 === 0; break;
    default: white = Math.abs(cx - 0.5) < 0.28 && Math.abs(cy - 0.5) < 0.28; break;
  }
  if (white) return [255, 255, 255, 255];
  return [r, g, b, 255];
}

/* ---------------- 生成 ---------------- */

// 1. 应用图标（256px）与托盘图标（32px）
for (const [size, name] of [[256, 'icon.png'], [32, 'icon-32.png']]) {
  savePng(join(root, 'frontend', 'resources', name), size, size, (x, y) => drawSmiley(x, y, size));
}

// 2. 占位表情包：10 个不同色相 + 图案
const EMOJI_COUNT = 10;
const EMOJI_DIR = join(root, 'backend', 'src', 'main', 'resources', 'static', 'emojis');
for (let i = 0; i < EMOJI_COUNT; i++) {
  const hue = i / EMOJI_COUNT;
  savePng(join(EMOJI_DIR, `emoji-${String(i + 1).padStart(2, '0')}.png`), 128, 128,
    (x, y) => drawPlaceholder(x, y, 128, hue, i));
}

console.log('\nAll assets generated.');
