const assert = require("assert");
const signature = require("./signature.js");

function makeImage(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) fill(data, i, i % width, Math.floor(i / width));
  return { width, height, data };
}

function paintRect(image, x0, y0, x1, y1, rgb) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * image.width + x) * 4;
      image.data[i] = rgb[0];
      image.data[i + 1] = rgb[1];
      image.data[i + 2] = rgb[2];
      image.data[i + 3] = 255;
    }
  }
}

function bgFill(data, i) {
  data[i * 4] = 7;
  data[i * 4 + 1] = 7;
  data[i * 4 + 2] = 12;
  data[i * 4 + 3] = 255;
}

const empty = makeImage(48, 72, bgFill);
const emptyScore = signature.scoreSignatureFrame(empty, null);
assert.ok(emptyScore.signatureScore < 0.18, "empty frames must score low");
assert.ok(emptyScore.presence < 0.01, "empty frames must have almost no presence");

const white = makeImage(48, 72, (data, i) => {
  data[i * 4] = 252;
  data[i * 4 + 1] = 252;
  data[i * 4 + 2] = 252;
  data[i * 4 + 3] = 255;
});
const whiteScore = signature.scoreSignatureFrame(white, null);

const colorful = makeImage(48, 72, bgFill);
paintRect(colorful, 8, 10, 20, 28, [168, 64, 255]);
paintRect(colorful, 26, 18, 40, 36, [255, 58, 168]);
paintRect(colorful, 14, 40, 34, 58, [32, 168, 255]);
const colorScore = signature.scoreSignatureFrame(colorful, null);

assert.ok(colorScore.signatureScore > whiteScore.signatureScore, "colorful matter beats a burned frame");
assert.ok(colorScore.signatureScore > emptyScore.signatureScore, "colorful matter beats an empty frame");
assert.ok(whiteScore.brightnessScore < 0.35, "near-white frames must be penalized");

const blob = makeImage(48, 72, bgFill);
paintRect(blob, 20, 30, 26, 36, [168, 64, 255]);
const blobScore = signature.scoreSignatureFrame(blob, null);
assert.ok(colorScore.complexityScore > blobScore.complexityScore, "multi-zone matter should be more complex");
assert.ok(colorScore.signatureScore > blobScore.signatureScore, "a rich composition should beat a tiny blob");

const corner = makeImage(48, 72, bgFill);
paintRect(corner, 0, 0, 10, 12, [255, 58, 168]);
const cornerScore = signature.scoreSignatureFrame(corner, null);
assert.ok(colorScore.compositionScore > cornerScore.compositionScore, "corner-stuck matter should not win composition");

const samples = [
  { id: "8", t: 8000, score: 70 },
  { id: "12", t: 12000, score: 71 },
  { id: "13", t: 13000, score: 78 },
  { id: "14", t: 14000, score: 84 },
  { id: "15", t: 15000, score: 86 },
  { id: "16", t: 16000, score: 83 },
  { id: "17", t: 17000, score: 69 },
  { id: "21", t: 21000, score: 80 },
  { id: "25", t: 25000, score: 77 },
  { id: "28", t: 28000, score: 75 },
];
const picked = signature.pickSignatureMoments(samples, { topN: 3, minGapMs: 2800 });
assert.ok(picked.length >= 2 && picked.length <= 3, "keep up to 3 diverse moments");
const times = picked.map((item) => item.t).sort((a, b) => a - b);
assert.ok(times[0] <= 12000, "include an early moment when the session is long");
assert.ok(times[times.length - 1] >= 21000, "include a late moment when the session is long");
const clusterHits = picked.filter((item) => item.t >= 14000 && item.t <= 16000).length;
assert.ok(clusterHits <= 1, "a tight 14-16s cluster must count as one moment");
for (let i = 1; i < times.length; i += 1) {
  assert.ok(times[i] - times[i - 1] >= 2500, "top moments must be temporally spaced");
}

const short = signature.pickSignatureMoments(
  [
    { id: "a", t: 400, score: 40 },
    { id: "b", t: 900, score: 62 },
  ],
  { topN: 3, minGapMs: 2800 }
);
assert.ok(short.length >= 1 && short.length <= 2, "short sessions must not invent extra moments");
assert.ok(new Set(short.map((item) => item.id)).size === short.length, "never duplicate moments");
console.log({
  empty: emptyScore.signatureScore.toFixed(3),
  white: whiteScore.signatureScore.toFixed(3),
  colorful: colorScore.signatureScore.toFixed(3),
  blob: blobScore.signatureScore.toFixed(3),
  picked: picked.map((item) => Math.round(item.t / 1000) + "s"),
});
