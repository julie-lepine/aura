(() => {
  "use strict";

  const TAU = Math.PI * 2;

  // Réglages du feeling — à tweaker en priorité.
  const FEEL = {
    glowAlpha: 0.2,
    haloMin: 60,
    haloMax: 132,
    holdRamp: 1.7,
    stillSpeed: 1.05,
    headCount: 7,
    follow: 0.07,
    inherit: 0.62,
    stir: 0.035,
    dragHead: 0.87,
    dragHeld: 0.962,
    dragFree: 0.982,
    matterCatch: 0.12,
    matterDrag: 0.88,
    stretch: 0.2,
    release: 1.25,
    dissipate: 0.26,
    turbulence: 0.045,
    flowScale: 0.007,
    flowSpeed: 0.012,
    colorEase: 0.55,
    align: 0.09,
    cohesion: 0.014,
  };

  const MOOD_MUL = {
    calm: {
      follow: 0.68,
      stir: 0.5,
      inherit: 0.84,
      dissipate: 0.7,
      stretch: 0.78,
      turbulence: 0.52,
      matterCatch: 0.72,
      spacing: 1.16,
      fleck: 0.45,
    },
    flow: {
      follow: 1,
      stir: 1,
      inherit: 1,
      dissipate: 1,
      stretch: 1,
      turbulence: 1,
      matterCatch: 1,
      spacing: 1,
      fleck: 1,
    },
    wild: {
      follow: 1.22,
      stir: 1.55,
      inherit: 1.14,
      dissipate: 1.18,
      stretch: 1.32,
      turbulence: 1.42,
      matterCatch: 1.18,
      spacing: 0.84,
      fleck: 1.65,
    },
  };

  let moodId = "flow";

  function feel(key) {
    const mul = (MOOD_MUL[moodId] || MOOD_MUL.flow)[key];
    return FEEL[key] * (mul == null ? 1 : mul);
  }

  function moodMul(key) {
    const mul = (MOOD_MUL[moodId] || MOOD_MUL.flow)[key];
    return mul == null ? 1 : mul;
  }

  // Couche multi-touch uniquement — n'intervient pas à un doigt.
  const INTERACT = {
    radiusPad: 120,
    attract: 0.02,
    together: 0.04,
    particlePull: 0.01,
    swirl: 0.01,
    turbBoost: 0.85,
    colorBleed: 0.12,
  };

  const downCache = [];

  const BG = "#07070c";
  const GRID_CELL = 56;

  const PALETTE = [
    [168, 64, 255],
    [255, 58, 168],
    [32, 168, 255],
    [255, 108, 78],
    [36, 232, 158],
    [255, 206, 48],
  ];

  const canvas = document.getElementById("aura");
  const ctx = canvas.getContext("2d", { alpha: false });
  const stageEl = document.getElementById("stage") || canvas.parentElement;

  let viewW = 0;
  let viewH = 0;
  let lastTime = 0;
  let tick = 0;

  const glowSprites = PALETTE.map((rgb) => createGlowSprite(rgb[0], rgb[1], rgb[2]));
  const heartSprites = PALETTE.map((rgb) => createHeartSprite(rgb[0], rgb[1], rgb[2]));
  const liquidSprites = PALETTE.map((rgb) => createLiquidSprite(rgb[0], rgb[1], rgb[2]));
  const liquidBeadSprites = PALETTE.map((rgb) => createLiquidBeadSprite(rgb[0], rgb[1], rgb[2]));
  const liquidRingSprites = PALETTE.map((rgb) => createLiquidRingSprite(rgb[0], rgb[1], rgb[2]));
  const fireSprites = PALETTE.map((rgb) => createFireSprite(rgb[0], rgb[1], rgb[2]));
  const fireCoreSprites = PALETTE.map((rgb) => createFireCoreSprite(rgb[0], rgb[1], rgb[2]));
  let interactive = false;
  let activeGlow = "soft";
  const FLECK_CAP = 48;
  const DROP_CAP = 22;

  // --- Interactions --------------------------------------------------------

  // Une entrée par pointerId : le multi-touch n'aura qu'à alimenter cette Map.
  const pointers = new Map();

  // --- Système de particules -----------------------------------------------

  const pool = [];
  const particles = [];
  const grid = new Map();
  let maxParticles = 96;

  function particleBudget() {
    const area = viewW * viewH;
    if (area < 400000) return 110;
    if (area < 900000) return 150;
    return 190;
  }

  function createGlowSprite(r, g, b) {
    const size = 384;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const mid = size * 0.5;
    const cr = Math.round(r * 0.32 + 255 * 0.68);
    const cg = Math.round(g * 0.32 + 255 * 0.68);
    const cb = Math.round(b * 0.32 + 255 * 0.68);
    const gradient = gfx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    gradient.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.52)`);
    gradient.addColorStop(0.16, `rgba(${r}, ${g}, ${b}, 0.24)`);
    gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.07)`);
    gradient.addColorStop(0.68, `rgba(${r}, ${g}, ${b}, 0.018)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = gradient;
    gfx.fillRect(0, 0, size, size);
    return sprite;
  }

  function fillHeartPath(gfx, cx, cy, scale) {
    const s = scale;
    gfx.beginPath();
    gfx.moveTo(cx, cy + s * 0.32);
    gfx.bezierCurveTo(cx - s * 0.18, cy + s * 0.02, cx - s * 0.52, cy - s * 0.18, cx - s * 0.28, cy - s * 0.42);
    gfx.bezierCurveTo(cx - s * 0.1, cy - s * 0.58, cx + s * 0.02, cy - s * 0.42, cx, cy - s * 0.2);
    gfx.bezierCurveTo(cx - s * 0.02, cy - s * 0.42, cx + s * 0.1, cy - s * 0.58, cx + s * 0.28, cy - s * 0.42);
    gfx.bezierCurveTo(cx + s * 0.52, cy - s * 0.18, cx + s * 0.18, cy + s * 0.02, cx, cy + s * 0.32);
    gfx.closePath();
  }

  function createHeartSprite(r, g, b) {
    const size = 192;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const mid = size * 0.5;
    const cr = Math.round(r * 0.38 + 255 * 0.62);
    const cg = Math.round(g * 0.38 + 255 * 0.62);
    const cb = Math.round(b * 0.38 + 255 * 0.62);
    const aura = gfx.createRadialGradient(mid, mid * 1.04, 0, mid, mid * 1.04, mid * 0.92);
    aura.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.22)`);
    aura.addColorStop(0.48, `rgba(${r}, ${g}, ${b}, 0.06)`);
    aura.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = aura;
    gfx.fillRect(0, 0, size, size);
    gfx.globalCompositeOperation = "lighter";
    fillHeartPath(gfx, mid, mid * 1.02, size * 0.58);
    gfx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.78)`;
    gfx.fill();
    fillHeartPath(gfx, mid, mid * 1.02, size * 0.4);
    gfx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.72)`;
    gfx.fill();
    fillHeartPath(gfx, mid - size * 0.03, mid * 0.94, size * 0.14);
    gfx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.42)`;
    gfx.fill();
    gfx.globalCompositeOperation = "source-over";
    return sprite;
  }

  function createLiquidSprite(r, g, b) {
    const size = 256;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const mid = size * 0.5;
    const cr = Math.round(r * 0.34 + 255 * 0.66);
    const cg = Math.round(g * 0.34 + 255 * 0.66);
    const cb = Math.round(b * 0.34 + 255 * 0.66);
    const body = gfx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    body.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.38)`);
    body.addColorStop(0.22, `rgba(${r}, ${g}, ${b}, 0.2)`);
    body.addColorStop(0.48, `rgba(${r}, ${g}, ${b}, 0.08)`);
    body.addColorStop(0.74, `rgba(${r}, ${g}, ${b}, 0.018)`);
    body.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = body;
    gfx.fillRect(0, 0, size, size);
    gfx.globalCompositeOperation = "lighter";
    const spec = gfx.createRadialGradient(mid * 0.78, mid * 0.72, 0, mid * 0.78, mid * 0.72, mid * 0.28);
    spec.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.2)`);
    spec.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.06)`);
    spec.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = spec;
    gfx.fillRect(0, 0, size, size);
    gfx.globalCompositeOperation = "source-over";
    return sprite;
  }

  function createLiquidBeadSprite(r, g, b) {
    const size = 160;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const mid = size * 0.5;
    const cr = Math.round(r * 0.28 + 255 * 0.72);
    const cg = Math.round(g * 0.28 + 255 * 0.72);
    const cb = Math.round(b * 0.28 + 255 * 0.72);
    const body = gfx.createRadialGradient(mid, mid * 1.06, 0, mid, mid, mid);
    body.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.16)`);
    body.addColorStop(0.38, `rgba(${r}, ${g}, ${b}, 0.22)`);
    body.addColorStop(0.62, `rgba(${cr}, ${cg}, ${cb}, 0.34)`);
    body.addColorStop(0.8, `rgba(${r}, ${g}, ${b}, 0.08)`);
    body.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = body;
    gfx.fillRect(0, 0, size, size);
    gfx.globalCompositeOperation = "lighter";
    const spec = gfx.createRadialGradient(mid * 0.72, mid * 0.62, 0, mid * 0.72, mid * 0.62, mid * 0.22);
    spec.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.55)`);
    spec.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.12)`);
    spec.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = spec;
    gfx.fillRect(0, 0, size, size);
    gfx.globalCompositeOperation = "source-over";
    return sprite;
  }

  function createLiquidRingSprite(r, g, b) {
    const size = 256;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const mid = size * 0.5;
    const cr = Math.round(r * 0.3 + 255 * 0.7);
    const cg = Math.round(g * 0.3 + 255 * 0.7);
    const cb = Math.round(b * 0.3 + 255 * 0.7);
    const rim = gfx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    rim.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
    rim.addColorStop(0.54, `rgba(${r}, ${g}, ${b}, 0)`);
    rim.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, 0.07)`);
    rim.addColorStop(0.8, `rgba(${cr}, ${cg}, ${cb}, 0.48)`);
    rim.addColorStop(0.88, `rgba(${r}, ${g}, ${b}, 0.14)`);
    rim.addColorStop(0.95, `rgba(${r}, ${g}, ${b}, 0.02)`);
    rim.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = rim;
    gfx.fillRect(0, 0, size, size);
    return sprite;
  }

  function createFireSprite(r, g, b) {
    const size = 192;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const cr = Math.round(r * 0.22 + 255 * 0.78);
    const cg = Math.round(g * 0.22 + 255 * 0.78);
    const cb = Math.round(b * 0.22 + 255 * 0.78);
    gfx.globalCompositeOperation = "lighter";
    const blobs = [
      [0.5, 0.74, 0.46, 0.5],
      [0.47, 0.58, 0.34, 0.36],
      [0.54, 0.44, 0.26, 0.24],
      [0.5, 0.3, 0.18, 0.14],
      [0.5, 0.2, 0.11, 0.07],
    ];
    for (let i = 0; i < blobs.length; i += 1) {
      const bx = blobs[i][0] * size;
      const by = blobs[i][1] * size;
      const rad = blobs[i][2] * size;
      const a = blobs[i][3];
      const flame = gfx.createRadialGradient(bx, by, 0, bx, by, rad);
      flame.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${a})`);
      flame.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, ${a * 0.45})`);
      flame.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      gfx.fillStyle = flame;
      gfx.fillRect(0, 0, size, size);
    }
    gfx.globalCompositeOperation = "source-over";
    return sprite;
  }

  function createFireCoreSprite(r, g, b) {
    const size = 160;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const mid = size * 0.5;
    const cr = Math.round(r * 0.15 + 255 * 0.85);
    const cg = Math.round(g * 0.15 + 255 * 0.85);
    const cb = Math.round(b * 0.15 + 255 * 0.85);
    const body = gfx.createRadialGradient(mid, mid, 0, mid, mid, mid * 0.72);
    body.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.95)`);
    body.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, 0.7)`);
    body.addColorStop(0.48, `rgba(${r}, ${g}, ${b}, 0.18)`);
    body.addColorStop(0.78, `rgba(${r}, ${g}, ${b}, 0.03)`);
    body.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = body;
    gfx.fillRect(0, 0, size, size);
    return sprite;
  }

  function currentWidth(source) {
    const min = activeGlow === "feu" ? FEEL.haloMin * 1.44 : FEEL.haloMin;
    const max = activeGlow === "feu" ? FEEL.haloMax * 1.44 : FEEL.haloMax;
    return min + source.pressure * (max - min);
  }

  function neighborTone(index) {
    const step = Math.random() < 0.5 ? 1 : PALETTE.length - 1;
    return (index + step) % PALETTE.length;
  }

  function smootherstep(edge0, edge1, x) {
    if (edge0 === edge1) return x >= edge1 ? 1 : 0;
    let u = (x - edge0) / (edge1 - edge0);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    return u * u * (3 - 2 * u);
  }

  // Champ partagé : deux points proches reçoivent le même flux.
  function flowAt(x, y) {
    const t = tick * FEEL.flowSpeed;
    const s = FEEL.flowScale;
    const a = Math.sin(x * s + t) + Math.sin((x + y) * s * 0.73 + t * 1.07);
    const b = Math.cos(y * s - t * 0.81) + Math.cos((x - y) * s * 0.61 + t * 0.93);
    return {
      x: b * feel("turbulence"),
      y: -a * feel("turbulence"),
    };
  }

  function cellKey(cx, cy) {
    return ((cx + 4096) << 13) | (cy + 4096);
  }

  function rebuildGrid() {
    grid.forEach((bucket) => {
      bucket.length = 0;
    });
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const key = cellKey(
        Math.floor(p.x / GRID_CELL),
        Math.floor(p.y / GRID_CELL)
      );
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(p);
    }
    grid.forEach((bucket, key) => {
      if (bucket.length === 0) grid.delete(key);
    });
  }

  function applyFlock(particle, t) {
    if (particle.role !== "matter") return;
    if (activeGlow === "feu" && !particle.head) return;
    const cx = Math.floor(particle.x / GRID_CELL);
    const cy = Math.floor(particle.y / GRID_CELL);
    let svx = 0;
    let svy = 0;
    let sx = 0;
    let sy = 0;
    let n = 0;
    const range = GRID_CELL * GRID_CELL * 2.1;

    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = grid.get(cellKey(cx + ox, cy + oy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 1) {
          const other = bucket[i];
          if (other === particle || other.role !== "matter") continue;
          const dx = other.x - particle.x;
          const dy = other.y - particle.y;
          if (dx * dx + dy * dy > range) continue;
          svx += other.vx;
          svy += other.vy;
          sx += other.x;
          sy += other.y;
          n += 1;
          if (n >= 8) break;
        }
        if (n >= 8) break;
      }
      if (n >= 8) break;
    }

    if (n === 0) return;
    const inv = 1 / n;
    const align =
      activeGlow === "liquid"
        ? FEEL.align * 0.45
        : activeGlow === "feu"
          ? FEEL.align * 0.55
          : FEEL.align;
    const coh =
      activeGlow === "liquid"
        ? 0
        : activeGlow === "feu"
          ? FEEL.cohesion * 1.1
          : FEEL.cohesion;
    particle.vx += (svx * inv - particle.vx) * align * t;
    particle.vy += (svy * inv - particle.vy) * align * t;
    particle.vx += (sx * inv - particle.x) * coh * t;
    particle.vy += (sy * inv - particle.y) * coh * t;
  }

  function liquidHeading(source) {
    const len = Math.hypot(source.liquidNx || 0, source.liquidNy || 0);
    const speed = Math.hypot(source.vx, source.vy);
    if (len > 0.15) {
      return { nx: source.liquidNx / len, ny: source.liquidNy / len, speed };
    }
    if (speed < 0.18) return { nx: 0, ny: -1, speed };
    return { nx: source.vx / speed, ny: source.vy / speed, speed };
  }

  function stepLiquidHeading(source, t) {
    const speed = Math.hypot(source.vx, source.vy);
    if (speed < 0.22) return;
    const nx = source.vx / speed;
    const ny = source.vy / speed;
    const ease = 1 - Math.pow(0.965, t);
    source.liquidNx = (source.liquidNx || nx) + (nx - (source.liquidNx || nx)) * ease;
    source.liquidNy = (source.liquidNy || ny) + (ny - (source.liquidNy || ny)) * ease;
    const len = Math.hypot(source.liquidNx, source.liquidNy) || 1;
    source.liquidNx /= len;
    source.liquidNy /= len;
  }

  function applyLiquidOrb(particle, source, t, isLiveHead) {
    const tempo = moodMul("turbulence");
    if (!source) {
      const wiggle = 0.014 * t * tempo;
      particle.vx += Math.sin(tick * 0.02 + particle.phase) * wiggle;
      particle.vy += Math.cos(tick * 0.016 + particle.phase * 1.3) * wiggle;
      return;
    }

    if (isLiveHead) return;

    const heading = liquidHeading(source);
    let dx = particle.x - source.matterX;
    let dy = particle.y - source.matterY;
    if (heading.speed > 0.28) {
      const nx = heading.nx;
      const ny = heading.ny;
      const along = dx * nx + dy * ny;
      const lx = dx - along * nx;
      const ly = dy - along * ny;
      particle.vx -= lx * 0.004 * t;
      particle.vy -= ly * 0.004 * t;
    }
    particle.vx += Math.sin(tick * 0.012 + particle.phase) * 0.005 * t * tempo;
    particle.vy += Math.cos(tick * 0.01 + particle.phase * 1.2) * 0.005 * t * tempo;
  }

  function applyFireOrb(particle, source, t, isLiveHead) {
    const tempo = moodMul("turbulence");
    if (!isLiveHead) {
      particle.vy -= 0.042 * t * tempo;
      particle.vx += Math.sin(tick * 0.11 + particle.phase) * 0.018 * t * tempo;
      return;
    }
    if (!source) return;
    const width = currentWidth(source);
    const dx = particle.x - source.matterX;
    const dy = particle.y - source.matterY;
    const dist = Math.hypot(dx, dy) || 1;
    const radius = width * 0.2;
    if (dist > radius) {
      const pull = ((dist - radius) / dist) * 0.035;
      particle.vx -= dx * pull * t;
      particle.vy -= dy * pull * t;
    }
    particle.vy -= 0.012 * t * tempo;
    particle.vx += Math.sin(tick * 0.16 + particle.phase) * 0.018 * t * tempo;
    particle.vy += Math.cos(tick * 0.13 + particle.phase * 1.4) * 0.012 * t * tempo;
  }

  function stepFireLean(source, t) {
    const ease = 1 - Math.pow(0.96, t);
    source.fireTx = (source.fireTx || 0) + (-source.vx - (source.fireTx || 0)) * ease;
    source.fireTy = (source.fireTy || 0) + (-source.vy - (source.fireTy || 0)) * ease;
  }

  function dropCount() {
    let n = 0;
    for (let i = 0; i < particles.length; i += 1) {
      if (particles[i].role === "drop") n += 1;
    }
    return n;
  }

  function recycleOldestDrop() {
    let idx = -1;
    let minLife = 2;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (p.role === "drop" && p.life < minLife) {
        minLife = p.life;
        idx = i;
      }
    }
    if (idx >= 0) recycleParticle(idx);
  }

  function liquidCoreOffset(p, source) {
    let best = Infinity;
    let dx = 0;
    let dy = 0;
    if (source) {
      dx = source.matterX - p.x;
      dy = source.matterY - p.y;
      best = Math.hypot(dx, dy);
    }
    const cx = Math.floor(p.x / GRID_CELL);
    const cy = Math.floor(p.y / GRID_CELL);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = grid.get(cellKey(cx + ox, cy + oy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 1) {
          const other = bucket[i];
          if (other.role !== "matter") continue;
          const odx = other.x - p.x;
          const ody = other.y - p.y;
          const d = Math.hypot(odx, ody);
          if (d < best) {
            best = d;
            dx = odx;
            dy = ody;
          }
        }
      }
    }
    return { dist: best, dx, dy };
  }

  function stepLiquidDrop(particle, t) {
    const source = pointers.get(particle.sourceId);
    const flow = flowAt(particle.x, particle.y);
    particle.vx += flow.x * 0.03 * t;
    particle.vy += flow.y * 0.03 * t;
    const core = liquidCoreOffset(particle, source);
    const width = source ? currentWidth(source) : 56;
    const mergeR = width * 0.38;
    const fadeR = width * 2.15;
    if (core.dist < mergeR) {
      const inv = 1 / Math.max(core.dist, 1);
      const pull = (1 - core.dist / mergeR) * 0.055;
      particle.vx += core.dx * inv * pull * t;
      particle.vy += core.dy * inv * pull * t;
      if (core.dist < width * 0.14) particle.life = 0;
    } else if (core.dist > fadeR) {
      particle.decay = Math.max(particle.decay, 0.18);
    }
    const keep = Math.pow(0.982, t);
    particle.vx *= keep;
    particle.vy *= keep;
    particle.x += particle.vx * t;
    particle.y += particle.vy * t;
    particle.life -= particle.decay * (t / 60);
  }

  function maybePinchLiquid(particle, source, t) {
    if (!source || particle.head || particle.role !== "matter") return;
    if (particle.life > 0.2) return;
    const dx = particle.x - source.matterX;
    const dy = particle.y - source.matterY;
    const dist = Math.hypot(dx, dy);
    const width = currentWidth(source);
    if (dist < width * 2.8) return;
    const spd = Math.hypot(particle.vx, particle.vy);
    if (spd < 0.4) return;
    const chance = 0.006 * t;
    if (Math.random() > chance) return;
    if (dropCount() >= DROP_CAP) recycleOldestDrop();
    particle.role = "drop";
    particle.vx *= 1.05;
    particle.vy *= 1.05;
    particle.halo = Math.max(9, particle.halo * 0.4);
    particle.decay = 0.09 + Math.random() * 0.07;
  }

  function clearLiquidTapBlob(source) {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (p.sourceId === source.id && p.role === "matter") {
        p.life = 0;
        p.head = false;
      }
    }
  }

  function spawnLiquidRipple(source, cx, cy, strength) {
    if (particles.length >= maxParticles) {
      recycleOldestDeposit();
      if (particles.length >= maxParticles) return;
    }
    const width = currentWidth(source);
    const particle = obtainParticle();
    particle.x = cx;
    particle.y = cy;
    particle.vx = 0;
    particle.vy = 0;
    particle.ox = 0;
    particle.oy = 0;
    particle.ringR = width * (0.28 + (1 - strength) * 0.1);
    particle.haloMul = 1.55 + (1 - strength) * 1.35;
    particle.halo = 1;
    particle.spreadMul = 1;
    particle.angle = 0;
    particle.life = 1;
    particle.decay = 0.58 + (1 - strength) * 0.28;
    particle.lag = 1;
    particle.glow = 0.5 + strength * 0.5;
    particle.phase = 0;
    particle.head = false;
    particle.toneA = source.toneA;
    particle.toneB = source.toneB;
    particle.mix = source.colorMix;
    particle.sourceId = source.id;
    particle.role = "ripple";
    particle.twinkle = 0;
    particle.aim = 0;
    particle.squash = 0.84;
    particles.push(particle);
  }

  function emitLiquidRing(source, cx, cy, strength) {
    spawnLiquidRipple(source, cx, cy, strength);
  }

  function spawnLiquidBead(source, x, y) {
    if (particles.length >= maxParticles) {
      recycleOldestDeposit();
      if (particles.length >= maxParticles) return;
    }
    const width = currentWidth(source);
    const particle = obtainParticle();
    particle.x = x;
    particle.y = y;
    particle.vx = 0;
    particle.vy = 0;
    particle.ox = 0;
    particle.oy = 0;
    particle.haloMul = 0.42;
    particle.halo = width * 0.42;
    particle.spreadMul = 1;
    particle.angle = 0;
    particle.life = 1;
    particle.decay = 0.5;
    particle.lag = 1;
    particle.glow = 1;
    particle.phase = 0;
    particle.head = false;
    particle.toneA = source.toneA;
    particle.toneB = source.toneB;
    particle.mix = source.colorMix;
    particle.sourceId = source.id;
    particle.role = "bead";
    particle.twinkle = 0;
    particle.aim = 0;
    particle.ringR = 0;
    particle.squash = 0.85;
    particles.push(particle);
  }

  function beginLiquidSplash(source) {
    const x = source.x;
    const y = source.y;
    clearLiquidTapBlob(source);
    source.liquidSplash = { x, y, age: 0, bounce: 1 };
    spawnLiquidBead(source, x, y);
    emitLiquidRing(source, x, y, 1);
  }

  function stepLiquidSplash(source, dt) {
    const splash = source.liquidSplash;
    if (!splash) return;
    splash.age += dt;
    const beats = [0.15, 0.32];
    const idx = splash.bounce - 1;
    if (idx < beats.length && splash.age >= beats[idx]) {
      const strength = 1 - splash.bounce * 0.33;
      emitLiquidRing(source, splash.x, splash.y, strength);
      splash.bounce += 1;
    }
    if (splash.age > 1.35) source.liquidSplash = null;
  }

  function stepLiquidRipple(particle, t) {
    particle.ringR += particle.haloMul * t;
    particle.life -= particle.decay * (t / 60);
  }

  function stepLiquidBead(particle, t) {
    const source = pointers.get(particle.sourceId);
    const splash = source && source.liquidSplash;
    const width = source ? currentWidth(source) : particle.halo / Math.max(particle.haloMul, 0.2);
    let squash = 1;
    let scale = 0.7;
    if (splash) {
      const a = splash.age;
      if (a < 0.07) {
        scale = 0.42 + (a / 0.07) * 0.58;
        squash = 0.8;
      } else if (a < 0.14) {
        scale = 1.02;
        squash = 0.52;
      } else if (a < 0.22) {
        scale = 0.88;
        squash = 1.24;
      } else if (a < 0.3) {
        scale = 0.78;
        squash = 0.64;
      } else if (a < 0.42) {
        scale = 0.66;
        squash = 1.12;
      } else {
        scale = 0.5 * particle.life + 0.12;
        squash = 1;
      }
    } else {
      scale = 0.45 * particle.life;
      squash = 1;
    }
    particle.squash = squash;
    particle.halo = width * 0.4 * scale;
    particle.life -= particle.decay * (t / 60);
  }

  function maybeLiquidTapSplash(source) {
    if (activeGlow !== "liquid" || !source) return;
    if (source.tapTravel > 18) return;
    if (performance.now() - source.bornAt > 320) return;
    beginLiquidSplash(source);
  }

  function obtainParticle() {
    return pool.pop() || {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      ox: 0,
      oy: 0,
      halo: 0,
      haloMul: 1,
      spreadMul: 1,
      angle: 0,
      life: 0,
      decay: 0,
      lag: 0,
      glow: 0,
      phase: 0,
      head: false,
      toneA: 0,
      toneB: 1,
      mix: 0,
      sourceId: 0,
      role: "matter",
      twinkle: 0,
      aim: 0,
      ringR: 0,
      squash: 1,
    };
  }

  function recycleParticle(index) {
    const particle = particles[index];
    particles[index] = particles[particles.length - 1];
    particles.pop();
    pool.push(particle);
  }

  function recycleOldestDeposit() {
    let idx = -1;
    let minLife = 2;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (!p.head && p.role === "matter" && p.life < minLife) {
        minLife = p.life;
        idx = i;
      }
    }
    if (idx >= 0) recycleParticle(idx);
  }

  function recycleOldestFleck() {
    let idx = -1;
    let minLife = 2;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (p.role !== "matter" && p.life < minLife) {
        minLife = p.life;
        idx = i;
      }
    }
    if (idx >= 0) recycleParticle(idx);
  }

  function fleckCount() {
    let n = 0;
    for (let i = 0; i < particles.length; i += 1) {
      if (particles[i].role !== "matter") n += 1;
    }
    return n;
  }

  function spawnParticle(source, x, y, inherit, isHead) {
    if (particles.length >= maxParticles) {
      recycleOldestDeposit();
      if (particles.length >= maxParticles) return;
    }

    const width = currentWidth(source);
    const speed = Math.hypot(source.vx, source.vy);
    const spread =
      width *
      (activeGlow === "liquid"
        ? isHead
          ? 0.16
          : 0.22
        : activeGlow === "feu"
          ? isHead
            ? 0.13
            : 0.18
          : isHead
            ? 0.2
            : 0.22) *
      (0.7 + Math.min(speed, 8) * 0.03);
    const angle = Math.random() * TAU;
    const radius = Math.sqrt(Math.random()) * spread;

    const particle = obtainParticle();
    particle.x = x + Math.cos(angle) * radius * 0.25;
    particle.y = y + Math.sin(angle) * radius * 0.25;
    particle.ox = Math.cos(angle) * radius;
    particle.oy = Math.sin(angle) * radius;
    particle.vx = source.vx * inherit + source.matterVx * 0.18;
    particle.vy = source.vy * inherit + source.matterVy * 0.18;
    particle.haloMul = 0.88 + Math.random() * 0.24;
    particle.halo = width * particle.haloMul;
    if (activeGlow === "liquid" && !isHead) {
      particle.haloMul *= 0.58;
      particle.halo = width * particle.haloMul;
    }
    if (activeGlow === "feu" && !isHead) {
      particle.haloMul *= 0.74;
      particle.halo = width * particle.haloMul;
    }
    particle.spreadMul = 0.25 + Math.random() * 0.85;
    particle.angle = angle;
    particle.life = 1;
    particle.decay =
      (feel("dissipate") + Math.random() * 0.14) *
      (activeGlow === "liquid"
        ? 0.18
        : activeGlow === "hearts"
          ? 0.2
          : activeGlow === "feu"
            ? 1.15
            : 1);
    particle.lag = 0.4 + Math.random() * 0.9;
    particle.glow = 0.62 + Math.random() * 0.4;
    particle.phase = Math.random() * TAU;
    particle.head = isHead;
    particle.toneA = source.toneA;
    particle.toneB = source.toneB;
    particle.mix = source.colorMix;
    particle.sourceId = source.id;
    particle.role = "matter";
    particle.twinkle = 0;
    particle.aim =
      activeGlow === "liquid" && speed > 0.12
        ? Math.atan2(source.vy, source.vx)
        : Math.atan2(particle.vy, particle.vx) || angle;
    particles.push(particle);
  }

  function spawnHead(source) {
    if (activeGlow === "feu") {
      for (let i = 0; i < 4; i += 1) {
        depositAt(source, source.x, source.y);
      }
      return;
    }
    const count = activeGlow === "liquid" ? 4 : FEEL.headCount;
    for (let i = 0; i < count; i += 1) {
      spawnParticle(source, source.x, source.y, 0.08, true);
    }
  }

  function depositAt(source, x, y) {
    const speed = Math.hypot(source.vx, source.vy);
    let px = x;
    let py = y;
    if (activeGlow === "liquid") {
      const back = Math.min(10, speed * 0.32);
      const inv = speed > 0.12 ? 1 / speed : 0;
      px -= source.vx * inv * back;
      py -= source.vy * inv * back;
    } else if (activeGlow === "feu") {
      const back = Math.min(12, 6 + speed * 0.28);
      const inv = speed > 0.12 ? 1 / speed : 0;
      px -= source.vx * inv * back;
      py -= source.vy * inv * back;
    } else {
      const stretch = Math.min(1.8, 0.85 + speed * 0.12);
      px = x - source.vx * stretch;
      py = y - source.vy * stretch;
      if (speed > 0.35) {
        const inv = 1 / speed;
        const side = (Math.random() - 0.5) * currentWidth(source) * 0.38;
        px += -source.vy * inv * side;
        py += source.vx * inv * side;
      }
    }
    let inherit = feel("inherit") + Math.min(0.22, speed * 0.04);
    if (activeGlow === "liquid") inherit = Math.min(0.2, inherit * 0.28);
    if (activeGlow === "feu") inherit = Math.min(0.14, inherit * 0.2);
    spawnParticle(source, px, py, inherit, false);
    maybeEmitFlecks(source, px, py, speed);
  }

  function spawnFleck(source, x, y, role, vx, vy) {
    if (activeGlow === "soft" || activeGlow === "liquid" || activeGlow === "hearts" || activeGlow === "feu") return;
    if (fleckCount() >= FLECK_CAP) recycleOldestFleck();
    if (particles.length >= maxParticles) recycleOldestFleck();
    if (particles.length >= maxParticles) return;

    const particle = obtainParticle();
    particle.x = x;
    particle.y = y;
    particle.vx = vx;
    particle.vy = vy;
    particle.ox = 0;
    particle.oy = 0;
    particle.haloMul = 1;
    particle.halo =
      role === "spark"
        ? 10 + Math.random() * 12
        : role === "smoke"
          ? 26 + Math.random() * 22
          : 9 + Math.random() * 11;
    particle.spreadMul = 1;
    particle.angle = Math.random() * TAU;
    particle.life = 1;
    particle.decay =
      role === "burst"
        ? 0.52 + Math.random() * 0.22
        : role === "smoke"
          ? 0.16 + Math.random() * 0.08
          : 0.34 + Math.random() * 0.16;
    particle.lag = 1;
    particle.glow = 0.82 + Math.random() * 0.28;
    particle.phase = Math.random() * TAU;
    particle.head = false;
    particle.toneA = source.toneA;
    particle.toneB = source.toneB;
    particle.mix = source.colorMix;
    particle.sourceId = source.id;
    particle.role = role;
    particle.twinkle = Math.random() * TAU;
    particles.push(particle);
  }

  function maybeEmitFlecks(source, x, y, speed) {
    const fleck = moodMul("fleck");
    if (activeGlow === "spark") {
      if (fleck < 1 && Math.random() > fleck) return;
      const n = fleck > 1.2 ? 3 : Math.random() < 0.55 ? 2 : 1;
      for (let i = 0; i < n; i += 1) {
        spawnFleck(
          source,
          x + (Math.random() - 0.5) * 22,
          y + (Math.random() - 0.5) * 22,
          "spark",
          source.vx * 0.55 + (Math.random() - 0.5) * 2.4,
          source.vy * 0.55 + (Math.random() - 0.5) * 2.4
        );
      }
    }
    if (activeGlow === "burst" && speed > 1.6 && Math.random() < 0.42 * fleck) {
      emitBurst(source, x, y, speed);
    }
  }

  function maybeShedFlecks(source) {
    if (activeGlow === "spark" && Math.random() < 0.1 * moodMul("fleck")) {
      spawnFleck(
        source,
        source.matterX + (Math.random() - 0.5) * 28,
        source.matterY + (Math.random() - 0.5) * 28,
        "spark",
        source.vx * 0.25 + (Math.random() - 0.5) * 1.6,
        source.vy * 0.25 + (Math.random() - 0.5) * 1.6
      );
    }
  }

  function emitBurst(source, x, y, speed) {
    if (activeGlow !== "burst") return;
    const heading = Math.atan2(source.vy, source.vx);
    const count = Math.round((speed > 3.2 ? 7 : 5) * Math.min(1.4, moodMul("fleck")));
    for (let i = 0; i < count; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const ang = heading + side * (0.45 + Math.random() * 1.05) + (Math.random() - 0.5) * 0.35;
      const mag = 2.2 + speed * 0.42 + Math.random() * 2.1;
      spawnFleck(
        source,
        x + (Math.random() - 0.5) * 6,
        y + (Math.random() - 0.5) * 6,
        "burst",
        Math.cos(ang) * mag,
        Math.sin(ang) * mag
      );
    }
  }

  // --- Simulation ----------------------------------------------------------

  function headTarget(particle, source) {
    const width = currentWidth(source);
    const speed = Math.hypot(source.vx, source.vy);
    if (activeGlow === "liquid") {
      const heading = liquidHeading(source);
      const bulb = width * 0.18 * (0.7 + particle.spreadMul * 0.35);
      let ox = Math.cos(particle.angle) * bulb;
      let oy = Math.sin(particle.angle) * bulb;
      if (speed > 0.45) {
        const nx = heading.nx;
        const ny = heading.ny;
        const along = ox * nx + oy * ny;
        const stretch = 1 + Math.min(0.7, speed * 0.06);
        const compress = 1 / Math.sqrt(stretch);
        ox = along * nx * stretch + (ox - along * nx) * compress - nx * width * 0.08;
        oy = along * ny * stretch + (oy - along * ny) * compress - ny * width * 0.08;
      }
      return {
        x: source.matterX + ox,
        y: source.matterY + oy,
      };
    }
    if (activeGlow === "feu") {
      const flicker = 1 + Math.sin(tick * 0.18 + particle.phase) * 0.08;
      const bulb = width * 0.09 * (0.7 + particle.spreadMul * 0.22) * flicker;
      const ox = Math.cos(particle.angle) * bulb;
      const oy = Math.sin(particle.angle) * bulb * 0.88 - width * 0.05;
      return {
        x: source.matterX + ox,
        y: source.matterY + oy,
      };
    }
    const breathe = 1 + Math.sin(tick * 0.038 + particle.phase) * 0.07;
    let ox = Math.cos(particle.angle) * width * 0.14 * particle.spreadMul * breathe;
    let oy = Math.sin(particle.angle) * width * 0.14 * particle.spreadMul * breathe;

    if (speed > 0.55) {
      const inv = 1 / speed;
      const nx = source.vx * inv;
      const ny = source.vy * inv;
      const along = ox * nx + oy * ny;
      const stretch = Math.min(3.2, 1 + speed * feel("stretch"));
      const compress = 1 / Math.sqrt(stretch);
      ox = along * nx * stretch + (ox - along * nx) * compress;
      oy = along * ny * stretch + (oy - along * ny) * compress;
    }

    return {
      x: source.matterX + ox,
      y: source.matterY + oy,
    };
  }

  function stepMatter(source, t) {
    const catchMul =
      activeGlow === "liquid" ? 0.7 : activeGlow === "feu" ? 0.58 : 1;
    source.matterVx += (source.x - source.matterX) * feel("matterCatch") * catchMul * t;
    source.matterVy += (source.y - source.matterY) * feel("matterCatch") * catchMul * t;
    source.matterVx *= Math.pow(activeGlow === "feu" ? 0.915 : FEEL.matterDrag, t);
    source.matterVy *= Math.pow(activeGlow === "feu" ? 0.915 : FEEL.matterDrag, t);
    source.matterX += source.matterVx * t;
    source.matterY += source.matterVy * t;
  }

  function stepColor(source, dt, speed) {
    if (speed < FEEL.stillSpeed) {
      source.targetMix += (0 - source.targetMix) * 0.035;
    } else {
      const speedTarget = Math.min(0.36, Math.max(0, (speed - 1.1) * 0.045));
      source.targetMix += (speedTarget - source.targetMix) * 0.04;
    }
    const ease = 1 - Math.exp(-dt / FEEL.colorEase);
    source.colorMix += (source.targetMix - source.colorMix) * ease;
  }

  function collectDown() {
    downCache.length = 0;
    pointers.forEach((source) => {
      if (source.down) downCache.push(source);
    });
  }

  function pairMetrics(a, b) {
    const dx = b.matterX - a.matterX;
    const dy = b.matterY - a.matterY;
    const dist = Math.hypot(dx, dy);
    const span = currentWidth(a) + currentWidth(b);
    const influence = smootherstep(span + INTERACT.radiusPad, span * 0.42, dist);
    const va = Math.hypot(a.vx, a.vy);
    const vb = Math.hypot(b.vx, b.vy);
    let align = 0;
    if (va > 0.25 && vb > 0.25) {
      align = (a.vx * b.vx + a.vy * b.vy) / (va * vb);
    }
    return {
      dx,
      dy,
      dist,
      influence,
      together: Math.max(0, align),
      oppose: Math.max(0, -align),
    };
  }

  function stepInteract(t) {
    collectDown();
    if (downCache.length < 2) return;

    for (let i = 0; i < downCache.length; i += 1) {
      const a = downCache[i];
      for (let j = i + 1; j < downCache.length; j += 1) {
        const b = downCache[j];
        const m = pairMetrics(a, b);
        if (m.influence <= 0) continue;

        const inv = 1 / (m.dist + 1);
        const pull = INTERACT.attract * m.influence;
        a.matterVx += m.dx * inv * pull * t;
        a.matterVy += m.dy * inv * pull * t;
        b.matterVx -= m.dx * inv * pull * t;
        b.matterVy -= m.dy * inv * pull * t;

        if (m.together > 0) {
          const c = INTERACT.together * m.together * m.influence * t;
          const avx = (a.vx + b.vx) * 0.5;
          const avy = (a.vy + b.vy) * 0.5;
          a.matterVx += (avx - a.matterVx) * c;
          a.matterVy += (avy - a.matterVy) * c;
          b.matterVx += (avx - b.matterVx) * c;
          b.matterVy += (avy - b.matterVy) * c;
        }
      }
    }
  }

  function applyPairToParticle(particle, t) {
    if (downCache.length < 2) return;
    const self = pointers.get(particle.sourceId);
    if (!self || !self.down) return;

    for (let i = 0; i < downCache.length; i += 1) {
      const other = downCache[i];
      if (other.id === self.id) continue;
      const m = pairMetrics(self, other);
      if (m.influence <= 0) continue;

      const ox = other.matterX - particle.x;
      const oy = other.matterY - particle.y;
      const reach = currentWidth(other) + 70;
      const nearOther = Math.exp(-(ox * ox + oy * oy) / (reach * reach));
      const pull =
        INTERACT.particlePull * m.influence * (0.4 + m.together * 0.8);
      particle.vx += ox * pull * nearOther * t;
      particle.vy += oy * pull * nearOther * t;

      const mx = particle.x - (self.matterX + other.matterX) * 0.5;
      const my = particle.y - (self.matterY + other.matterY) * 0.5;
      const mid = Math.exp(-(mx * mx + my * my) / 8100);
      const swirl = INTERACT.swirl * m.influence * (0.25 + m.oppose * 1.4);
      particle.vx += -my * swirl * mid * t;
      particle.vy += mx * swirl * mid * t;

      if (m.oppose > 0.05) {
        const f = flowAt(particle.x + 18, particle.y - 18);
        const boost = INTERACT.turbBoost * m.influence * m.oppose * mid;
        particle.vx += f.x * boost * t;
        particle.vy += f.y * boost * t;
      }
    }
  }

  function applyPairColor(particle, t) {
    if (downCache.length < 2) return;
    const self = pointers.get(particle.sourceId);
    if (!self || !self.down) return;

    let best = null;
    let bestInf = 0;
    for (let i = 0; i < downCache.length; i += 1) {
      const other = downCache[i];
      if (other.id === self.id) continue;
      const m = pairMetrics(self, other);
      if (m.influence > bestInf) {
        bestInf = m.influence;
        best = other;
      }
    }
    if (!best) return;

    particle.toneB = best.toneA;
    const target = bestInf * 0.5;
    particle.mix += (target - particle.mix) * INTERACT.colorBleed * t;
  }

  function stepFleck(particle, t) {
    const flow = flowAt(particle.x, particle.y);
    particle.vx += flow.x * 0.55 * t;
    particle.vy += flow.y * 0.55 * t;

    if (particle.role === "smoke") {
      particle.vy -= 0.14 * t;
      particle.halo += 8 * (t / 60);
      particle.vx += flow.x * 0.2 * t;
    }
    if (particle.role === "spark") {
      particle.glow =
        0.4 + 0.7 * (0.5 + 0.5 * Math.sin(tick * 0.28 + particle.twinkle));
    }

    const drag = particle.role === "burst" ? 0.978 : 0.962;
    const keep = Math.pow(drag, t);
    particle.vx *= keep;
    particle.vy *= keep;
    particle.x += particle.vx * t;
    particle.y += particle.vy * t;
    particle.life -= particle.decay * (t / 60);
  }

  function stepParticle(particle, t) {
    if (particle.role === "drop") {
      stepLiquidDrop(particle, t);
      return;
    }
    if (particle.role === "ripple") {
      stepLiquidRipple(particle, t);
      return;
    }
    if (particle.role === "bead") {
      stepLiquidBead(particle, t);
      return;
    }
    if (particle.role !== "matter") {
      stepFleck(particle, t);
      return;
    }
    const source = pointers.get(particle.sourceId);
    const coherence = source ? source.coherence : 0;
    const isLiveHead = particle.head && source && source.down;
    const flow = flowAt(particle.x, particle.y);
    const flowMul =
      activeGlow === "liquid" ? 0.12 : activeGlow === "feu" ? 0.18 : 1;
    particle.vx += flow.x * flowMul * t;
    particle.vy += flow.y * flowMul * t;
    applyFlock(particle, t);
    applyPairToParticle(particle, t);

    if (isLiveHead) {
      const target = headTarget(particle, source);
      particle.vx += (target.x - particle.x) * feel("follow") * particle.lag * (activeGlow === "liquid" ? 0.38 : activeGlow === "feu" ? 0.48 : 1) * t;
      particle.vy += (target.y - particle.y) * feel("follow") * particle.lag * (activeGlow === "liquid" ? 0.38 : activeGlow === "feu" ? 0.48 : 1) * t;
      particle.vx += (source.vx - particle.vx) * (activeGlow === "liquid" ? 0.028 : activeGlow === "feu" ? 0.04 : 0.08) * t;
      particle.vy += (source.vy - particle.vy) * (activeGlow === "liquid" ? 0.028 : activeGlow === "feu" ? 0.04 : 0.08) * t;
      particle.halo = currentWidth(source) * particle.haloMul;
      if (activeGlow === "liquid") {
        particle.halo *= 0.92;
      }
      if (activeGlow === "feu") {
        particle.halo *= 0.72;
      }
      particle.mix += (source.colorMix - particle.mix) * 0.08;
    } else if (source && source.down) {
      const width = currentWidth(source);
      const dx = particle.x - source.matterX;
      const dy = particle.y - source.matterY;
      const falloff = Math.exp(-(dx * dx + dy * dy) / (width * width * 2.8 + 80));
      particle.vx += source.ax * feel("stir") * falloff * (activeGlow === "liquid" ? 0.12 : activeGlow === "feu" ? 0.04 : 1);
      particle.vy += source.ay * feel("stir") * falloff * (activeGlow === "liquid" ? 0.12 : activeGlow === "feu" ? 0.04 : 1);
    }

    applyPairColor(particle, t);

    if (activeGlow === "liquid") {
      applyLiquidOrb(particle, source, t, isLiveHead);
    }
    if (activeGlow === "feu") {
      applyFireOrb(particle, source, t, isLiveHead);
    }

    let drag = isLiveHead
      ? FEEL.dragHead
      : coherence > 0.15
        ? FEEL.dragHeld
        : FEEL.dragFree;
    if (activeGlow === "liquid") {
      drag = isLiveHead ? 0.91 : coherence > 0.15 ? 0.948 : 0.97;
    } else if (activeGlow === "feu") {
      drag = isLiveHead ? 0.885 : coherence > 0.15 ? 0.955 : 0.972;
    }
    const keep = Math.pow(drag, t);
    particle.vx *= keep;
    particle.vy *= keep;
    particle.x += particle.vx * t;
    particle.y += particle.vy * t;

    if (activeGlow === "liquid") {
      let target = null;
      if (source) {
        const heading = liquidHeading(source);
        if (heading.speed > 0.15) target = Math.atan2(heading.ny, heading.nx);
      }
      if (target == null) {
        const asp = Math.hypot(particle.vx, particle.vy);
        if (asp > 0.08) target = Math.atan2(particle.vy, particle.vx);
      }
      if (target != null) {
        let d = target - particle.aim;
        if (d > Math.PI) d -= TAU;
        if (d < -Math.PI) d += TAU;
        particle.aim += d * (1 - Math.pow(0.9, t));
      }
      maybePinchLiquid(particle, source, t);
    }

    if (isLiveHead) {
      particle.life = 1;
      return;
    }

    const decay =
      source && source.down
        ? activeGlow === "liquid"
          ? 0.0035
          : activeGlow === "hearts"
            ? 0.007
            : activeGlow === "feu"
              ? 0.34
              : 0.045
        : particle.decay;
    particle.life -= decay * (t / 60);
  }

  function stepSources(dt, t) {
    pointers.forEach((source, id) => {
      source.ax = source.vx - source.prevVx;
      source.ay = source.vy - source.prevVy;
      source.prevVx = source.vx;
      source.prevVy = source.vy;

      source.vx *= Math.pow(0.9, t);
      source.vy *= Math.pow(0.9, t);
      if (activeGlow === "liquid") {
        const jerk = Math.hypot(source.ax, source.ay);
        if (jerk > 0.4) source.ripple = Math.min(1, (source.ripple || 0) + jerk * 0.2);
        source.ripple = (source.ripple || 0) * Math.pow(0.965, t);
      }
      if (activeGlow === "liquid") stepLiquidHeading(source, t);
      if (activeGlow === "feu") stepFireLean(source, t);
      if (source.liquidSplash) stepLiquidSplash(source, dt);
      stepMatter(source, t);

      const speed = Math.hypot(source.vx, source.vy);
      stepColor(source, dt, speed);

      if (source.down) {
        source.coherence = 1;
        if (speed < FEEL.stillSpeed) {
          source.pressure += (1 - source.pressure) * (1 - Math.exp(-dt / FEEL.holdRamp));
          if (activeGlow === "feu") {
            const gap = Math.max(14, currentWidth(source) * 0.2);
            source.travelAcc += gap * 0.35 * t;
            while (source.travelAcc >= gap) {
              source.travelAcc -= gap;
              depositAt(source, source.x, source.y);
            }
          }
        }
        maybeShedFlecks(source);
        return;
      }

      source.coherence -= dt / FEEL.release;
      if (source.coherence <= 0 && !(source.liquidSplash && source.liquidSplash.age < 1.4)) {
        pointers.delete(id);
      }
    });
  }

  function stepParticles(t) {
    rebuildGrid();
    for (let i = 0; i < particles.length; i += 1) {
      stepParticle(particles[i], t);
    }
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
    const contrib =
      particle.role === "matter" || particle.role === "drop" || particle.role === "ripple" || particle.role === "bead"
        ? particle.life * particle.life * particle.glow * FEEL.glowAlpha
        : particle.life * particle.glow * 0.04;
    if (particle.life <= 0 || contrib < 0.009) recycleParticle(i);
    }
  }

  // --- Rendu ---------------------------------------------------------------

  function drawMatterSprite(p, x, y, w, h, alpha) {
    if (alpha < 0.012) return;
    const mix = p.mix;
    if (mix < 0.03) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(glowSprites[p.toneA], x, y, w, h);
      return;
    }
    if (mix > 0.94) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(glowSprites[p.toneB], x, y, w, h);
      return;
    }
    ctx.globalAlpha = alpha * (1 - mix);
    ctx.drawImage(glowSprites[p.toneA], x, y, w, h);
    ctx.globalAlpha = alpha * mix;
    ctx.drawImage(glowSprites[p.toneB], x, y, w, h);
  }

  function drawFleck(p) {
    const twinkle =
      p.role === "spark"
        ? p.glow
        : 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(tick * 0.14 + p.twinkle));
    const gain = p.role === "spark" ? 0.95 : p.role === "burst" ? 0.82 : 0.7;
    const alpha = p.life * twinkle * gain;
    if (alpha < 0.04) return;
    const sprite = glowSprites[p.toneA];

    if (p.role === "spark") {
      const r = p.halo;
      ctx.globalAlpha = alpha * 0.75;
      ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
      const core = r * 0.34;
      ctx.globalAlpha = Math.min(1, alpha * 1.4);
      ctx.drawImage(sprite, p.x - core, p.y - core, core * 2, core * 2);
      return;
    }

    if (p.role === "smoke") {
      const r = p.halo * (1.15 + (1 - p.life) * 0.55);
      ctx.globalAlpha = alpha * 0.28;
      ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
      return;
    }

    const spd = Math.hypot(p.vx, p.vy);
    const r = p.halo;
    if (spd > 0.35) {
      const nx = p.vx / spd;
      const ny = p.vy / spd;
      const tail = r * (1.6 + Math.min(2.4, spd * 0.28));
      ctx.globalAlpha = alpha * 0.55;
      ctx.drawImage(
        sprite,
        p.x - nx * tail - r * 0.85,
        p.y - ny * tail - r * 0.85,
        r * 1.7,
        r * 1.7
      );
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, p.x - r * 0.55, p.y - r * 0.55, r * 1.1, r * 1.1);
      return;
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
  }

  function drawHeartSprite(sprite, x, y, size, rot, alpha) {
    if (!sprite || alpha < 0.02 || size < 1.5) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, -size, -size, size * 2, size * 2);
    ctx.restore();
  }

  function drawHeartMatter(p, alpha) {
    const radius = p.halo * 1.08;
    drawMatterSprite(p, p.x - radius, p.y - radius, radius * 2, radius * 2, alpha * 0.52);
    const spriteA = heartSprites[p.toneA] || glowSprites[p.toneA];
    const spriteB = heartSprites[p.toneB] || spriteA;
    const count = p.halo > 100 ? 3 : p.halo > 58 ? 2 : 1;
    const swirl = tick * 0.01 + p.phase;
    for (let i = 0; i < count; i += 1) {
      const ang = p.angle + i * 2.05 + p.phase * 0.4;
      const dist = p.halo * (i === 0 ? 0.04 : 0.12 + (i % 3) * 0.06) * (0.55 + p.spreadMul * 0.4);
      const hx = p.x + Math.cos(ang) * dist;
      const hy = p.y + Math.sin(ang) * dist;
      const size =
        p.halo *
        (i === 0 ? 0.5 : 0.34 + (i % 2) * 0.06) *
        (0.88 + 0.12 * Math.sin(swirl + i * 1.3));
      const rot = Math.sin(swirl * 0.7 + i) * 0.28 + p.angle * 0.08;
      const sprite = p.mix > 0.55 && i % 2 === 1 ? spriteB : spriteA;
      drawHeartSprite(sprite, hx, hy, size, rot, alpha * (0.78 + p.glow * 0.28) * (i === 0 ? 1 : 0.82));
    }
  }

  function drawLiquidSprite(p, x, y, w, h, alpha) {
    if (alpha < 0.012) return;
    const spriteA = liquidSprites[p.toneA] || glowSprites[p.toneA];
    const spriteB = liquidSprites[p.toneB] || spriteA;
    const mix = p.mix;
    if (mix < 0.03) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(spriteA, x, y, w, h);
      return;
    }
    if (mix > 0.94) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(spriteB, x, y, w, h);
      return;
    }
    ctx.globalAlpha = alpha * (1 - mix);
    ctx.drawImage(spriteA, x, y, w, h);
    ctx.globalAlpha = alpha * mix;
    ctx.drawImage(spriteB, x, y, w, h);
  }

  function drawLiquidMatter(p, alpha) {
    const spd = Math.hypot(p.vx, p.vy);
    const radius = p.halo * (p.head ? 1.08 : 1.08 + p.life * 0.12);
    const bodyAlpha = alpha * (p.head ? 1.1 : 1.28);

    if (p.head) {
      drawLiquidSprite(p, p.x - radius, p.y - radius, radius * 2, radius * 2, bodyAlpha);
      return;
    }

    const stretch = Math.min(1.9, 1.2 + spd * 0.1);
    const compress = 1 / Math.sqrt(stretch);
    const w = radius * 2 * stretch;
    const h = radius * 2 * compress;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aim);
    drawLiquidSprite(p, -w * 0.5, -h * 0.5, w, h, bodyAlpha);
    ctx.restore();
  }

  function drawLiquidDrop(p) {
    const alpha = p.life * p.life * p.glow * FEEL.glowAlpha * 1.15;
    if (alpha < 0.012) return;
    const r = p.halo * 0.95;
    drawLiquidSprite(p, p.x - r, p.y - r, r * 2, r * 2, alpha);
  }

  function drawSpritePair(sprites, p, x, y, w, h, alpha) {
    if (alpha < 0.012) return;
    const spriteA = sprites[p.toneA] || glowSprites[p.toneA];
    const spriteB = sprites[p.toneB] || spriteA;
    const mix = p.mix;
    if (mix < 0.03) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(spriteA, x, y, w, h);
      return;
    }
    if (mix > 0.94) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(spriteB, x, y, w, h);
      return;
    }
    ctx.globalAlpha = alpha * (1 - mix);
    ctx.drawImage(spriteA, x, y, w, h);
    ctx.globalAlpha = alpha * mix;
    ctx.drawImage(spriteB, x, y, w, h);
  }

  function drawLiquidRipple(p) {
    const alpha = p.life * p.life * p.glow * FEEL.glowAlpha * 3.2;
    if (alpha < 0.012) return;
    const rw = Math.max(8, p.ringR);
    const rh = rw * (p.squash || 0.84);
    drawSpritePair(liquidRingSprites, p, p.x - rw, p.y - rh, rw * 2, rh * 2, alpha);
  }

  function drawLiquidBead(p) {
    const alpha = p.life * p.life * p.glow * FEEL.glowAlpha * 2.6;
    if (alpha < 0.012) return;
    const squash = p.squash || 1;
    const w = p.halo;
    const h = p.halo * squash;
    drawSpritePair(liquidBeadSprites, p, p.x - w, p.y - h, w * 2, h * 2, alpha);
  }

  function drawHalo(p) {
    if (p.role === "drop") {
      drawLiquidDrop(p);
      return;
    }

    if (p.role === "ripple") {
      drawLiquidRipple(p);
      return;
    }

    if (p.role === "bead") {
      drawLiquidBead(p);
      return;
    }

    if (p.role !== "matter") {
      drawFleck(p);
      return;
    }

    const alpha = p.life * p.life * p.glow * FEEL.glowAlpha;
    if (alpha < 0.012) return;

    if (activeGlow === "hearts") {
      drawHeartMatter(p, alpha);
      return;
    }

    if (activeGlow === "feu") {
      drawFireTrail(p, alpha);
      return;
    }

    if (activeGlow !== "liquid") {
      const radius = p.halo * 1.2;
      const d = radius * 2;
      drawMatterSprite(p, p.x - radius, p.y - radius, d, d, alpha);
      return;
    }

    drawLiquidMatter(p, alpha);
  }

  function drawFireSprite(p, x, y, w, h, alpha) {
    if (alpha < 0.012) return;
    const spriteA = fireSprites[p.toneA] || glowSprites[p.toneA];
    const spriteB = fireSprites[p.toneB] || spriteA;
    const mix = p.mix;
    if (mix < 0.03) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(spriteA, x, y, w, h);
      return;
    }
    if (mix > 0.94) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(spriteB, x, y, w, h);
      return;
    }
    ctx.globalAlpha = alpha * (1 - mix);
    ctx.drawImage(spriteA, x, y, w, h);
    ctx.globalAlpha = alpha * mix;
    ctx.drawImage(spriteB, x, y, w, h);
  }

  function drawFireCore(p, x, y, d, alpha) {
    if (alpha < 0.012) return;
    const spriteA = fireCoreSprites[p.toneA] || glowSprites[p.toneA];
    const spriteB = fireCoreSprites[p.toneB] || spriteA;
    const mix = p.mix;
    if (mix < 0.03) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(spriteA, x, y, d, d);
      return;
    }
    if (mix > 0.94) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(spriteB, x, y, d, d);
      return;
    }
    ctx.globalAlpha = alpha * (1 - mix);
    ctx.drawImage(spriteA, x, y, d, d);
    ctx.globalAlpha = alpha * mix;
    ctx.drawImage(spriteB, x, y, d, d);
  }

  function drawFireTongue(p, x, y, size, rot, alpha) {
    if (alpha < 0.02 || size < 4) return;
    const w = size * 0.95;
    const h = size * 1.45;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    drawFireSprite(p, -w * 0.5, -h * 0.62, w, h, alpha);
    ctx.restore();
  }

  function drawFireTrail(p, alpha) {
    const fade = p.life * p.life;
    if (fade < 0.02) return;
    const flicker = 0.9 + 0.1 * Math.sin(tick * 0.22 + p.phase);
    const bodyAlpha = Math.min(1, alpha * 0.95 * fade * flicker);
    const w = p.halo * (0.84 + 0.54 * p.life);
    const h = w * (1.25 + 0.35 * (1 - p.life));
    drawFireSprite(p, p.x - w * 0.5, p.y - h * 0.62, w, h, bodyAlpha);
  }

  function drawFireMatter(p, alpha) {
    const source = pointers.get(p.sourceId);
    const flicker = 0.86 + 0.14 * Math.sin(tick * 0.28 + p.phase);
    const bodyAlpha = Math.min(1, alpha * 1.45 * flicker);
    const tx = source ? source.fireTx || 0 : 0;
    const ty = source ? source.fireTy || 0 : 0;
    const trail = Math.hypot(tx, ty);
    let lean = 0;
    if (trail > 0.12) {
      lean = Math.atan2(tx, -ty) * Math.min(0.55, trail * 0.12);
    }
    const stretch = 1 + Math.min(0.45, trail * 0.06);
    const tongues = 4;
    for (let i = 0; i < tongues; i += 1) {
      const orbit = tick * 0.07 + p.phase + i * 1.57;
      const yaw = lean + Math.sin(orbit) * 0.16 + Math.cos(orbit * 0.7) * 0.08;
      const size = p.halo * 0.7 * flicker * (0.82 + 0.18 * Math.abs(Math.sin(orbit * 1.1 + i)));
      const dist = p.halo * (0.04 + (i % 2) * 0.03);
      const hx = p.x + Math.sin(yaw) * dist + tx * 0.55;
      const hy = p.y - Math.cos(yaw) * dist * 0.35 - p.halo * 0.04 + ty * 0.55;
      drawFireTongue(p, hx, hy, size * stretch, yaw, bodyAlpha * (i === 0 ? 1 : 0.72));
    }
    const d = p.halo * 0.88 * (0.92 + 0.08 * flicker);
    drawFireCore(
      p,
      p.x - d * 0.5 + tx * 0.28,
      p.y - d * 0.4 + ty * 0.28,
      d,
      Math.min(1, bodyAlpha * 1.08)
    );
  }

  function render() {
    // Fond opaque chaque frame : le fondu du buffer laissait une empreinte du tracé.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, viewW, viewH);

    if (particles.length === 0) return;

    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < particles.length; i += 1) {
      drawHalo(particles[i]);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // --- Boucle --------------------------------------------------------------

  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    const t = dt * 60;
    tick += t;

    try {
      stepSources(dt, t);
      stepInteract(t);
      stepParticles(t);
      render();
    } catch (err) {
      /* keep the loop alive so composing never freezes */
    }

    requestAnimationFrame(frame);
  }

  // --- Pointer Events ------------------------------------------------------

  function coords(event) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || viewW;
    const h = rect.height || viewH;
    if (w < 1 || h < 1) {
      return { x: viewW * 0.5, y: viewH * 0.5 };
    }
    return {
      x: (event.clientX - rect.left) * (viewW / w),
      y: (event.clientY - rect.top) * (viewH / h),
    };
  }

  function createSource(id, x, y) {
    const toneA = Math.floor(Math.random() * PALETTE.length);
    return {
      id,
      x,
      y,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      prevVx: 0,
      prevVy: 0,
      matterX: x,
      matterY: y,
      matterVx: 0,
      matterVy: 0,
      down: true,
      pressure: 0,
      coherence: 1,
      travelAcc: 0,
      tapTravel: 0,
      bornAt: performance.now(),
      ripple: 0,
      liquidNx: 0,
      liquidNy: 0,
      fireTx: 0,
      fireTy: 0,
      liquidSplash: null,
      toneA,
      toneB: neighborTone(toneA),
      colorMix: 0,
      targetMix: 0,
    };
  }

  function applyMove(source, x, y) {
    const dx = x - source.x;
    const dy = y - source.y;
    const prevVx = source.vx;
    const prevVy = source.vy;
    if (activeGlow === "feu") {
      source.vx = source.vx * 0.72 + dx * 0.28;
      source.vy = source.vy * 0.72 + dy * 0.28;
    } else {
      source.vx = source.vx * 0.58 + dx * 0.42;
      source.vy = source.vy * 0.58 + dy * 0.42;
    }

    const speed = Math.hypot(source.vx, source.vy);
    const prevSpeed = Math.hypot(prevVx, prevVy);
    if (speed > 0.8 && prevSpeed > 0.8) {
      const cos =
        (source.vx * prevVx + source.vy * prevVy) / (speed * prevSpeed);
      if (cos < 0.55) {
        source.targetMix = Math.min(0.42, source.targetMix + (0.55 - cos) * 0.16);
        emitBurst(source, source.x, source.y, speed);
      }
    }

    const dist = Math.hypot(dx, dy);
    source.tapTravel = (source.tapTravel || 0) + dist;
    if (dist > 0.8) {
      const width = currentWidth(source);
      const speedN = Math.min(1, speed / 8);
      let spacing = Math.max(width * 0.17, width * (0.19 + speedN * 0.3));
      if (activeGlow === "liquid") spacing *= 0.16;
      if (activeGlow === "feu") spacing = Math.max(12, width * 0.2);
      spacing *= moodMul("spacing");
      source.travelAcc += dist;
      const x0 = source.x;
      const y0 = source.y;
      while (source.travelAcc >= spacing) {
        source.travelAcc -= spacing;
        const used = dist - source.travelAcc;
        const u = Math.min(1, used / dist);
        depositAt(source, x0 + dx * u, y0 + dy * u);
      }
    }

    source.x = x;
    source.y = y;
  }

  function isUiTarget(event) {
    const el = event.target;
    if (!el || !el.closest) return false;
    return !!el.closest(
      "button, a, .ctrl, .pause-edit-toggle, .pause-edit-card, .pause-edit-list, input, label"
    );
  }

  function releaseCapture(pointerId) {
    const hosts = [canvas, stageEl];
    for (let i = 0; i < hosts.length; i += 1) {
      const host = hosts[i];
      if (!host || typeof host.hasPointerCapture !== "function") continue;
      try {
        if (host.hasPointerCapture(pointerId)) host.releasePointerCapture(pointerId);
      } catch (err) {
        /* ignore */
      }
    }
  }

  function onPointerDown(event) {
    if (!interactive) return;
    if (isUiTarget(event)) return;
    if (pointers.has(event.pointerId)) return;
    event.preventDefault();
    const host = event.currentTarget || canvas;
    try {
      if (host.setPointerCapture) host.setPointerCapture(event.pointerId);
    } catch (err) {
      /* some WebViews reject capture */
    }

    try {
      const { x, y } = coords(event);
      const source = createSource(event.pointerId, x, y);
      pointers.set(source.id, source);
      spawnHead(source);
    } catch (err) {
      /* drawing must remain possible */
    }
  }

  function onPointerMove(event) {
    const source = pointers.get(event.pointerId);
    if (!source || !source.down) return;
    event.preventDefault();

    const coalesced =
      typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : null;

    if (coalesced && coalesced.length > 0) {
      for (let i = 0; i < coalesced.length; i += 1) {
        const point = coords(coalesced[i]);
        applyMove(source, point.x, point.y);
      }
      return;
    }

    const { x, y } = coords(event);
    applyMove(source, x, y);
  }

  function onPointerUp(event) {
    const source = pointers.get(event.pointerId);
    if (!source) return;
    event.preventDefault();
    source.down = false;
    maybeLiquidTapSplash(source);
    if (activeGlow === "burst") emitBurst(source, source.x, source.y, Math.hypot(source.vx, source.vy));
    for (let i = 0; i < particles.length; i += 1) {
      if (particles[i].sourceId === source.id) particles[i].head = false;
    }
    releaseCapture(event.pointerId);
  }

  // --- Canvas responsive ---------------------------------------------------

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const stage = document.getElementById("stage") || canvas.parentElement;
    const rect = stage.getBoundingClientRect();
    viewW = Math.max(1, Math.round(rect.width));
    viewH = Math.max(1, Math.round(rect.height));
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    canvas.style.width = `${viewW}px`;
    canvas.style.height = `${viewH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, viewW, viewH);
    maxParticles = particleBudget();
  }

  resize();
  window.addEventListener("resize", resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize);
  }

  function bindPointer(el) {
    if (!el) return;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
  }
  bindPointer(canvas);
  if (stageEl && stageEl !== canvas) bindPointer(stageEl);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  lastTime = performance.now();
  requestAnimationFrame(frame);

  function setPalette(colors) {
    if (!colors || colors.length < 2) return;
    PALETTE.length = 0;
    for (let i = 0; i < colors.length; i += 1) PALETTE.push(colors[i]);
    glowSprites.length = 0;
    heartSprites.length = 0;
    liquidSprites.length = 0;
    liquidBeadSprites.length = 0;
    liquidRingSprites.length = 0;
    fireSprites.length = 0;
    fireCoreSprites.length = 0;
    for (let i = 0; i < PALETTE.length; i += 1) {
      const rgb = PALETTE[i];
      glowSprites.push(createGlowSprite(rgb[0], rgb[1], rgb[2]));
      heartSprites.push(createHeartSprite(rgb[0], rgb[1], rgb[2]));
      liquidSprites.push(createLiquidSprite(rgb[0], rgb[1], rgb[2]));
      liquidBeadSprites.push(createLiquidBeadSprite(rgb[0], rgb[1], rgb[2]));
      liquidRingSprites.push(createLiquidRingSprite(rgb[0], rgb[1], rgb[2]));
      fireSprites.push(createFireSprite(rgb[0], rgb[1], rgb[2]));
      fireCoreSprites.push(createFireCoreSprite(rgb[0], rgb[1], rgb[2]));
    }
  }

  function resetMatter() {
    pointers.clear();
    downCache.length = 0;
    while (particles.length > 0) recycleParticle(0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  function setGlow(id) {
    activeGlow = id || "soft";
  }

  function setMood(id) {
    moodId = MOOD_MUL[id] ? id : "flow";
  }

  window.AURA_ENGINE = {
    setPalette,
    setGlow,
    setMood,
    resetMatter,
    resize,
    setInteractive(value) {
      interactive = !!value;
    },
    isInteractive() {
      return interactive;
    },
    getCanvas() {
      return canvas;
    },
  };
})();
