(() => {
  "use strict";

  const SIGNATURE_WEIGHTS = {
    presence: 1.2,
    brightness: 0.85,
    color: 1.1,
    complexity: 1.0,
    composition: 1.05,
    variation: 0.32,
  };

  const SIGNATURE_CONFIG = {
    intervalMs: 750,
    analyzeWidth: 48,
    maxSamples: 42,
    topN: 3,
    minGapMs: 2800,
    plateauMs: 3600,
    jpegQuality: 0.92,
    emptyPresence: 0.01,
    bg: [7, 7, 12],
  };

  const samples = [];
  let running = false;
  let paused = false;
  let raf = 0;
  let lastCaptureAt = 0;
  let pendingEncodes = 0;
  let previousCells = null;
  let analyzeCanvas = null;
  let analyzeCtx = null;
  const holdPool = [];
  let selectedId = "";
  let topMoments = [];
  let signatureFrame = null;

  function luma(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function chroma(r, g, b) {
    return Math.max(r, g, b) - Math.min(r, g, b);
  }

  function hueBucket(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d < 18) return -1;
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    if (h < 0) h += 6;
    return Math.min(5, Math.floor(h));
  }

  function ramp(value, start, peakLo, peakHi, end) {
    if (value <= start || value >= end) return 0;
    if (value >= peakLo && value <= peakHi) return 1;
    if (value < peakLo) return (value - start) / Math.max(0.0001, peakLo - start);
    return (end - value) / Math.max(0.0001, end - peakHi);
  }

  function mean(values) {
    if (!values.length) return 0;
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) sum += values[i];
    return sum / values.length;
  }

  function stdev(values) {
    if (values.length < 2) return 0;
    const avg = mean(values);
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      const d = values[i] - avg;
      sum += d * d;
    }
    return Math.sqrt(sum / values.length);
  }

  function scoreSignatureFrame(image, priorCells) {
    const width = image.width;
    const height = image.height;
    const data = image.data;
    const count = width * height;
    const cols = 8;
    const rows = 12;
    const cellW = width / cols;
    const cellH = height / rows;
    const cellLuma = new Float32Array(cols * rows);
    const cellMass = new Float32Array(cols * rows);
    const hueHist = [0, 0, 0, 0, 0, 0];

    let matter = 0;
    let lumSum = 0;
    let chromaSum = 0;
    let clip = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let cx = 0;
    let cy = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const yL = luma(r, g, b);
        const cell = Math.min(cols - 1, Math.floor(x / cellW)) + Math.min(rows - 1, Math.floor(y / cellH)) * cols;
        cellLuma[cell] += yL;
        if (yL < 16) continue;
        matter += 1;
        lumSum += yL;
        chromaSum += chroma(r, g, b);
        if (yL > 242) clip += 1;
        const bucket = hueBucket(r, g, b);
        if (bucket >= 0) hueHist[bucket] += 1;
        cellMass[cell] += yL;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        cx += x;
        cy += y;
      }
    }

    const presence = matter / count;
    const presenceScore = ramp(presence, 0.008, 0.1, 0.42, 0.92) * (presence < 0.02 ? 0.35 : 1);

    const avgLum = matter ? lumSum / matter / 255 : 0;
    const clipRatio = matter ? clip / matter : 0;
    const brightnessScore = Math.max(
      0,
      ramp(avgLum, 0.06, 0.2, 0.56, 0.9) * (1 - clipRatio * 1.35)
    );

    const avgChroma = matter ? chromaSum / matter / 255 : 0;
    let hueUsed = 0;
    let hueTotal = 0;
    for (let i = 0; i < hueHist.length; i += 1) {
      hueTotal += hueHist[i];
      if (hueHist[i] > 0) hueUsed += 1;
    }
    const hueDiversity = hueTotal ? hueUsed / hueHist.length : 0;
    const colorScore = Math.min(1, avgChroma * 1.35) * 0.68 + hueDiversity * 0.32;

    let activeCells = 0;
    const activeLumas = [];
    for (let i = 0; i < cellLuma.length; i += 1) {
      const avg = cellLuma[i] / Math.max(1, cellW * cellH);
      if (avg > 18) {
        activeCells += 1;
        activeLumas.push(avg);
      }
    }
    const complexityScore = Math.min(1, activeCells / 14) * 0.72 + Math.min(1, stdev(activeLumas) / 42) * 0.28;

    let compositionScore = 0;
    if (matter > 0) {
      const bw = (maxX - minX + 1) / width;
      const bh = (maxY - minY + 1) / height;
      const coverage = bw * bh;
      const coverScore = ramp(coverage, 0.04, 0.16, 0.62, 0.96);
      const mx = cx / matter / width;
      const my = cy / matter / height;
      const dist = Math.hypot(mx - 0.5, my - 0.5);
      const balance = ramp(dist, 0, 0.08, 0.34, 0.72);
      const corner = mx < 0.12 || mx > 0.88 || my < 0.1 || my > 0.9 ? 0.45 : 1;
      let occupied = 0;
      const regions = 8;
      for (let i = 0; i < cellMass.length; i += 1) {
        if (cellMass[i] > 0) occupied += 1;
      }
      const spread = Math.min(1, occupied / regions);
      compositionScore = coverScore * 0.4 + balance * 0.28 + spread * 0.32;
      compositionScore *= corner;
    }

    let variationScore = 0.45;
    if (priorCells && priorCells.length === cellMass.length) {
      let diff = 0;
      for (let i = 0; i < cellMass.length; i += 1) {
        diff += Math.abs(cellMass[i] - priorCells[i]);
      }
      const norm = diff / (count * 18);
      variationScore = ramp(norm, 0.01, 0.12, 0.48, 1.15);
    }

    const weights = SIGNATURE_WEIGHTS;
    const weightSum =
      weights.presence +
      weights.brightness +
      weights.color +
      weights.complexity +
      weights.composition +
      weights.variation;
    const signatureScore =
      (presenceScore * weights.presence +
        brightnessScore * weights.brightness +
        colorScore * weights.color +
        complexityScore * weights.complexity +
        compositionScore * weights.composition +
        variationScore * weights.variation) /
      weightSum;

    return {
      signatureScore,
      presenceScore,
      brightnessScore,
      colorScore,
      complexityScore,
      compositionScore,
      variationScore,
      presence,
      cells: cellMass,
    };
  }

  function smoothScores(list) {
    return list.map((item, i) => {
      const prev = i > 0 ? list[i - 1].score : item.score;
      const next = i < list.length - 1 ? list[i + 1].score : item.score;
      return 0.25 * prev + 0.5 * item.score + 0.25 * next;
    });
  }

  function refinePlateau(ranked, peak, plateauMs) {
    const thresh = peak.smoothed * 0.88;
    const span = plateauMs || SIGNATURE_CONFIG.plateauMs;
    let left = peak.index;
    let right = peak.index;
    while (
      left > 0 &&
      ranked[left - 1].smoothed >= thresh &&
      peak.t - ranked[left - 1].t <= span
    ) {
      left -= 1;
    }
    while (
      right < ranked.length - 1 &&
      ranked[right + 1].smoothed >= thresh &&
      ranked[right + 1].t - peak.t <= span
    ) {
      right += 1;
    }
    const centerT = (ranked[left].t + ranked[right].t) * 0.5;
    let best = ranked[left];
    let bestDist = Math.abs(best.t - centerT);
    for (let i = left + 1; i <= right; i += 1) {
      const dist = Math.abs(ranked[i].t - centerT);
      if (dist < bestDist) {
        best = ranked[i];
        bestDist = dist;
      }
    }
    return best;
  }

  function visualDistance(a, b) {
    const cellsA = a && a.cells;
    const cellsB = b && b.cells;
    if (!cellsA || !cellsB || cellsA.length !== cellsB.length) {
      return Math.min(1, Math.abs((a.t || 0) - (b.t || 0)) / 8000);
    }
    let diff = 0;
    for (let i = 0; i < cellsA.length; i += 1) {
      diff += Math.abs(cellsA[i] - cellsB[i]);
    }
    return Math.min(1, diff / (cellsA.length * 36));
  }

  function diversityFromPicked(item, picked, minGap) {
    if (!picked.length) return 1;
    let worst = 1;
    for (let i = 0; i < picked.length; i += 1) {
      const timePart = Math.min(1, Math.abs(item.t - picked[i].t) / Math.max(minGap, 1));
      const lookPart = visualDistance(item, picked[i]);
      worst = Math.min(worst, timePart * 0.62 + lookPart * 0.38);
    }
    return worst;
  }

  function pickSignatureMoments(list, options) {
    const topN = (options && options.topN) || SIGNATURE_CONFIG.topN;
    const plateauMs = (options && options.plateauMs) || SIGNATURE_CONFIG.plateauMs;
    if (!list.length) return [];
    const duration = list[list.length - 1].t - list[0].t;
    const minGap = Math.max(
      1000,
      Math.min((options && options.minGapMs) || SIGNATURE_CONFIG.minGapMs, duration / 3.4 || SIGNATURE_CONFIG.minGapMs)
    );
    const ranked = list.map((item, index) => ({
      ...item,
      index,
      score: item.score,
      smoothed: 0,
    }));
    const smoothed = smoothScores(ranked);
    for (let i = 0; i < ranked.length; i += 1) ranked[i].smoothed = smoothed[i];

    const peaks = [];
    for (let i = 0; i < ranked.length; i += 1) {
      const sm = ranked[i].smoothed;
      const left = i === 0 ? sm : ranked[i - 1].smoothed;
      const right = i === ranked.length - 1 ? sm : ranked[i + 1].smoothed;
      if (sm >= left && sm >= right) peaks.push(ranked[i]);
    }
    if (!peaks.length) {
      peaks.push(
        ranked.reduce((best, item) => (item.smoothed > best.smoothed ? item : best), ranked[0])
      );
    }

    const candidates = peaks
      .map((peak) => refinePlateau(ranked, peak, plateauMs))
      .concat(ranked)
      .filter((item, index, all) => all.findIndex((entry) => entry.id === item.id) === index);

    const bestPeak = candidates.reduce(
      (best, item) => (!best || item.smoothed > best.smoothed ? item : best),
      null
    );
    const picked = bestPeak ? [bestPeak] : [];

    const pickBestInRange = (fromT, toT) => {
      let best = null;
      for (let i = 0; i < candidates.length; i += 1) {
        const item = candidates[i];
        if (item.t < fromT || item.t > toT) continue;
        if (picked.some((entry) => entry.id === item.id)) continue;
        const diversity = diversityFromPicked(item, picked, minGap);
        if (diversity < 0.32) continue;
        if (!best || item.smoothed > best.smoothed) best = item;
      }
      return best;
    };

    const before = pickBestInRange(-Infinity, bestPeak ? bestPeak.t - minGap : Infinity);
    if (before) picked.push(before);
    const after = pickBestInRange(bestPeak ? bestPeak.t + minGap : -Infinity, Infinity);
    if (after) picked.push(after);

    while (picked.length < topN) {
      let best = null;
      let bestValue = -1;
      for (let i = 0; i < candidates.length; i += 1) {
        const item = candidates[i];
        if (picked.some((entry) => entry.id === item.id)) continue;
        const diversity = diversityFromPicked(item, picked, minGap);
        if (diversity < 0.32) continue;
        const value = item.smoothed * (0.45 + diversity * 0.55);
        if (value > bestValue) {
          best = item;
          bestValue = value;
        }
      }
      if (!best) break;
      picked.push(best);
    }

    picked.sort((a, b) => a.t - b.t);
    return picked.slice(0, topN);
  }

  function ensureAnalyze(width, height) {
    if (typeof document === "undefined") return null;
    if (!analyzeCanvas) {
      analyzeCanvas = document.createElement("canvas");
      analyzeCtx = analyzeCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (analyzeCanvas.width !== width || analyzeCanvas.height !== height) {
      analyzeCanvas.width = width;
      analyzeCanvas.height = height;
    }
    return analyzeCtx;
  }

  function acquireHold(width, height) {
    const hold = holdPool.pop() || document.createElement("canvas");
    if (hold.width !== width || hold.height !== height) {
      hold.width = width;
      hold.height = height;
    }
    return hold;
  }

  function releaseHold(hold) {
    if (holdPool.length < 2) holdPool.push(hold);
  }

  function slugify(value) {
    const text = String(value || "aura")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return text || "aura";
  }

  function revokeSample(sample) {
    if (sample && sample.url) URL.revokeObjectURL(sample.url);
    sample.url = "";
    sample.blob = null;
  }

  function pruneBlobs(keepIds) {
    const keep = {};
    keepIds.forEach((id) => {
      keep[id] = true;
    });
    samples.forEach((sample) => {
      if (!keep[sample.id]) revokeSample(sample);
    });
  }

  function captureNow(force) {
    const source = window.AURA_ENGINE && window.AURA_ENGINE.getCanvas();
    if (!source || !source.width || !source.height) return null;
    const elapsed = window.AURA_RECORD ? window.AURA_RECORD.getElapsedMs() : 0;
    const aw = SIGNATURE_CONFIG.analyzeWidth;
    const ah = Math.max(32, Math.min(96, Math.round((aw * source.height) / source.width)));
    const ctx = ensureAnalyze(aw, ah);
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, aw, ah);
    const image = ctx.getImageData(0, 0, aw, ah);
    const scored = scoreSignatureFrame(image, previousCells);
    previousCells = scored.cells;

    if (!force && scored.presence < SIGNATURE_CONFIG.emptyPresence) {
      return null;
    }

    if (!force && pendingEncodes >= 2) return null;
    const hold = acquireHold(source.width, source.height);
    hold.getContext("2d").drawImage(source, 0, 0);

    const sample = {
      id: `${elapsed}-${samples.length}`,
      t: elapsed,
      score: scored.signatureScore,
      presence: scored.presence,
      cells: scored.cells,
      blob: null,
      url: "",
      width: source.width,
      height: source.height,
    };
    samples.push(sample);
    if (samples.length > SIGNATURE_CONFIG.maxSamples) {
      const dropped = samples.shift();
      revokeSample(dropped);
    }

    pendingEncodes += 1;
    hold.toBlob(
      (blob) => {
        pendingEncodes = Math.max(0, pendingEncodes - 1);
        releaseHold(hold);
        if (!blob) return;
        sample.blob = blob;
        sample.url = URL.createObjectURL(blob);
      },
      "image/jpeg",
      SIGNATURE_CONFIG.jpegQuality
    );
    return sample;
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!running || paused) return;
    if (now - lastCaptureAt < SIGNATURE_CONFIG.intervalMs) return;
    lastCaptureAt = now;
    captureNow(false);
  }

  function reset() {
    running = false;
    paused = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastCaptureAt = 0;
    previousCells = null;
    selectedId = "";
    topMoments = [];
    signatureFrame = null;
    samples.forEach(revokeSample);
    samples.length = 0;
    pendingEncodes = 0;
  }

  function start() {
    reset();
    running = true;
    paused = false;
    lastCaptureAt = 0;
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    paused = true;
  }

  function resume() {
    paused = false;
    lastCaptureAt = 0;
  }

  function waitForEncodes() {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (pendingEncodes <= 0 || Date.now() - started > 1600) resolve();
        else setTimeout(check, 40);
      };
      check();
    });
  }

  async function finalize() {
    running = false;
    paused = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!samples.length) captureNow(true);
    await waitForEncodes();

    const usable = samples.filter((sample) => sample.blob && sample.presence >= SIGNATURE_CONFIG.emptyPresence);
    const pool = usable.length ? usable : samples.filter((sample) => sample.blob);
    const picked = pickSignatureMoments(pool, {
      topN: SIGNATURE_CONFIG.topN,
      minGapMs: SIGNATURE_CONFIG.minGapMs,
    });
    topMoments = picked.map((item) => ({
      id: item.id,
      t: item.t,
      score: item.smoothed || item.score,
      url: item.url,
      blob: item.blob,
      width: item.width,
      height: item.height,
    }));
    signatureFrame = topMoments.reduce(
      (best, item) => (!best || item.score > best.score ? item : best),
      topMoments[0] || null
    );
    selectedId = signatureFrame ? signatureFrame.id : "";
    pruneBlobs(topMoments.map((item) => item.id));
    return getState();
  }

  function select(id) {
    const sid = String(id);
    const found = topMoments.find((item) => String(item.id) === sid);
    if (!found) return getState();
    selectedId = found.id;
    signatureFrame = found;
    return getState();
  }

  function getSelected() {
    return topMoments.find((item) => item.id === selectedId) || signatureFrame;
  }

  function imageFileName(title, index) {
    const base = `aura-${slugify(title)}`;
    if (index == null) return `${base}.png`;
    return `${base}-${String(index).padStart(2, "0")}.png`;
  }

  function decodeToPng(sample) {
    if (!sample || !sample.blob) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(sample.blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || sample.width;
        canvas.height = img.naturalHeight || sample.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        canvas.toBlob((blob) => resolve(blob), "image/png");
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("signature-decode-failed"));
      };
      img.src = url;
    });
  }

  async function exportPngBlob(id) {
    const selected = id
      ? topMoments.find((item) => item.id === id) || getSelected()
      : getSelected();
    return decodeToPng(selected);
  }

  async function exportAllPngBlobs() {
    const out = [];
    for (let i = 0; i < topMoments.length; i += 1) {
      const blob = await decodeToPng(topMoments[i]);
      if (blob) out.push({ blob, moment: topMoments[i], index: i + 1 });
    }
    return out;
  }

  const api = {
    WEIGHTS: SIGNATURE_WEIGHTS,
    CONFIG: SIGNATURE_CONFIG,
    scoreSignatureFrame,
    pickSignatureMoments,
    start,
    pause,
    resume,
    reset,
    captureNow,
    finalize,
    select,
    imageFileName,
    exportPngBlob,
    exportAllPngBlobs,
    getState() {
      return {
        signatureFrame,
        selectedSignatureFrame: getSelected(),
        topSignatureMoments: topMoments,
        sampleCount: samples.length,
      };
    },
  };

  if (typeof window !== "undefined") window.AURA_SIGNATURE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
