(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const BG = "#07070c";
  const MAX = 22;

  let canvas = null;
  let ctx = null;
  let running = false;
  let raf = 0;
  let viewW = 0;
  let viewH = 0;
  let lastTime = 0;
  let tick = 0;
  let idleAcc = 0;
  let glow = "soft";
  let mood = "flow";
  let dpr = 1;

  const palette = [
    [168, 64, 255],
    [255, 58, 168],
    [32, 168, 255],
    [255, 108, 78],
    [36, 232, 158],
    [255, 206, 48],
  ];
  let sprites = [];
  let heartSprites = [];
  const particles = [];
  const pointer = {
    down: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };

  function moodScale() {
    if (mood === "calm") return 0.72;
    if (mood === "wild") return 1.28;
    return 1;
  }

  function makeSprite(r, g, b) {
    const size = 160;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const mid = size * 0.5;
    const cr = Math.round(r * 0.32 + 255 * 0.68);
    const cg = Math.round(g * 0.32 + 255 * 0.68);
    const cb = Math.round(b * 0.32 + 255 * 0.68);
    const gradient = gfx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    gradient.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.5)`);
    gradient.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, 0.22)`);
    gradient.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.05)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = gradient;
    gfx.fillRect(0, 0, size, size);
    return sprite;
  }

  function makeHeartSprite(r, g, b) {
    const size = 72;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const gfx = sprite.getContext("2d");
    const mid = size * 0.5;
    const cr = Math.round(r * 0.38 + 255 * 0.62);
    const cg = Math.round(g * 0.38 + 255 * 0.62);
    const cb = Math.round(b * 0.38 + 255 * 0.62);
    const aura = gfx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    aura.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.3)`);
    aura.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.08)`);
    aura.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    gfx.fillStyle = aura;
    gfx.fillRect(0, 0, size, size);
    gfx.globalCompositeOperation = "lighter";
    gfx.beginPath();
    gfx.moveTo(mid, mid + size * 0.18);
    gfx.bezierCurveTo(mid - 8, mid, mid - 18, mid - 8, mid - 10, mid - 16);
    gfx.bezierCurveTo(mid - 4, mid - 22, mid, mid - 14, mid, mid - 6);
    gfx.bezierCurveTo(mid, mid - 14, mid + 4, mid - 22, mid + 10, mid - 16);
    gfx.bezierCurveTo(mid + 18, mid - 8, mid + 8, mid, mid, mid + 18);
    gfx.closePath();
    gfx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.55)`;
    gfx.fill();
    gfx.globalCompositeOperation = "source-over";
    return sprite;
  }

  function rebuildSprites() {
    sprites = palette.map((rgb) => makeSprite(rgb[0], rgb[1], rgb[2]));
    heartSprites = palette.map((rgb) => makeHeartSprite(rgb[0], rgb[1], rgb[2]));
  }

  function spawn(x, y, vx, vy, role, tone) {
    if (particles.length >= MAX) {
      particles.shift();
    }
    particles.push({
      x,
      y,
      vx,
      vy,
      life: 1,
      decay: role === "matter" ? 0.55 : 0.8,
      halo: role === "matter" ? 22 + Math.random() * 10 : 6 + Math.random() * 6,
      tone: tone % sprites.length,
      role,
      phase: Math.random() * TAU,
    });
  }

  function idlePulse() {
    const cx = viewW * 0.5;
    const cy = viewH * 0.52;
    const t = tick * 0.018 * moodScale();
    const tone = Math.floor(tick * 0.008) % Math.max(1, sprites.length);
    spawn(
      cx + Math.cos(t) * 10,
      cy + Math.sin(t * 0.7) * 6,
      Math.cos(t) * 0.15,
      Math.sin(t) * 0.1,
      "matter",
      tone
    );
  }

  function coords(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function onDown(event) {
    if (!running) return;
    event.preventDefault();
    const point = coords(event);
    pointer.down = true;
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.vx = 0;
    pointer.vy = 0;
    canvas.setPointerCapture(event.pointerId);
  }

  function onMove(event) {
    if (!pointer.down) return;
    event.preventDefault();
    const point = coords(event);
    pointer.vx = pointer.vx * 0.5 + (point.x - pointer.x) * 0.5;
    pointer.vy = pointer.vy * 0.5 + (point.y - pointer.y) * 0.5;
    pointer.x = point.x;
    pointer.y = point.y;
    const speed = Math.hypot(pointer.vx, pointer.vy);
    const tone = Math.floor(Math.random() * sprites.length);
    const energy = moodScale();
    spawn(
      pointer.x,
      pointer.y,
      pointer.vx * 0.45,
      pointer.vy * 0.45,
      "matter",
      tone
    );
    if (glow === "spark" && Math.random() < 0.45 * energy) {
      spawn(
        pointer.x + (Math.random() - 0.5) * 16,
        pointer.y + (Math.random() - 0.5) * 16,
        pointer.vx * 0.4 + (Math.random() - 0.5) * 1.4,
        pointer.vy * 0.4 + (Math.random() - 0.5) * 1.4,
        "spark",
        tone
      );
    }
    if (glow === "ember" && Math.random() < 0.4 * energy) {
      spawn(
        pointer.x,
        pointer.y,
        pointer.vx * 0.15,
        pointer.vy * 0.1 - 0.8,
        "ember",
        tone
      );
    }
    if (glow === "burst" && speed > 4 && Math.random() < 0.35 * energy) {
      const ang = Math.atan2(pointer.vy, pointer.vx) + (Math.random() - 0.5);
      spawn(
        pointer.x,
        pointer.y,
        Math.cos(ang) * (1.6 + speed * 0.2),
        Math.sin(ang) * (1.6 + speed * 0.2),
        "burst",
        tone
      );
    }
  }

  function onUp(event) {
    pointer.down = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function step(dt) {
    const t = dt * 60;
    tick += t;
    const scale = moodScale();
    if (!pointer.down) {
      idleAcc += dt;
      if (idleAcc > 0.32 / scale) {
        idleAcc = 0;
        idlePulse();
      }
    }

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      if (p.role === "ember") p.vy -= 0.12 * t;
      if (glow === "liquid" && p.role === "matter") {
        p.vx *= Math.pow(0.97, t);
        p.vy *= Math.pow(0.97, t);
      } else {
        p.vx *= Math.pow(0.94, t);
        p.vy *= Math.pow(0.94, t);
      }
      p.x += p.vx * t * (0.7 + scale * 0.3);
      p.y += p.vy * t * (0.7 + scale * 0.3);
      p.life -= p.decay * (t / 60) * (mood === "calm" ? 0.75 : mood === "wild" ? 1.15 : 1);
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function draw() {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const sprite = sprites[p.tone];
      if (!sprite) continue;
      let radius = p.halo * p.life;
      if (p.role === "spark") radius *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(tick * 0.2 + p.phase));
      if (glow === "liquid" && p.role === "matter") radius *= 1.15;
      const alpha = p.role === "matter" ? p.life * p.life * 0.55 : p.life * 0.8;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, p.x - radius, p.y - radius, radius * 2, radius * 2);
      if (glow === "hearts" && p.role === "matter") {
        const heart = heartSprites[p.tone];
        if (heart) {
          const hs = radius * 0.42;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.sin(tick * 0.04 + p.phase) * 0.3);
          ctx.globalAlpha = alpha * 0.85;
          ctx.drawImage(heart, -hs, -hs, hs * 2, hs * 2);
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    viewW = Math.max(1, Math.round(rect.width));
    viewH = Math.max(1, Math.round(rect.height));
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function bind() {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
  }

  function unbind() {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
  }

  function start(target) {
    stop();
    canvas = target;
    ctx = canvas.getContext("2d", { alpha: false });
    rebuildSprites();
    particles.length = 0;
    running = true;
    lastTime = performance.now();
    resize();
    bind();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    pointer.down = false;
    particles.length = 0;
    if (canvas) unbind();
    canvas = null;
    ctx = null;
  }

  function setPalette(colors) {
    if (!colors || colors.length < 2) return;
    palette.length = 0;
    for (let i = 0; i < colors.length; i += 1) palette.push(colors[i]);
    rebuildSprites();
  }

  function setGlow(id) {
    glow = id || "soft";
  }

  function setMood(id) {
    mood = id || "flow";
  }

  window.AURA_PREVIEW = {
    start,
    stop,
    setPalette,
    setGlow,
    setMood,
    resize,
  };
})();
