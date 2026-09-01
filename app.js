(() => {
  "use strict";

  const TAU = Math.PI * 2;

  const canvas = document.getElementById("aura");
  const ctx = canvas.getContext("2d", { alpha: false });

  let viewW = 0;
  let viewH = 0;
  let lastTime = 0;

  // --- Interactions --------------------------------------------------------

  // Une entrée par pointerId : le multi-touch n'aura qu'à alimenter cette Map.
  const pointers = new Map();

  // --- Système de particules -----------------------------------------------

  const pool = [];
  const particles = [];
  let maxParticles = 560;

  function particleBudget() {
    const area = viewW * viewH;
    if (area < 400000) return 420;
    if (area < 900000) return 620;
    return 820;
  }

  function obtainParticle() {
    return pool.pop() || {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      ox: 0,
      oy: 0,
      size: 0,
      life: 0,
      decay: 0,
      lag: 0,
      phase: 0,
      sourceId: 0,
    };
  }

  function recycleParticle(index) {
    const particle = particles[index];
    particles[index] = particles[particles.length - 1];
    particles.pop();
    pool.push(particle);
  }

  function spawnParticle(source, x, y, inherit) {
    if (particles.length >= maxParticles) return;

    const spread = 12 + source.density * 32;
    const angle = Math.random() * TAU;
    const radius = Math.sqrt(Math.random()) * spread;

    const particle = obtainParticle();
    particle.x = x + Math.cos(angle) * radius * 0.25;
    particle.y = y + Math.sin(angle) * radius * 0.25;
    particle.ox = Math.cos(angle) * radius;
    particle.oy = Math.sin(angle) * radius;
    particle.vx = source.vx * inherit + (Math.random() - 0.5) * 0.4;
    particle.vy = source.vy * inherit + (Math.random() - 0.5) * 0.4;
    particle.size = 1.4 + Math.random() * 2.6;
    particle.life = 1;
    particle.decay = 0.28 + Math.random() * 0.2;
    particle.lag = 0.45 + Math.random() * 0.85;
    particle.phase = Math.random() * TAU;
    particle.sourceId = source.id;
    particles.push(particle);
  }

  function spawnBurst(source, count) {
    for (let i = 0; i < count; i += 1) {
      spawnParticle(source, source.x, source.y, 0.05);
    }
  }

  function spawnAlong(source, x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.min(6, Math.round(dist / 16)));
    for (let i = 0; i < steps; i += 1) {
      const t = (i + 1) / steps;
      spawnParticle(
        source,
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
        0.35
      );
    }
  }

  // --- Simulation ----------------------------------------------------------

  function stretchedOffset(particle, source, tick) {
    const speed = Math.hypot(source.vx, source.vy);
    const breathe = 1 + Math.sin(tick * 0.045 + particle.phase) * 0.1;
    let ox = particle.ox * breathe;
    let oy = particle.oy * breathe;

    if (speed > 0.8) {
      const inv = 1 / speed;
      const nx = source.vx * inv;
      const ny = source.vy * inv;
      const along = ox * nx + oy * ny;
      const stretch = Math.min(2.6, 1 + speed * 0.12);
      const compress = 1 / Math.sqrt(stretch);
      ox = along * nx * stretch + (ox - along * nx) * compress;
      oy = along * ny * stretch + (oy - along * ny) * compress;
    }

    return { x: source.x + ox, y: source.y + oy };
  }

  function stepParticle(particle, t, tick) {
    const source = pointers.get(particle.sourceId);
    const coherence = source ? source.coherence : 0;

    if (source && coherence > 0) {
      const target = stretchedOffset(particle, source, tick);
      const follow = 0.16 * particle.lag * coherence;
      particle.vx += (target.x - particle.x) * follow * t;
      particle.vy += (target.y - particle.y) * follow * t;
      particle.vx += source.vx * 0.18 * coherence * t;
      particle.vy += source.vy * 0.18 * coherence * t;

      const dx = particle.x - source.x;
      const dy = particle.y - source.y;
      particle.vx += -dy * 0.012 * coherence * t;
      particle.vy += dx * 0.012 * coherence * t;
    } else {
      particle.vx += Math.sin(tick * 0.03 + particle.phase) * 0.12 * t;
      particle.vy += Math.cos(tick * 0.025 + particle.phase * 1.3) * 0.12 * t;
      particle.vx += particle.ox * 0.004 * t;
      particle.vy += particle.oy * 0.004 * t;
    }

    const drag = coherence > 0.2 ? 0.78 : 0.96;
    const keep = Math.pow(drag, t);
    particle.vx *= keep;
    particle.vy *= keep;

    particle.x += particle.vx * t;
    particle.y += particle.vy * t;

    const decay = coherence > 0.25 ? 0.04 : particle.decay;
    particle.life -= decay * (t / 60);
  }

  function stepSources(dt, t) {
    pointers.forEach((source, id) => {
      source.vx *= Math.pow(0.88, t);
      source.vy *= Math.pow(0.88, t);

      if (source.down) {
        source.held += dt;
        source.density = 1 - Math.exp(-source.held / 1.4);
        source.coherence = 1;

        const speed = Math.hypot(source.vx, source.vy);
        if (speed < 1.2) {
          const rate = 55 + source.density * 200;
          source.spawnAcc += rate * dt;
          while (source.spawnAcc >= 1) {
            spawnParticle(source, source.x, source.y, 0.08);
            source.spawnAcc -= 1;
          }
        }
        return;
      }

      source.coherence -= dt / 0.75;
      if (source.coherence <= 0) pointers.delete(id);
    });
  }

  function stepParticles(t, tick) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      stepParticle(particles[i], t, tick);
      if (particles[i].life <= 0) recycleParticle(i);
    }
  }

  // --- Rendu ---------------------------------------------------------------

  function render() {
    // Fondu du buffer : traînée fluide sans stocker d'historique de positions.
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(7, 7, 12, 0.14)";
    ctx.fillRect(0, 0, viewW, viewH);

    if (particles.length === 0) return;

    ctx.globalCompositeOperation = "lighter";

    ctx.fillStyle = "rgba(172, 188, 218, 0.09)";
    ctx.beginPath();
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const r = p.size * (1.7 + p.life);
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, TAU);
    }
    ctx.fill();

    ctx.fillStyle = "rgba(232, 236, 246, 0.2)";
    ctx.beginPath();
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const r = p.size * (0.4 + p.life * 0.5);
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, TAU);
    }
    ctx.fill();
  }

  // --- Boucle --------------------------------------------------------------

  let tick = 0;

  function frame(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    const t = dt * 60;
    tick += t;

    stepSources(dt, t);
    stepParticles(t, tick);
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

  function applyMove(source, x, y) {
    const dx = x - source.x;
    const dy = y - source.y;
    source.vx = source.vx * 0.55 + dx * 0.45;
    source.vy = source.vy * 0.55 + dy * 0.45;

    if (dx * dx + dy * dy > 2.25) {
      spawnAlong(source, source.x, source.y, x, y);
    }

    source.x = x;
    source.y = y;
  }

  function onPointerDown(event) {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);

    const { x, y } = coords(event);
    const source = {
      id: event.pointerId,
      x,
      y,
      vx: 0,
      vy: 0,
      down: true,
      held: 0,
      density: 0,
      coherence: 1,
      spawnAcc: 0,
    };
    pointers.set(source.id, source);
    spawnBurst(source, 42);
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
