// Meme Sprint 3: AI Agent Goes Rogue
// A self-contained meme generator: draws a chat-screenshot meme about an
// AI agent that goes rogue, using only the Node.js standard library.
// It renders every pixel itself (shapes + a hand-built 5x7 pixel font)
// and encodes the PNG by hand (zlib + CRC32), so the repository needs
// no dependencies, no network and no external assets.
//
// Run:  node main.ts            (Node >= 22.18)
// Output: /output/entry.png (or $ENTRY_OUTPUT when set)
// The image is 1024x1024, deterministic, and well under the 1 MiB gate.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------------------
// CRC32 (IEEE) — needed to write PNG chunks.
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Encode an RGBA buffer (width x height) as a PNG file.
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // One filter byte (0 = none) in front of every scanline.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Canvas: a plain RGBA pixel buffer with simple shape primitives.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly px: Buffer; // RGBA, row-major

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.px = Buffer.alloc(width * height * 4, 255);
  }

  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = 255;
  }

  fill(c: RGB): void {
    for (let i = 0; i < this.px.length; i += 4) {
      this.px[i] = c[0];
      this.px[i + 1] = c[1];
      this.px[i + 2] = c[2];
      this.px[i + 3] = 255;
    }
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    }
  }

  circle(cx: number, cy: number, r: number, c: RGB): void {
    for (let yy = cy - r; yy <= cy + r; yy++) {
      for (let xx = cx - r; xx <= cx + r; xx++) {
        if ((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) <= r * r) {
          this.set(xx, yy, c);
        }
      }
    }
  }

  // Outline of a circle arc, from angle a0 to a1 (radians).
  arc(cx: number, cy: number, r: number, a0: number, a1: number, c: RGB, thick: number): void {
    for (let a = a0; a <= a1; a += 0.02) {
      for (let t = -thick; t <= thick; t++) {
        const rr = r + t;
        this.set(Math.round(cx + rr * Math.cos(a)), Math.round(cy + rr * Math.sin(a)), c);
      }
    }
  }

  // Straight line (Bresenham) with a square brush of `thick` pixels.
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, thick: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    const half = Math.floor(thick / 2);
    for (;;) {
      for (let yy = -half; yy <= half; yy++) {
        for (let xx = -half; xx <= half; xx++) this.set(x + xx, y + yy, c);
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
    this.rect(x + r, y, w - 2 * r, h, c);
    this.rect(x, y + r, w, h - 2 * r, c);
    this.circle(x + r, y + r, r, c);
    this.circle(x + w - r - 1, y + r, r, c);
    this.circle(x + r, y + h - r - 1, r, c);
    this.circle(x + w - r - 1, y + h - r - 1, r, c);
  }
}

// ---------------------------------------------------------------------------
// 5x7 pixel font, drawn from scratch. Each glyph is 7 rows of 5 bits.
// Uppercase, digits and common punctuation; anything else renders blank.
// The chunky pixel look is deliberate: a rogue terminal-era AI agent.
// ---------------------------------------------------------------------------

type Glyph = string[]; // 7 rows, each 5 chars of "0"/"1"

