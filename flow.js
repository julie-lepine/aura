(() => {
  "use strict";

  const CONSENT_KEY = "aura-consent";
  const APP_SCREENS = {
    HOME: "intro",
    CONSENT: "consent",
    CONFIG: "configure",
    CREATE: "create",
    PROCESSING: "processing",
    RESULT: "result",
  };

  const gateDesktop = document.getElementById("gate-desktop");
  const gateRotate = document.getElementById("gate-rotate");

  const appState = {
    screen: APP_SCREENS.HOME,
    auraConfig: {
      palette: "default",
      glow: "soft",
    },
    creation: {
      name: "",
      palette: "default",
      glow: "soft",
    },
    recording: {
      status: "idle",
    },
    busy: false,
    historyLock: false,
  };

  const screens = document.querySelectorAll(".screen[data-screen]");
  const createBar = document.getElementById("create-controls");
  const btnBackConfig = document.getElementById("btn-back-config");
  const btnPlay = document.getElementById("btn-play");
  const btnPause = document.getElementById("btn-pause");
  const btnStop = document.getElementById("btn-stop");
  const resultVideo = document.getElementById("result-video");
  const downloadLink = document.getElementById("btn-download");
  const resultName = document.getElementById("result-name");
  const resultMeta = document.getElementById("result-meta");

  function paletteById(id) {
    return window.AURA_PALETTES.find((item) => item.id === id) || window.AURA_PALETTES[0];
  }

  function glowById(id) {
    return window.AURA_GLOWS.find((item) => item.id === id) || window.AURA_GLOWS[0];
  }

  function pickAuraName(paletteId, glowId) {
    const names = window.AURA_NAMES || ["Afterglow"];
    const seed = `${paletteId}|${glowId}|${Date.now()}`;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return names[Math.abs(hash) % names.length];
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

  function recordStatus() {
    return window.AURA_RECORD ? window.AURA_RECORD.getState().status : "idle";
  }

  function isRecordingLive() {
    const status = recordStatus();
    return status === "recording" || status === "paused";
  }

  function pauseResultVideo() {
    resultVideo.pause();
    resultVideo.removeAttribute("src");
    resultVideo.load();
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
      window.AURA_ENGINE.setInteractive(appState.screen === APP_SCREENS.CREATE);
    }
  }

  function syncRecordButtons() {
    const status = recordStatus();
    appState.recording.status = status;
    const idle = status === "idle" || status === "ready";
    const recording = status === "recording";
    const paused = status === "paused";
    btnPlay.hidden = !(idle || paused);
    btnPause.hidden = !recording;
    btnStop.hidden = !(recording || paused);
  }

  function go(screen, options) {
    const from = appState.screen;
    const silent = options && options.silent;
    if (from === screen && !(options && options.force)) return;

    if (from === APP_SCREENS.RESULT && screen !== APP_SCREENS.RESULT) {
      pauseResultVideo();
    }

    if (
      from === APP_SCREENS.CREATE &&
      screen !== APP_SCREENS.CREATE &&
      screen !== APP_SCREENS.PROCESSING
    ) {
      if (window.AURA_RECORD) window.AURA_RECORD.cleanup();
      if (window.AURA_ENGINE) window.AURA_ENGINE.resetMatter();
    }

    appState.screen = screen;
    document.body.dataset.screen = screen;
    screens.forEach((el) => {
      el.classList.toggle("is-on", el.dataset.screen === screen);
    });

    const creating = screen === APP_SCREENS.CREATE;
    document.body.classList.toggle("is-create", creating);
    createBar.hidden = !creating;
    btnBackConfig.hidden = !creating;

    if (window.AURA_ENGINE) window.AURA_ENGINE.setInteractive(creating);
    if (creating) syncRecordButtons();
    updateViewportMode();

    const historyMode = (options && options.history) || "auto";
    let mode = historyMode;
    if (historyMode === "auto") {
      if (
        silent ||
        screen === APP_SCREENS.HOME ||
        screen === APP_SCREENS.CONSENT ||
        screen === APP_SCREENS.PROCESSING
      ) {
        mode = "none";
      } else if (screen === APP_SCREENS.RESULT) {
        mode = "replace";
      } else {
        mode = "push";
      }
    }
    if (mode === "push" || mode === "replace") {
      appState.historyLock = true;
      if (mode === "replace") history.replaceState({ screen }, "", "#");
      else history.pushState({ screen }, "", "#");
      window.setTimeout(() => {
        appState.historyLock = false;
      }, 0);
    }
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
    if (consent === "accepted" || consent === "refused") go(APP_SCREENS.CONFIG);
    else go(APP_SCREENS.CONSENT);
  }

  function enterCreate() {
    if (appState.busy) return;
    applyConfigToEngine();
    window.AURA_RECORD.cleanup();
    go(APP_SCREENS.CREATE);
  }

  function leaveCreateToConfig() {
    if (appState.busy) return;
    window.AURA_RECORD.cleanup();
    window.AURA_ENGINE.resetMatter();
    window.AURA_ENGINE.setInteractive(false);
    go(APP_SCREENS.CONFIG, { history: "replace" });
  }

  function leaveResultToConfig() {
    pauseResultVideo();
    window.AURA_RECORD.cleanup();
    window.AURA_ENGINE.resetMatter();
    window.AURA_ENGINE.setInteractive(false);
    go(APP_SCREENS.CONFIG, { history: "replace" });
  }

  function replayResult() {
    if (!resultVideo.src) return;
    resultVideo.currentTime = 0;
    const play = resultVideo.play();
    if (play && typeof play.catch === "function") play.catch(() => {});
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
    const palette = paletteById(appState.auraConfig.palette);
    const glow = glowById(appState.auraConfig.glow);
    appState.creation = {
      name: pickAuraName(palette.id, glow.id),
      palette: palette.id,
      glow: glow.id,
    };

    pauseResultVideo();
    resultName.textContent = appState.creation.name;
    resultMeta.textContent = `${palette.name} · ${glow.name}`;

    if (rec.url) {
      resultVideo.src = rec.url;
      resultVideo.classList.remove("is-empty");
      downloadLink.hidden = false;
      downloadLink.href = rec.url;
      downloadLink.download = window.AURA_RECORD.fileName(appState.creation.name);
      const play = resultVideo.play();
      if (play && typeof play.catch === "function") play.catch(() => {});
    } else {
      resultVideo.classList.add("is-empty");
      downloadLink.hidden = true;
      resultName.textContent = "";
      resultMeta.textContent = "";
    }

    go(APP_SCREENS.RESULT);
    appState.busy = false;
  }

  function handlePopState() {
    if (appState.historyLock) return;
    const screen = appState.screen;

    if (screen === APP_SCREENS.PROCESSING || appState.busy) {
      appState.historyLock = true;
      history.pushState({ screen: APP_SCREENS.PROCESSING }, "", "#");
      window.setTimeout(() => {
        appState.historyLock = false;
      }, 0);
      return;
    }

    if (screen === APP_SCREENS.CREATE) {
      if (isRecordingLive()) {
        appState.historyLock = true;
        history.pushState({ screen: APP_SCREENS.CREATE }, "", "#");
        window.setTimeout(() => {
          appState.historyLock = false;
        }, 0);
        return;
      }
      window.AURA_RECORD.cleanup();
      window.AURA_ENGINE.resetMatter();
      window.AURA_ENGINE.setInteractive(false);
      go(APP_SCREENS.CONFIG, { history: "none" });
      return;
    }

    if (screen === APP_SCREENS.RESULT) {
      pauseResultVideo();
      window.AURA_RECORD.cleanup();
      window.AURA_ENGINE.resetMatter();
      window.AURA_ENGINE.setInteractive(false);
      go(APP_SCREENS.CONFIG, { history: "none" });
      return;
    }

    if (screen === APP_SCREENS.CONFIG || screen === APP_SCREENS.CONSENT) {
      go(APP_SCREENS.HOME, { history: "none" });
    }
  }

  document.getElementById("btn-enter").addEventListener("click", (event) => {
    event.stopPropagation();
    afterIntro();
  });

  document.getElementById("btn-accept").addEventListener("click", () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    go(APP_SCREENS.CONFIG);
  });

  document.getElementById("btn-refuse").addEventListener("click", () => {
    localStorage.setItem(CONSENT_KEY, "refused");
    go(APP_SCREENS.CONFIG);
  });

  document.getElementById("btn-create").addEventListener("click", enterCreate);

  btnBackConfig.addEventListener("click", (event) => {
    event.stopPropagation();
    leaveCreateToConfig();
  });

  btnPlay.addEventListener("click", (event) => {
    event.stopPropagation();
    if (appState.busy || appState.screen !== APP_SCREENS.CREATE) return;
    const status = recordStatus();
    if (status === "recording" || status === "processing") return;
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
    if (appState.busy || appState.screen !== APP_SCREENS.CREATE) return;
    window.AURA_RECORD.pause();
    syncRecordButtons();
  });

  btnStop.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (appState.busy || appState.screen !== APP_SCREENS.CREATE) return;
    if (!isRecordingLive()) return;
    appState.busy = true;
    window.AURA_ENGINE.setInteractive(false);
    createBar.hidden = true;
    btnBackConfig.hidden = true;
    go(APP_SCREENS.PROCESSING);
    try {
      await window.AURA_RECORD.stop();
    } catch (err) {
      /* continue to result even if capture failed */
    }
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    await window.AURA_RECORD.showInterstitialAd();
    showResult();
  });

  document.getElementById("btn-replay").addEventListener("click", (event) => {
    event.stopPropagation();
    replayResult();
  });

  resultVideo.addEventListener("click", replayResult);

  document.getElementById("btn-new-aura").addEventListener("click", () => {
    if (appState.busy) return;
    leaveResultToConfig();
  });

  renderPaletteCards();
  renderGlowCards();
  tryLockPortrait();
  updateViewportMode();
  history.replaceState({ screen: APP_SCREENS.HOME }, "", "#");
  go(APP_SCREENS.HOME, { silent: true });
  window.addEventListener("popstate", handlePopState);
  window.addEventListener("resize", updateViewportMode);
  window.addEventListener("orientationchange", () => {
    tryLockPortrait();
    updateViewportMode();
  });
})();
