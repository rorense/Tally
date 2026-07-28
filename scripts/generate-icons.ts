/**
 * Draws the Tally mark and writes every icon slot app.json points at.
 * Run: npm run icons
 *
 * The mark is a five-count tally: four uprights crossed by a diagonal that
 * also reads as a rising trend line. Drawing it here rather than shipping
 * hand-exported art keeps the six variants in exact agreement, and lets the
 * Android foreground and monochrome slots be generated with real transparency.
 */
import { deflateSync } from 'node:zlib';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'assets');
if (!existsSync(OUT_DIR)) {
  throw new Error(`no assets directory at ${OUT_DIR} - run this from the project root`);
}

// Palette lifted from src/theme/theme.ts.
const BG = 0x0b0e14;
const GLOW = 0x141d2e;
const STROKE_TOP = 0x4bc5d9;
const STROKE_BOTTOM = 0x4f8dff;
const SLASH = 0xf2f5fa;

// --- PNG encoding ------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function encodePng(size: number, rgba: Uint8Array): Buffer {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Geometry ----------------------------------------------------------

/**
 * The mark laid out on a 1024 grid centred at (512, 512). Its bounding box is
 * 596 x 476, so it clears both the iOS squircle and, once scaled by
 * FOREGROUND_SCALE, the 66% safe circle of an Android adaptive icon.
 */
const GRID = 1024;
const UPRIGHT_WIDTH = 76;
const UPRIGHT_HALF_HEIGHT = 200;
const UPRIGHT_SPACING = 124;
const SLASH_WIDTH = 72;
const SLASH_REACH_X = 262;
const SLASH_REACH_Y = 178;
const FOREGROUND_SCALE = 0.85;

interface Capsule {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

const uprights: Capsule[] = [-1.5, -0.5, 0.5, 1.5].map((offset) => ({
  ax: 512 + offset * UPRIGHT_SPACING,
  ay: 512 - UPRIGHT_HALF_HEIGHT,
  bx: 512 + offset * UPRIGHT_SPACING,
  by: 512 + UPRIGHT_HALF_HEIGHT,
  r: UPRIGHT_WIDTH / 2,
}));

const slash: Capsule = {
  ax: 512 - SLASH_REACH_X,
  ay: 512 + SLASH_REACH_Y,
  bx: 512 + SLASH_REACH_X,
  by: 512 - SLASH_REACH_Y,
  r: SLASH_WIDTH / 2,
};

/** Signed distance to a capsule: negative inside, in grid units. */
function distance(px: number, py: number, c: Capsule): number {
  const pax = px - c.ax;
  const pay = py - c.ay;
  const bax = c.bx - c.ax;
  const bay = c.by - c.ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - c.r;
}

// --- Rasterising -------------------------------------------------------

/**
 * 8x8 Bayer threshold matrix. The centre glow spans only a few 8-bit steps, so
 * without dithering it quantises into visible concentric rings.
 */
const BAYER = (() => {
  let m = [[0, 2], [3, 1]];
  while (m.length < 8) {
    const n = m.length;
    const next = Array.from({ length: n * 2 }, () => new Array<number>(n * 2));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        next[y][x] = 4 * m[y][x];
        next[y][x + n] = 4 * m[y][x] + 2;
        next[y + n][x] = 4 * m[y][x] + 3;
        next[y + n][x + n] = 4 * m[y][x] + 1;
      }
    }
    m = next;
  }
  return m;
})();

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixRgb(a: number, b: number, t: number): [number, number, number] {
  return [
    lerp((a >> 16) & 0xff, (b >> 16) & 0xff, t),
    lerp((a >> 8) & 0xff, (b >> 8) & 0xff, t),
    lerp(a & 0xff, b & 0xff, t),
  ];
}

interface Options {
  size: number;
  /** Opaque dark plate with a centre glow, versus transparent. */
  background: boolean;
  /** Flat white mark for Android's themed-icon slot. */
  monochrome?: boolean;
  scale?: number;
}

function render({ size, background, monochrome = false, scale = 1 }: Options): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  // Grid units per pixel, so anti-aliasing stays a pixel wide at any size.
  const unitsPerPixel = GRID / size / scale;
  const glowRadius = 0.62 * GRID;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Pixel centre, mapped into the 1024 grid about its midpoint.
      const gx = 512 + (x + 0.5 - size / 2) * unitsPerPixel;
      const gy = 512 + (y + 0.5 - size / 2) * unitsPerPixel;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (background) {
        const fade = Math.min(1, Math.hypot(gx - 512, gy - 512) / glowRadius);
        [r, g, b] = mixRgb(GLOW, BG, fade * fade);
        a = 1;
      }

      const paint = (d: number, colour: [number, number, number]) => {
        const cov = Math.min(1, Math.max(0, 0.5 - d / unitsPerPixel));
        if (cov <= 0) return;
        const outA = cov + a * (1 - cov);
        r = (colour[0] * cov + r * a * (1 - cov)) / outA;
        g = (colour[1] * cov + g * a * (1 - cov)) / outA;
        b = (colour[2] * cov + b * a * (1 - cov)) / outA;
        a = outA;
      };

      const white: [number, number, number] = [255, 255, 255];
      for (const upright of uprights) {
        const t = Math.min(1, Math.max(0, (gy - (512 - UPRIGHT_HALF_HEIGHT)) / (UPRIGHT_HALF_HEIGHT * 2)));
        paint(distance(gx, gy, upright), monochrome ? white : mixRgb(STROKE_TOP, STROKE_BOTTOM, t));
      }
      paint(distance(gx, gy, slash), monochrome ? white : mixRgb(SLASH, SLASH, 0));

      const d = (BAYER[y & 7][x & 7] + 0.5) / 64 - 0.5;
      const i = (y * size + x) * 4;
      out[i] = Math.round(r + d);
      out[i + 1] = Math.round(g + d);
      out[i + 2] = Math.round(b + d);
      out[i + 3] = Math.round(a * 255);
    }
  }
  return out;
}

function plate(size: number, colour: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = (colour >> 16) & 0xff;
    out[i * 4 + 1] = (colour >> 8) & 0xff;
    out[i * 4 + 2] = colour & 0xff;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function write(name: string, size: number, pixels: Uint8Array): void {
  writeFileSync(join(OUT_DIR, name), encodePng(size, pixels));
  console.log(`wrote assets/${name} (${size}x${size})`);
}

write('icon.png', 1024, render({ size: 1024, background: true }));
write('splash-icon.png', 1024, render({ size: 1024, background: false }));
write('favicon.png', 256, render({ size: 256, background: true }));
write('android-icon-background.png', 1024, plate(1024, BG));
write(
  'android-icon-foreground.png',
  1024,
  render({ size: 1024, background: false, scale: FOREGROUND_SCALE })
);
write(
  'android-icon-monochrome.png',
  1024,
  render({ size: 1024, background: false, monochrome: true, scale: FOREGROUND_SCALE })
);
