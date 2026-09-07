(() => {
  "use strict";

  const CONTAINERS = {
    moov: true,
    trak: true,
    mdia: true,
    mvex: true,
    edts: true,
  };

  function getUint64(view, offset) {
    return view.getUint32(offset) * 0x100000000 + view.getUint32(offset + 4);
  }

  function setUint64(view, offset, value) {
    const clamped = Math.max(0, Math.round(value));
    view.setUint32(offset, Math.floor(clamped / 0x100000000));
    view.setUint32(offset + 4, clamped % 0x100000000);
  }

  function setDuration(view, offset, size, value) {
    const clamped = Math.max(0, Math.round(value));
    if (size === 8) {
      setUint64(view, offset, clamped);
      return;
    }
    view.setUint32(offset, Math.min(clamped, 0xffffffff));
  }

  function unitsFor(durationMs, timescale) {
    if (!timescale) return 0;
    return (durationMs * timescale) / 1000;
  }

  function boxType(bytes, offset) {
    return String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
  }

  function walkBoxes(bytes, view, start, end, onBox) {
    let offset = start;
    while (offset + 8 <= end) {
      const size32 = view.getUint32(offset);
      const type = boxType(bytes, offset + 4);
      let header = 8;
      let boxSize = size32;
      if (size32 === 1) {
        if (offset + 16 > end) break;
        boxSize = getUint64(view, offset + 8);
        header = 16;
      } else if (size32 === 0) {
        boxSize = end - offset;
      }
      if (boxSize < header || offset + boxSize > end) break;
      const boxEnd = offset + boxSize;
      onBox(type, offset, header, boxEnd);
      if (CONTAINERS[type]) walkBoxes(bytes, view, offset + header, boxEnd, onBox);
      offset = boxEnd;
    }
  }

  function parseMvhdMdhd(view, payload, boxEnd) {
    if (payload + 5 > boxEnd) return null;
    const version = view.getUint8(payload);
    if (version === 1) {
      if (payload + 32 > boxEnd) return null;
      return {
        version,
        timescale: view.getUint32(payload + 20),
        duration: getUint64(view, payload + 24),
        durationOffset: payload + 24,
        durationSize: 8,
      };
    }
    if (payload + 20 > boxEnd) return null;
    return {
      version: 0,
      timescale: view.getUint32(payload + 12),
      duration: view.getUint32(payload + 16),
      durationOffset: payload + 16,
      durationSize: 4,
    };
  }

  function parseTkhd(view, payload, boxEnd) {
    if (payload + 5 > boxEnd) return null;
    const version = view.getUint8(payload);
    if (version === 1) {
      if (payload + 36 > boxEnd) return null;
      return {
        version,
        duration: getUint64(view, payload + 28),
        durationOffset: payload + 28,
        durationSize: 8,
      };
    }
    if (payload + 24 > boxEnd) return null;
    return {
      version: 0,
      duration: view.getUint32(payload + 20),
      durationOffset: payload + 20,
      durationSize: 4,
    };
  }

  function parseMehd(view, payload, boxEnd) {
    if (payload + 5 > boxEnd) return null;
    const version = view.getUint8(payload);
    if (version === 1) {
      if (payload + 12 > boxEnd) return null;
      return {
        version,
        duration: getUint64(view, payload + 4),
        durationOffset: payload + 4,
        durationSize: 8,
      };
    }
    if (payload + 8 > boxEnd) return null;
    return {
      version: 0,
      duration: view.getUint32(payload + 4),
      durationOffset: payload + 4,
      durationSize: 4,
    };
  }

  function parseElst(view, payload, boxEnd) {
    if (payload + 8 > boxEnd) return null;
    const version = view.getUint8(payload);
    const entryCount = view.getUint32(payload + 4);
    if (entryCount !== 1) return null;
    const entryStart = payload + 8;
    if (version === 1) {
      if (entryStart + 8 > boxEnd) return null;
      return {
        version,
        duration: getUint64(view, entryStart),
        durationOffset: entryStart,
        durationSize: 8,
      };
    }
    if (entryStart + 4 > boxEnd) return null;
    return {
      version: 0,
      duration: view.getUint32(entryStart),
      durationOffset: entryStart,
      durationSize: 4,
    };
  }

  function collectFields(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fields = [];
    let movieTimescale = 0;
    walkBoxes(bytes, view, 0, bytes.length, (type, start, header, boxEnd) => {
      const payload = start + header;
      if (type === "mvhd") {
        const parsed = parseMvhdMdhd(view, payload, boxEnd);
        if (!parsed) return;
        movieTimescale = parsed.timescale;
        fields.push({ type, timescale: parsed.timescale, ...parsed });
        return;
      }
      if (type === "mdhd") {
        const parsed = parseMvhdMdhd(view, payload, boxEnd);
        if (!parsed) return;
        fields.push({ type, timescale: parsed.timescale, ...parsed });
        return;
      }
      if (type === "tkhd") {
        const parsed = parseTkhd(view, payload, boxEnd);
        if (!parsed) return;
        fields.push({ type, ...parsed });
        return;
      }
      if (type === "mehd") {
        const parsed = parseMehd(view, payload, boxEnd);
        if (!parsed) return;
        fields.push({ type, ...parsed });
        return;
      }
      if (type === "elst") {
        const parsed = parseElst(view, payload, boxEnd);
        if (!parsed) return;
        fields.push({ type, ...parsed });
      }
    });
    return { view, fields, movieTimescale };
  }

  function readDurationFields(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const { fields, movieTimescale } = collectFields(bytes);
    return {
      movieTimescale,
      fields: fields.map((field) => ({
        type: field.type,
        version: field.version,
        timescale: field.timescale || 0,
        duration: field.duration,
      })),
    };
  }

  function patchDuration(input, durationMs) {
    const ms = Number(durationMs);
    if (!input || !(ms > 0) || !isFinite(ms)) return null;
    const bytes = input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input);
    if (bytes.length < 16) return null;

    const { view, fields, movieTimescale } = collectFields(bytes);
    let patched = 0;
    for (let i = 0; i < fields.length; i += 1) {
      const field = fields[i];
      const timescale = field.type === "mdhd" ? field.timescale : movieTimescale || field.timescale;
      const units = unitsFor(ms, timescale);
      if (!timescale || !(units > 0)) continue;
      setDuration(view, field.durationOffset, field.durationSize, units);
      patched += 1;
    }
    return patched ? bytes : null;
  }

  const api = {
    patchDuration,
    readDurationFields,
  };

  if (typeof window !== "undefined") window.AURA_MP4 = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
