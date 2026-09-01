(() => {
  "use strict";

  const TAU = Math.PI * 2;

  // Réglages du feeling — à tweaker en priorité.
  const FEEL = {
    trailFade: 0.085,
    glowAlpha: 0.1,
    haloMin: 39,
    haloMax: 88,
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
  };

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
  let maxParticles = 96;

  function particleBudget() {
    const area = viewW * viewH;
    if (area < 400000) return 110;
    if (area < 900000) return 150;
    return 190;
  }

  function createGlowSprite(r, g, b) {
    const size = 256;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const mid = size * 0.5;
    const cr = Math.round(r * 0.32 + 255 * 0.68);
    const cg = Math.round(g * 0.32 + 255 * 0.68);
    const cb = Math.round(b * 0.32 + 255 * 0.68);
    const gradient = gfx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    gradient.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.2)`);
    gradient.addColorStop(0.16, `rgba(${r}, ${g}, ${b}, 0.1)`);
    gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.03)`);
    gradient.addColorStop(0.68, `rgba(${r}, ${g}, ${b}, 0.008)`);
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
    const spread = width * (isHead ? 0.16 : 0.1) * (0.65 + Math.min(speed, 8) * 0.05);
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
    spawnParticle(
      source,
      x - source.vx * stretch,
      y - source.vy * stretch,
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

  function stepParticle(particle, t) {
    const source = pointers.get(particle.sourceId);
    const coherence = source ? source.coherence : 0;
    const isLiveHead = particle.head && source && source.down;
    const flow = flowAt(particle.x, particle.y);
    particle.vx += flow.x * t;
    particle.vy += flow.y * t;

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
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      stepParticle(particles[i], t);
      if (particles[i].life <= 0) recycleParticle(i);
    }
  }

  // --- Rendu ---------------------------------------------------------------

  function drawHalo(p) {
    const alpha = p.life * p.life * p.glow * FEEL.glowAlpha;
    if (alpha < 0.01) return;
    const radius = p.halo * 1.08;
    const d = radius * 2;
    const x = p.x - radius;
    const y = p.y - radius;
    const mix = p.mix;
    if (mix < 0.06) {
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
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(7, 7, 12, ${FEEL.trailFade})`;
    ctx.fillRect(0, 0, viewW, viewH);

    if (particles.length === 0) return;

    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < particles.length; i += 1) {
      drawHalo(particles[i]);
    }
    ctx.globalAlpha = 1;
  }

  // --- Boucle --------------------------------------------------------------

  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    const t = dt * 60;
    tick += t;

    stepSources(dt, t);
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
      const spacing = Math.max(4.5, width * (0.09 + speedN * 0.26));
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
    ctx.fillStyle = "#07070c";
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