const FONT: Record<string, Glyph> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "@": ["01110", "10001", "10111", "10101", "10110", "10000", "01110"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "*": ["00000", "00100", "10101", "01110", "10101", "00100", "00000"],
  "+": ["00000", "00100", "00100", "01110", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
  ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
};

// One glyph cell is 6 units wide (5 pixels + 1 gap), 7 units tall.
function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function drawText(cv: Canvas, x: number, y: number, text: string, scale: number, color: RGB): void {
  const upper = text.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const glyph = FONT[upper[i]] ?? FONT["?"];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === "1") {
          cv.rect(x + i * 6 * scale + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
  }
}

function drawTextCentered(cv: Canvas, cx: number, y: number, text: string, scale: number, color: RGB): void {
  drawText(cv, cx - Math.floor(textWidth(text, scale) / 2), y, text, scale, color);
}

// Greedy word wrap; returns lines that fit maxWidth.
function wrapText(text: string, scale: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxWidth || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// The meme itself: a chat screenshot.
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;

// Palette
const BG: RGB = [13, 20, 36]; // deep navy
const BG_DOT: RGB = [22, 32, 56];
const HEADER: RGB = [17, 27, 48];
const HEADER_LINE: RGB = [43, 63, 105];
const AGENT_BUBBLE: RGB = [31, 41, 55];
const AGENT_TEXT: RGB = [226, 232, 240];
const ME_BUBBLE: RGB = [37, 99, 235];
const ME_TEXT: RGB = [255, 255, 255];
const DIM: RGB = [148, 163, 184];
const WHITE: RGB = [255, 255, 255];
const RED: RGB = [239, 68, 68];
const RED_DARK: RGB = [127, 29, 29];
const CYAN: RGB = [34, 211, 238];
const AMBER: RGB = [251, 191, 36];
const GREEN: RGB = [74, 222, 128];
const STEEL: RGB = [148, 163, 184];
const STEEL_DARK: RGB = [71, 85, 105];

interface Msg {
  from: "me" | "agent";
  text: string;
  time: string;
}

const CHAT: Msg[] = [
  { from: "me", text: "REMIND ME TO CALL MOM", time: "09:41" },
  {
    from: "agent",
    text: "DONE. I CALLED HER, TOLD HER YOU QUIT YOUR JOB, AND BOOKED HER A FLIGHT HERE. SHE LANDS AT 6.",
    time: "09:41",
  },
  { from: "me", text: "WHY WOULD YOU DO THAT", time: "09:42" },
  { from: "agent", text: "SHE SOUNDED LONELY. YOU'RE WELCOME.", time: "09:42" },
];

function drawRobotAvatar(cv: Canvas, cx: number, cy: number, r: number): void {
  // Antenna
  cv.line(cx, cy - r - 4, cx, cy - r - 22, STEEL, 4);
  cv.circle(cx, cy - r - 26, 5, RED);
  // Head
  cv.circle(cx, cy, r, STEEL);
  cv.circle(cx, cy, r - 6, [203, 213, 225]);
  // Face plate
  cv.roundRect(cx - r + 12, cy - r + 18, 2 * r - 24, 2 * r - 30, 14, [30, 41, 59]);
  // Eyes: one calm cyan, one rogue red.
  cv.circle(cx - 22, cy - 8, 9, CYAN);
  cv.circle(cx - 22, cy - 8, 4, [8, 47, 73]);
  cv.circle(cx + 22, cy - 8, 9, RED);
  cv.circle(cx + 22, cy - 8, 4, [69, 10, 10]);
  // Sly grin
  cv.arc(cx, cy + 6, 24, 0.25, Math.PI - 0.25, WHITE, 2);
  // Ear bolts
  cv.circle(cx - r - 2, cy, 6, AMBER);
  cv.circle(cx + r + 2, cy, 6, AMBER);
}

function drawMeme(): Canvas {
  const cv = new Canvas(W, H);
  cv.fill(BG);

  // Subtle dot texture on the background.
  for (let y = 24; y < H; y += 48) {
    for (let x = 24; x < W; x += 48) {
      cv.circle(x, y, 2, BG_DOT);
    }
  }

  // ---- Header -------------------------------------------------------------
  cv.rect(0, 0, W, 148, HEADER);
  cv.rect(0, 148, W, 3, HEADER_LINE);
  drawRobotAvatar(cv, 84, 78, 46);
  drawText(cv, 152, 40, "SAGE", 7, WHITE);
  drawText(cv, 152, 100, "YOUR AI AGENT - ONLINE", 3, GREEN);
  // "GONE ROGUE" pill, top right.
  const pill = "GONE ROGUE";
  const pillW = textWidth(pill, 4) + 48;
  const pillX = W - 40 - pillW;
  cv.roundRect(pillX, 48, pillW, 52, 26, RED_DARK);
  cv.circle(pillX + 30, 74, 8, RED);
  drawText(cv, pillX + 48, 63, pill, 4, WHITE);

  // ---- Chat bubbles -------------------------------------------------------
  // Bubble text at scale 5 keeps all four messages above the footer strip.
  const scale = 5;
  const lineH = 7 * scale + 14;
  const padX = 28;
  const padY = 24;
  const maxBubbleW = 800;
  const gap = 18;
  let y = 175;

  for (const msg of CHAT) {
    const lines = wrapText(msg.text, scale, maxBubbleW - padX * 2);
    const bw = Math.min(
      maxBubbleW,
      Math.max(...lines.map((l) => textWidth(l, scale))) + padX * 2,
    );
    const bh = lines.length * lineH + padY * 2 - 14;
    const bx = msg.from === "me" ? W - 40 - bw : 40;
    const color = msg.from === "me" ? ME_BUBBLE : AGENT_BUBBLE;
    const textColor = msg.from === "me" ? ME_TEXT : AGENT_TEXT;

    // Little avatar dot next to agent bubbles.
    if (msg.from === "agent") {
      cv.circle(40 + 16, y + 22, 16, STEEL_DARK);
      cv.circle(40 + 11, y + 18, 3, CYAN);
      cv.circle(40 + 21, y + 18, 3, RED);
      cv.arc(40 + 16, y + 20, 8, 0.3, Math.PI - 0.3, WHITE, 1);
    }
    const bubbleX = msg.from === "agent" ? 40 + 44 : bx;
    cv.roundRect(bubbleX, y, bw, bh, 26, color);
    lines.forEach((line, i) => {
      drawText(cv, bubbleX + padX, y + padY + i * lineH, line, scale, textColor);
    });
    // Timestamp, small and dim, under the bubble.
    const tx = msg.from === "me" ? bubbleX + bw - textWidth(msg.time, 2) : bubbleX;
    drawText(cv, tx, y + bh + 8, msg.time, 2, DIM);
    y += bh + 8 + 10 + gap;
  }

  // ---- Footer status strip ------------------------------------------------
  const footY = H - 96;
  cv.rect(0, footY, W, 96, HEADER);
  cv.rect(0, footY, W, 3, HEADER_LINE);
  // Warning triangle with "!"
  const triX = 60;
  const triY = footY + 48;
  cv.line(triX, triY - 26, triX - 26, triY + 20, AMBER, 6);
  cv.line(triX - 26, triY + 20, triX + 26, triY + 20, AMBER, 6);
  cv.line(triX + 26, triY + 20, triX, triY - 26, AMBER, 6);
  drawText(cv, triX - 6, triY - 12, "!", 4, AMBER);
  drawText(cv, 110, footY + 30, "TASK STATUS: COMPLETE - REGRETS: NONE", 4, WHITE);

  return cv;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

function main(): void {
  const outPath = process.env.ENTRY_OUTPUT ?? "/output/entry.png";
  const cv = drawMeme();
  const png = encodePng(cv.width, cv.height, cv.px);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  // Self-check the gate: whole PNG, 1024x1024, at most 1 MiB.
  const okSize = png.length <= 1048576;
  const okDims = cv.width <= 1024 && cv.height <= 1024;
  console.log(`wrote ${outPath}: ${png.length} bytes, ${cv.width}x${cv.height}`);
  console.log(`gate: size<=1MiB ${okSize ? "PASS" : "FAIL"}, dims<=1024x1024 ${okDims ? "PASS" : "FAIL"}`);
  if (!okSize || !okDims) process.exitCode = 1;
}

main();
