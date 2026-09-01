(() => {
  "use strict";

  const CONSENT_KEY = "aura-consent";
  const gateDesktop = document.getElementById("gate-desktop");
  const gateRotate = document.getElementById("gate-rotate");

  const appState = {
    screen: "intro",
    auraConfig: {
      palette: "default",
      glow: "soft",
    },
    recording: {
      status: "idle",
    },
  };

  const screens = document.querySelectorAll("[data-screen]");
  const createBar = document.getElementById("create-controls");
  const btnBackConfig = document.getElementById("btn-back-config");
  const btnPlay = document.getElementById("btn-play");
  const btnPause = document.getElementById("btn-pause");
  const btnStop = document.getElementById("btn-stop");
  const resultVideo = document.getElementById("result-video");
  const downloadLink = document.getElementById("btn-download");

  function paletteById(id) {
    return window.AURA_PALETTES.find((item) => item.id === id) || window.AURA_PALETTES[0];
  }

  function isDesktop() {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    if (coarse) return false;
    if (navigator.maxTouchPoints > 0 && shortSide < 700) return false;
    return shortSide >= 600;
  }

  function isPortrait() {
    return window.innerHeight >= window.innerWidth;
  }

  function tryLockPortrait() {
    const orientation = screen.orientation;
    if (!orientation || typeof orientation.lock !== "function") return;
    orientation.lock("portrait").catch(() => {});
  }

  function updateViewportMode() {
    const desktop = isDesktop();
    const landscape = !desktop && !isPortrait();
    document.body.classList.toggle("is-desktop", desktop);
    document.body.classList.toggle("is-landscape", landscape);
    gateDesktop.hidden = !desktop;
    gateRotate.hidden = !landscape;

    if (desktop || landscape) {
      if (window.AURA_ENGINE) window.AURA_ENGINE.setInteractive(false);
      return;
    }

    if (window.AURA_ENGINE) {
      window.AURA_ENGINE.setInteractive(appState.screen === "create");
    }
  }

  function go(screen) {
    appState.screen = screen;
    document.body.dataset.screen = screen;
    screens.forEach((el) => {
      el.classList.toggle("is-on", el.dataset.screen === screen);
    });
    const creating = screen === "create";
    document.body.classList.toggle("is-create", creating);
    createBar.hidden = !creating;
    btnBackConfig.hidden = !creating;
    if (window.AURA_ENGINE) window.AURA_ENGINE.setInteractive(creating);
    if (creating) syncRecordButtons();
    updateViewportMode();
  }

  function applyConfigToEngine() {
    const palette = paletteById(appState.auraConfig.palette);
    window.AURA_ENGINE.setPalette(palette.colors);
    window.AURA_ENGINE.setGlow(appState.auraConfig.glow);
    window.AURA_ENGINE.resetMatter();
  }

  function afterIntro() {
    if (isDesktop() || !isPortrait()) return;
    const consent = localStorage.getItem(CONSENT_KEY);
    if (consent === "accepted" || consent === "refused") go("configure");
    else go("consent");
  }

  function syncRecordButtons() {
    const status = window.AURA_RECORD.getState().status;
    appState.recording.status = status;
    const idle = status === "idle";
    const recording = status === "recording";
    const paused = status === "paused";
    btnPlay.hidden = !(idle || paused);
    btnPause.hidden = !recording;
    btnStop.hidden = !(recording || paused);
  }

  function enterCreate() {
    applyConfigToEngine();
    window.AURA_RECORD.cleanup();
    go("create");
  }

  function renderPaletteCards() {
    const root = document.getElementById("palette-list");
    root.innerHTML = "";
    window.AURA_PALETTES.forEach((palette) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-card";
      btn.dataset.id = palette.id;
      if (palette.id === appState.auraConfig.palette) btn.classList.add("is-selected");
      const swatches = document.createElement("span");
      swatches.className = "swatches";
      palette.colors.forEach((rgb) => {
        const dot = document.createElement("i");
        dot.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        swatches.appendChild(dot);
      });
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = palette.name;
      btn.appendChild(swatches);
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        appState.auraConfig.palette = palette.id;
        root.querySelectorAll(".choice-card").forEach((card) => {
          card.classList.toggle("is-selected", card.dataset.id === palette.id);
        });
      });
      root.appendChild(btn);
    });
  }

  function renderGlowCards() {
    const root = document.getElementById("glow-list");
    root.className = "glow-grid";
    root.innerHTML = "";
    window.AURA_GLOWS.forEach((glow) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-card glow-card";
      btn.dataset.id = glow.id;
      btn.disabled = !glow.available;
      if (glow.id === appState.auraConfig.glow) btn.classList.add("is-selected");
      const preview = document.createElement("span");
      preview.className = `glow-preview glow-preview--${glow.id}`;
      const core = document.createElement("span");
      core.className = "core";
      preview.appendChild(core);
      let extra = 0;
      if (glow.id === "spark") extra = 6;
      else if (glow.id === "ember" || glow.id === "burst") extra = 5;
      for (let i = 0; i < extra; i += 1) {
        const dot = document.createElement("span");
        dot.className = "dot";
        preview.appendChild(dot);
      }
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = glow.name;
      btn.appendChild(preview);
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        if (!glow.available) return;
        appState.auraConfig.glow = glow.id;
        root.querySelectorAll(".choice-card").forEach((card) => {
          card.classList.toggle("is-selected", card.dataset.id === glow.id);
        });
      });
      root.appendChild(btn);
    });
  }

  function showResult() {
    const rec = window.AURA_RECORD.getState();
    resultVideo.removeAttribute("src");
    if (rec.url) {
      resultVideo.src = rec.url;
      resultVideo.classList.remove("is-empty");
      downloadLink.hidden = false;
      downloadLink.href = rec.url;
      downloadLink.download = window.AURA_RECORD.fileName();
    } else {
      resultVideo.classList.add("is-empty");
      downloadLink.hidden = true;
    }
    go("result");
  }

  document.getElementById("btn-enter").addEventListener("click", (event) => {
    event.stopPropagation();
    afterIntro();
  });

  document.getElementById("btn-accept").addEventListener("click", () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    go("configure");
  });

  document.getElementById("btn-refuse").addEventListener("click", () => {
    localStorage.setItem(CONSENT_KEY, "refused");
    go("configure");
  });

  document.getElementById("btn-create").addEventListener("click", enterCreate);

  btnBackConfig.addEventListener("click", (event) => {
    event.stopPropagation();
    window.AURA_RECORD.cleanup();
    window.AURA_ENGINE.resetMatter();
    window.AURA_ENGINE.setInteractive(false);
    go("configure");
  });

  btnPlay.addEventListener("click", (event) => {
    event.stopPropagation();
    const status = window.AURA_RECORD.getState().status;
    try {
      if (status === "paused") window.AURA_RECORD.resume();
      else window.AURA_RECORD.start();
    } catch (err) {
      appState.recording.status = "idle";
    }
    syncRecordButtons();
  });

  btnPause.addEventListener("click", (event) => {
    event.stopPropagation();
    window.AURA_RECORD.pause();
    syncRecordButtons();
  });

  btnStop.addEventListener("click", async (event) => {
    event.stopPropagation();
    window.AURA_ENGINE.setInteractive(false);
    createBar.hidden = true;
    btnBackConfig.hidden = true;
    go("processing");
    try {
      await window.AURA_RECORD.stop();
    } catch (err) {
      /* continue to result even if capture failed */
    }
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    await window.AURA_RECORD.showInterstitialAd();
    showResult();
  });

  document.getElementById("btn-new-aura").addEventListener("click", () => {
    window.AURA_RECORD.cleanup();
    window.AURA_ENGINE.resetMatter();
    window.AURA_ENGINE.setInteractive(false);
    resultVideo.removeAttribute("src");
    go("configure");
  });

  renderPaletteCards();
  renderGlowCards();
  tryLockPortrait();
  updateViewportMode();
  go("intro");
  window.addEventListener("resize", updateViewportMode);
  window.addEventListener("orientationchange", () => {
    tryLockPortrait();
    updateViewportMode();
  });
})();
