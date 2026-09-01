(() => {
  "use strict";

  const TAU = Math.PI * 2;

  // Réglages du feeling — à tweaker en priorité.
  const FEEL = {
    glowAlpha: 0.2,
    haloMin: 39,
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

  const auraPair = {
    active: false,
    influence: 0,
    together: 0,
    oppose: 0,
    a: null,
    b: null,
    mx: 0,
    my: 0,
  };

  const BG = "#07070c";
  const GRID_CELL = 56;

  const PALETTE = [
    [198, 186, 218],
    [222, 196, 202],
    [184, 204, 218],
    [226, 204, 186],
    [186, 214, 204],
    [226, 218, 184],
  ];

  const canvas = document.getElementById("aura");
  const ctx = canvas.getContext("2d", { alpha: false });

  let viewW = 0;
  let viewH = 0;
  let lastTime = 0;
  let tick = 0;

  const glowSprites = PALETTE.map((rgb) => createGlowSprite(rgb[0], rgb[1], rgb[2]));

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

  function currentWidth(source) {
    return FEEL.haloMin + source.pressure * (FEEL.haloMax - FEEL.haloMin);
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

  function downCount() {
    let n = 0;
    pointers.forEach((source) => {
      if (source.down) n += 1;
    });
    return n;
  }

  // Champ partagé : deux points proches reçoivent le même flux.
  function flowAt(x, y) {
    const t = tick * FEEL.flowSpeed;
    const s = FEEL.flowScale;
    const a = Math.sin(x * s + t) + Math.sin((x + y) * s * 0.73 + t * 1.07);
    const b = Math.cos(y * s - t * 0.81) + Math.cos((x - y) * s * 0.61 + t * 0.93);
    return {
      x: b * FEEL.turbulence,
      y: -a * FEEL.turbulence,
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
          if (other === particle) continue;
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
    particle.vx += (svx * inv - particle.vx) * FEEL.align * t;
    particle.vy += (svy * inv - particle.vy) * FEEL.align * t;
    particle.vx += (sx * inv - particle.x) * FEEL.cohesion * t;
    particle.vy += (sy * inv - particle.y) * FEEL.cohesion * t;
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
      if (!p.head && p.life < minLife) {
        minLife = p.life;
        idx = i;
      }
    }
    if (idx >= 0) recycleParticle(idx);
  }

  function spawnParticle(source, x, y, inherit, isHead) {
    if (particles.length >= maxParticles) {
      recycleOldestDeposit();
      if (particles.length >= maxParticles) return;
    }

    const width = currentWidth(source);
    const speed = Math.hypot(source.vx, source.vy);
    const spread = width * (isHead ? 0.2 : 0.22) * (0.7 + Math.min(speed, 8) * 0.03);
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
    particle.spreadMul = 0.25 + Math.random() * 0.85;
    particle.angle = angle;
    particle.life = 1;
    particle.decay = FEEL.dissipate + Math.random() * 0.14;
    particle.lag = 0.4 + Math.random() * 0.9;
    particle.glow = 0.62 + Math.random() * 0.4;
    particle.phase = Math.random() * TAU;
    particle.head = isHead;
    particle.toneA = source.toneA;
    particle.toneB = source.toneB;
    particle.mix = source.colorMix;
    particle.sourceId = source.id;
    particles.push(particle);
  }

  function spawnHead(source) {
    for (let i = 0; i < FEEL.headCount; i += 1) {
      spawnParticle(source, source.x, source.y, 0.08, true);
    }
  }

  function depositAt(source, x, y) {
    const speed = Math.hypot(source.vx, source.vy);
    const stretch = Math.min(1.8, 0.85 + speed * 0.12);
    let px = x - source.vx * stretch;
    let py = y - source.vy * stretch;
    if (speed > 0.35) {
      const inv = 1 / speed;
      const side = (Math.random() - 0.5) * currentWidth(source) * 0.38;
      px += -source.vy * inv * side;
      py += source.vx * inv * side;
    }
    spawnParticle(
      source,
      px,
      py,
      FEEL.inherit + Math.min(0.22, speed * 0.04),
      false
    );
  }

  // --- Simulation ----------------------------------------------------------

  function headTarget(particle, source) {
    const width = currentWidth(source);
    const speed = Math.hypot(source.vx, source.vy);
    const breathe = 1 + Math.sin(tick * 0.038 + particle.phase) * 0.07;
    let ox = Math.cos(particle.angle) * width * 0.14 * particle.spreadMul * breathe;
    let oy = Math.sin(particle.angle) * width * 0.14 * particle.spreadMul * breathe;

    if (speed > 0.55) {
      const inv = 1 / speed;
      const nx = source.vx * inv;
      const ny = source.vy * inv;
      const along = ox * nx + oy * ny;
      const stretch = Math.min(3.2, 1 + speed * FEEL.stretch);
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
    source.matterVx += (source.x - source.matterX) * FEEL.matterCatch * t;
    source.matterVy += (source.y - source.matterY) * FEEL.matterCatch * t;
    source.matterVx *= Math.pow(FEEL.matterDrag, t);
    source.matterVy *= Math.pow(FEEL.matterDrag, t);
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

  function stepPair(t) {
    auraPair.active = false;
    auraPair.influence = 0;
    auraPair.a = null;
    auraPair.b = null;

    const down = [];
    pointers.forEach((source) => {
      if (source.down) down.push(source);
    });
    if (down.length < 2) return;

    const a = down[0];
    const b = down[1];
    const dx = b.matterX - a.matterX;
    const dy = b.matterY - a.matterY;
    const dist = Math.hypot(dx, dy);
    const span = currentWidth(a) + currentWidth(b);
    const outer = span + INTERACT.radiusPad;
    const inner = span * 0.42;
    const influence = smootherstep(outer, inner, dist);
    if (influence <= 0) return;

    auraPair.active = true;
    auraPair.a = a;
    auraPair.b = b;
    auraPair.influence = influence;
    auraPair.mx = (a.matterX + b.matterX) * 0.5;
    auraPair.my = (a.matterY + b.matterY) * 0.5;

    const va = Math.hypot(a.vx, a.vy);
    const vb = Math.hypot(b.vx, b.vy);
    let align = 0;
    if (va > 0.25 && vb > 0.25) {
      align = (a.vx * b.vx + a.vy * b.vy) / (va * vb);
    }
    auraPair.together = Math.max(0, align);
    auraPair.oppose = Math.max(0, -align);

    const inv = 1 / (dist + 1);
    const pull = INTERACT.attract * influence;
    a.matterVx += dx * inv * pull * t;
    a.matterVy += dy * inv * pull * t;
    b.matterVx -= dx * inv * pull * t;
    b.matterVy -= dy * inv * pull * t;

    if (auraPair.together > 0) {
      const c = INTERACT.together * auraPair.together * influence * t;
      const avx = (a.vx + b.vx) * 0.5;
      const avy = (a.vy + b.vy) * 0.5;
      a.matterVx += (avx - a.matterVx) * c;
      a.matterVy += (avy - a.matterVy) * c;
      b.matterVx += (avx - b.matterVx) * c;
      b.matterVy += (avy - b.matterVy) * c;
    }
  }

  function applyPairToParticle(particle, t) {
    if (!auraPair.active) return;
    const other =
      particle.sourceId === auraPair.a.id
        ? auraPair.b
        : particle.sourceId === auraPair.b.id
          ? auraPair.a
          : null;
    if (!other) return;

    const ox = other.matterX - particle.x;
    const oy = other.matterY - particle.y;
    const reach = currentWidth(other) + 70;
    const nearOther = Math.exp(-(ox * ox + oy * oy) / (reach * reach));
    const pull =
      INTERACT.particlePull *
      auraPair.influence *
      (0.4 + auraPair.together * 0.8);
    particle.vx += ox * pull * nearOther * t;
    particle.vy += oy * pull * nearOther * t;

    const mx = particle.x - auraPair.mx;
    const my = particle.y - auraPair.my;
    const mid = Math.exp(-(mx * mx + my * my) / 8100);
    const swirl =
      INTERACT.swirl * auraPair.influence * (0.25 + auraPair.oppose * 1.4);
    particle.vx += -my * swirl * mid * t;
    particle.vy += mx * swirl * mid * t;

    if (auraPair.oppose > 0.05) {
      const f = flowAt(particle.x + 18, particle.y - 18);
      const boost = INTERACT.turbBoost * auraPair.influence * auraPair.oppose * mid;
      particle.vx += f.x * boost * t;
      particle.vy += f.y * boost * t;
    }
  }

  function applyPairColor(particle, t) {
    if (!auraPair.active) return;
    const other =
      particle.sourceId === auraPair.a.id
        ? auraPair.b
        : particle.sourceId === auraPair.b.id
          ? auraPair.a
          : null;
    if (!other) return;

    particle.toneB = other.toneA;
    const target = auraPair.influence * 0.5;
    particle.mix += (target - particle.mix) * INTERACT.colorBleed * t;
  }

  function stepParticle(particle, t) {
    const source = pointers.get(particle.sourceId);
    const coherence = source ? source.coherence : 0;
    const isLiveHead = particle.head && source && source.down;
    const flow = flowAt(particle.x, particle.y);
    particle.vx += flow.x * t;
    particle.vy += flow.y * t;
    applyFlock(particle, t);
    applyPairToParticle(particle, t);

    if (isLiveHead) {
      const target = headTarget(particle, source);
      particle.vx += (target.x - particle.x) * FEEL.follow * particle.lag * t;
      particle.vy += (target.y - particle.y) * FEEL.follow * particle.lag * t;
      particle.vx += (source.vx - particle.vx) * 0.08 * t;
      particle.vy += (source.vy - particle.vy) * 0.08 * t;
      particle.halo = currentWidth(source) * particle.haloMul;
      particle.mix += (source.colorMix - particle.mix) * 0.08;
    } else if (source && source.down) {
      const width = currentWidth(source);
      const dx = particle.x - source.matterX;
      const dy = particle.y - source.matterY;
      const falloff = Math.exp(-(dx * dx + dy * dy) / (width * width * 2.8 + 80));
      particle.vx += source.ax * FEEL.stir * falloff;
      particle.vy += source.ay * FEEL.stir * falloff;
    }

    applyPairColor(particle, t);

    const drag = isLiveHead
      ? FEEL.dragHead
      : coherence > 0.15
        ? FEEL.dragHeld
        : FEEL.dragFree;
    const keep = Math.pow(drag, t);
    particle.vx *= keep;
    particle.vy *= keep;
    particle.x += particle.vx * t;
    particle.y += particle.vy * t;

    if (isLiveHead) {
      particle.life = 1;
      return;
    }

    const decay = source && source.down ? 0.045 : particle.decay;
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
      stepMatter(source, t);

      const speed = Math.hypot(source.vx, source.vy);
      stepColor(source, dt, speed);

      if (source.down) {
        source.coherence = 1;
        if (speed < FEEL.stillSpeed) {
          source.pressure += (1 - source.pressure) * (1 - Math.exp(-dt / FEEL.holdRamp));
        }
        return;
      }

      source.coherence -= dt / FEEL.release;
      if (source.coherence <= 0) pointers.delete(id);
    });
  }

  function stepParticles(t) {
    rebuildGrid();
    for (let i = 0; i < particles.length; i += 1) {
      stepParticle(particles[i], t);
    }
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      const contrib = particle.life * particle.life * particle.glow * FEEL.glowAlpha;
      if (particle.life <= 0 || contrib < 0.009) recycleParticle(i);
    }
  }

  // --- Rendu ---------------------------------------------------------------

  function drawHalo(p) {
    const alpha = p.life * p.life * p.glow * FEEL.glowAlpha;
    if (alpha < 0.012) return;
    const radius = p.halo * 1.2;
    const d = radius * 2;
    const x = p.x - radius;
    const y = p.y - radius;
    const mix = p.mix;
    if (mix < 0.03) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(glowSprites[p.toneA], x, y, d, d);
      return;
    }
    if (mix > 0.94) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(glowSprites[p.toneB], x, y, d, d);
      return;
    }
    ctx.globalAlpha = alpha * (1 - mix);
    ctx.drawImage(glowSprites[p.toneA], x, y, d, d);
    ctx.globalAlpha = alpha * mix;
    ctx.drawImage(glowSprites[p.toneB], x, y, d, d);
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

    stepSources(dt, t);
    stepPair(t);
    stepParticles(t);
    render();

    requestAnimationFrame(frame);
  }

  // --- Pointer Events ------------------------------------------------------

  function coords(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
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
    source.vx = source.vx * 0.58 + dx * 0.42;
    source.vy = source.vy * 0.58 + dy * 0.42;

    const speed = Math.hypot(source.vx, source.vy);
    const prevSpeed = Math.hypot(prevVx, prevVy);
    if (speed > 0.8 && prevSpeed > 0.8) {
      const cos =
        (source.vx * prevVx + source.vy * prevVy) / (speed * prevSpeed);
      if (cos < 0.55) {
        source.targetMix = Math.min(0.42, source.targetMix + (0.55 - cos) * 0.16);
      }
    }

    const dist = Math.hypot(dx, dy);
    if (dist > 0.8) {
      const width = currentWidth(source);
      const speedN = Math.min(1, speed / 8);
      const spacing = Math.max(width * 0.17, width * (0.19 + speedN * 0.3));
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

  function onPointerDown(event) {
    event.preventDefault();
    if (downCount() >= 2) return;
    canvas.setPointerCapture(event.pointerId);

    const { x, y } = coords(event);
    const source = createSource(event.pointerId, x, y);
    pointers.set(source.id, source);
    spawnHead(source);
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
    for (let i = 0; i < particles.length; i += 1) {
      if (particles[i].sourceId === source.id) particles[i].head = false;
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  // --- Canvas responsive ---------------------------------------------------

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
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

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  lastTime = performance.now();
  requestAnimationFrame(frame);
})();
