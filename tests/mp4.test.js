const assert = require("assert");
const mp4 = require("../js/mp4.js");

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function u8(...values) {
  return new Uint8Array(values);
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function box(type, payload) {
  const body = payload instanceof Uint8Array ? payload : concat(payload);
  return concat([u32(8 + body.length), u8(type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)), body]);
}

function fullBox(type, version, payload) {
  return box(type, concat([u8(version, 0, 0, 0), payload instanceof Uint8Array ? payload : concat(payload)]));
}

function zeros(count) {
  return new Uint8Array(count);
}

function mvhd(timescale, duration, version) {
  if (version === 1) {
    return fullBox("mvhd", 1, concat([zeros(16), u32(timescale), u32(Math.floor(duration / 0x100000000)), u32(duration >>> 0), zeros(76)]));
  }
  return fullBox("mvhd", 0, concat([zeros(8), u32(timescale), u32(duration), zeros(80)]));
}

function tkhd(duration, version) {
  if (version === 1) {
    return fullBox("tkhd", 1, concat([zeros(24), u32(Math.floor(duration / 0x100000000)), u32(duration >>> 0), zeros(52)]));
  }
  return fullBox("tkhd", 0, concat([zeros(16), u32(duration), zeros(60)]));
}

function mdhd(timescale, duration, version) {
  if (version === 1) {
    return fullBox("mdhd", 1, concat([zeros(16), u32(timescale), u32(Math.floor(duration / 0x100000000)), u32(duration >>> 0), zeros(8)]));
  }
  return fullBox("mdhd", 0, concat([zeros(8), u32(timescale), u32(duration), zeros(8)]));
}

function mehd(duration, version) {
  if (version === 1) {
    return fullBox("mehd", 1, concat([u32(Math.floor(duration / 0x100000000)), u32(duration >>> 0)]));
  }
  return fullBox("mehd", 0, u32(duration));
}

function elst(duration) {
  return fullBox("elst", 0, concat([u32(1), u32(duration), u32(0), u32(0x00010000)]));
}

function durationOf(fields, type) {
  const hit = fields.find((field) => field.type === type);
  assert.ok(hit, "missing " + type);
  return hit.duration;
}

function makeFragmented(options) {
  const version = options.version || 0;
  const movieTs = options.movieTimescale;
  const mediaTs = options.mediaTimescale;
  const duration = options.duration || 0;
  const track = box("trak", [
    tkhd(duration, version),
    box("edts", [elst(duration)]),
    box("mdia", [mdhd(mediaTs, duration, version)]),
  ]);
  const fakeVideo = zeros(64);
  fakeVideo.set([0x6d, 0x6f, 0x6f, 0x76], 10);
  return concat([
    box("ftyp", u8(105, 115, 111, 53)),
    box("moov", [mvhd(movieTs, duration, version), track, box("mvex", [mehd(duration, version)])]),
    box("mdat", fakeVideo),
  ]);
}

const file = makeFragmented({ movieTimescale: 600, mediaTimescale: 90000, duration: 0 });
assert.strictEqual(mp4.patchDuration(file, 0), null, "skip empty duration");
assert.strictEqual(mp4.patchDuration(file, -1), null, "skip negative duration");
assert.strictEqual(mp4.patchDuration(new Uint8Array(4), 15000), null, "skip tiny buffer");

const patched = mp4.patchDuration(file, 15000);
assert.ok(patched, "patch a fragmented mp4 with duration 0");
assert.notStrictEqual(patched, file, "do not mutate the source bytes");

const before = mp4.readDurationFields(file);
assert.ok(before.fields.every((field) => field.duration === 0), "chrome-like headers start at 0");

const after = mp4.readDurationFields(patched);
assert.strictEqual(after.movieTimescale, 600);
assert.strictEqual(durationOf(after.fields, "mvhd"), 9000, "15s in movie timescale 600");
assert.strictEqual(durationOf(after.fields, "tkhd"), 9000);
assert.strictEqual(durationOf(after.fields, "mehd"), 9000);
assert.strictEqual(durationOf(after.fields, "elst"), 9000);
assert.strictEqual(durationOf(after.fields, "mdhd"), 1350000, "15s in media timescale 90000");

const v1 = makeFragmented({
  version: 1,
  movieTimescale: 1000,
  mediaTimescale: 48000,
  duration: 0,
});
const patchedV1 = mp4.patchDuration(v1, 12340);
const afterV1 = mp4.readDurationFields(patchedV1);
assert.strictEqual(durationOf(afterV1.fields, "mvhd"), 12340);
assert.strictEqual(durationOf(afterV1.fields, "mdhd"), 592320);

const alreadySet = makeFragmented({ movieTimescale: 1000, mediaTimescale: 1000, duration: 3000 });
const overwritten = mp4.readDurationFields(mp4.patchDuration(alreadySet, 8000));
assert.strictEqual(durationOf(overwritten.fields, "mvhd"), 8000, "overwrite a stale 3s header");

console.log("mp4 duration patch ok");
