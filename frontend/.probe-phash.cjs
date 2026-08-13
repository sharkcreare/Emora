var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/main/locallib/phash.ts
var phash_exports = {};
__export(phash_exports, {
  __dbgGrayMatrix__: () => __dbgGrayMatrix__,
  dHashFromPixels: () => dHashFromPixels,
  hammingDistance: () => hammingDistance,
  md5Of: () => md5Of,
  minRotationDistance: () => minRotationDistance,
  pHashFromPixels: () => pHashFromPixels,
  pHashRotFromPixels: () => pHashRotFromPixels
});
module.exports = __toCommonJS(phash_exports);
var import_node_crypto = require("node:crypto");
function md5Of(buffer) {
  return (0, import_node_crypto.createHash)("md5").update(buffer).digest("hex").slice(0, 16);
}
function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}
function dHashFromPixels(rgba, width, height) {
  const SW = 9;
  const SH = 8;
  const gray = new Uint8Array(SW * SH);
  const xs = width / SW;
  const ys = height / SH;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * xs));
      const sy = Math.min(height - 1, Math.floor((y + 0.5) * ys));
      const i = (sy * width + sx) * 4;
      gray[y * SW + x] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    }
  }
  let bits = "";
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW - 1; x++) {
      bits += gray[y * SW + x] > gray[y * SW + x + 1] ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}
var PHASH_N = 32;
var PHASH_M = 8;
function dct1d(input, n) {
  const out = new Float64Array(n);
  const scale0 = Math.sqrt(1 / n);
  const scale = Math.sqrt(2 / n);
  for (let u = 0; u < n; u++) {
    const cu = u === 0 ? scale0 : scale;
    let sum = 0;
    for (let x = 0; x < n; x++) {
      sum += input[x] * Math.cos((2 * x + 1) * u * Math.PI / (2 * n));
    }
    out[u] = cu * sum;
  }
  return out;
}
function dct2d(matrix, n) {
  const rows = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const row = dct1d(matrix.subarray(y * n, y * n + n), n);
    rows.set(row, y * n);
  }
  const out = new Float64Array(n * n);
  for (let x = 0; x < n; x++) {
    const col = new Float64Array(n);
    for (let y = 0; y < n; y++) col[y] = rows[y * n + x];
    const dct = dct1d(col, n);
    for (let y = 0; y < n; y++) out[y * n + x] = dct[y];
  }
  return out;
}
function grayMatrix(rgba, width, height) {
  const g = new Float64Array(PHASH_N * PHASH_N);
  const xs = width / PHASH_N;
  const ys = height / PHASH_N;
  for (let y = 0; y < PHASH_N; y++) {
    for (let x = 0; x < PHASH_N; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * xs));
      const sy = Math.min(height - 1, Math.floor((y + 0.5) * ys));
      const i = (sy * width + sx) * 4;
      g[y * PHASH_N + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
  }
  return g;
}
function rotate90(g, n) {
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out[x * n + (n - 1 - y)] = g[y * n + x];
    }
  }
  return out;
}
function hashFromDct(dct, n) {
  const coeffs = [];
  for (let v = 0; v < PHASH_M; v++) {
    for (let u = 0; u < PHASH_M; u++) {
      coeffs.push(dct[v * n + u]);
    }
  }
  const ac = coeffs.slice(1);
  const sorted = [...ac].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let bits = "";
  for (const c of coeffs) bits += c > median ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
function __dbgGrayMatrix__() {
  return { grayMatrix, dct2d, hashFromDct, PHASH_N };
}
function pHashFromPixels(rgba, width, height) {
  const gray = grayMatrix(rgba, width, height);
  const dct = dct2d(gray, PHASH_N);
  return hashFromDct(dct, PHASH_N);
}
function pHashRotFromPixels(rgba, width, height) {
  let gray = grayMatrix(rgba, width, height);
  const hashes = [];
  for (let k = 0; k < 4; k++) {
    const dct = dct2d(gray, PHASH_N);
    hashes.push(hashFromDct(dct, PHASH_N));
    gray = rotate90(gray, PHASH_N);
  }
  return hashes;
}
function minRotationDistance(a, b) {
  if (!a || !b || !a.length || !b.length) return Number.MAX_SAFE_INTEGER;
  let min = Number.MAX_SAFE_INTEGER;
  for (const ha of a) {
    for (const hb of b) {
      const d = hammingDistance(ha, hb);
      if (d < min) min = d;
    }
  }
  return min;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  __dbgGrayMatrix__,
  dHashFromPixels,
  hammingDistance,
  md5Of,
  minRotationDistance,
  pHashFromPixels,
  pHashRotFromPixels
});
