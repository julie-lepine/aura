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
      mood: "flow",
    },
    creation: {
      name: "",
      palette: "default",
      glow: "soft",
      mood: "flow",
      durationMs: 0,
      selectedSignatureFrame: null,
    },
    recording: {
      status: "idle",
    },
    busy: false,
    historyLock: false,
    lastName: "",
  };

  const screens = document.querySelectorAll(".screen[data-screen]");
  const createBar = document.getElementById("create-controls");
  const btnBackConfig = document.getElementById("btn-back-config");
  const btnPlay = document.getElementById("btn-play");
  const btnPause = document.getElementById("btn-pause");
  const btnStop = document.getElementById("btn-stop");
  const recordTimer = document.getElementById("record-timer");
  const pauseEdit = document.getElementById("pause-edit");
  const pauseGlowList = document.getElementById("pause-glow-list");
  const pausePaletteList = document.getElementById("pause-palette-list");
  const pauseGlowCurrent = document.getElementById("pause-glow-current");
  const pausePaletteCurrent = document.getElementById("pause-palette-current");
  const btnEditGlow = document.getElementById("btn-edit-glow");
  const btnEditPalette = document.getElementById("btn-edit-palette");
  const resultFrame = document.getElementById("result-frame");
  const resultVideo = document.getElementById("result-video");
  const resultStill = document.getElementById("result-still");
  const downloadLink = document.getElementById("btn-download");
  const btnDownloadImage = document.getElementById("btn-download-image");
  const btnDownloadMoments = document.getElementById("btn-download-moments");
  const resultMoments = document.getElementById("result-moments");
  const resultMomentsList = document.getElementById("result-moments-list");
  const resultName = document.getElementById("result-name");
  const resultMeta = document.getElementById("result-meta");
  const resultMetaSub = document.getElementById("result-meta-sub");
  const previewCanvas = document.getElementById("aura-preview");

  let timerRaf = 0;

  function paletteById(id) {
    return window.AURA_PALETTES.find((item) => item.id === id) || window.AURA_PALETTES[0];
  }

  function glowById(id) {
    return window.AURA_GLOWS.find((item) => item.id === id) || window.AURA_GLOWS[0];
  }

  function moodById(id) {
    return window.AURA_MOODS.find((item) => item.id === id) || window.AURA_MOODS[1];
  }

  function pickAuraName(paletteId, glowId, moodId) {
    const names = window.AURA_NAMES || ["Afterglow"];
    const seed = `${paletteId}|${glowId}|${moodId}|${Date.now()}`;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    let index = Math.abs(hash) % names.length;
    if (names[index] === appState.lastName && names.length > 1) {
      index = (index + 1) % names.length;
    }
    appState.lastName = names[index];
    return names[index];
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  function durationLabel(ms) {
    const sec = Math.max(1, Math.round(ms / 1000));
    return `${sec} sec`;
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

  function closePauseEdit() {
    pauseGlowList.hidden = true;
    pausePaletteList.hidden = true;
    pauseEdit.hidden = true;
  }

  function syncPauseGlowSelection() {
    const id = appState.auraConfig.glow;
    const glow = glowById(id);
    if (pauseGlowCurrent) pauseGlowCurrent.textContent = glow.name;
    pauseGlowList.querySelectorAll(".pause-edit-card").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.id === id);
    });
  }

  function syncPausePaletteSelection() {
    const id = appState.auraConfig.palette;
    const palette = paletteById(id);
    if (pausePaletteCurrent) pausePaletteCurrent.textContent = palette.name;
    pausePaletteList.querySelectorAll(".pause-edit-card").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.id === id);
    });
  }

  function syncPauseEditSelection() {
    syncPauseGlowSelection();
    syncPausePaletteSelection();
  }

  function applyGlowLive(id) {
    if (!id) return;
    appState.auraConfig.glow = id;
    if (window.AURA_ENGINE) window.AURA_ENGINE.setGlow(id);
    syncPauseGlowSelection();
    document.querySelectorAll("#glow-list .choice-card").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.id === id);
    });
  }

  function applyPaletteLive(id) {
    const palette = paletteById(id);
    if (!palette) return;
    appState.auraConfig.palette = palette.id;
    if (window.AURA_ENGINE) window.AURA_ENGINE.setPalette(palette.colors);
    syncPausePaletteSelection();
    document.querySelectorAll("#palette-list .choice-card").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.id === palette.id);
    });
  }

  function togglePauseList(list) {
    const opening = list.hidden;
    pauseGlowList.hidden = true;
    pausePaletteList.hidden = true;
    if (opening) {
      list.hidden = false;
      syncPauseEditSelection();
    }
  }

  function isRecordingLive() {
    const status = recordStatus();
    return status === "recording" || status === "paused";
  }

  function resetSignature() {
    if (window.AURA_SIGNATURE) window.AURA_SIGNATURE.reset();
    appState.creation.selectedSignatureFrame = null;
    hideResultStill();
    if (resultMomentsList) resultMomentsList.innerHTML = "";
    if (resultMoments) resultMoments.hidden = true;
  }

  function hideResultStill() {
    if (!resultStill || !resultFrame) return;
    resultStill.hidden = true;
    resultStill.removeAttribute("src");
    resultFrame.classList.remove("is-still");
  }

  function showResultStill(url) {
    if (!resultStill || !resultFrame || !url) return;
    resultStill.src = url;
    resultStill.hidden = false;
    resultFrame.classList.add("is-still");
    resultVideo.pause();
  }

  function syncMomentSelection(selected) {
    const selectedId = selected ? String(selected.id) : "";
    resultMomentsList.querySelectorAll('input[name="aura-moment"]').forEach((input) => {
      input.checked = input.value === selectedId;
    });
    btnDownloadImage.hidden = !(selected && selected.url);
  }

  function applyMomentSelection(id) {
    if (!window.AURA_SIGNATURE || !id) return;
    const sid = String(id);
    window.AURA_SIGNATURE.select(sid);
    const state = window.AURA_SIGNATURE.getState();
    const selected =
      ((state.topSignatureMoments || []).find((item) => String(item.id) === sid)) ||
      state.selectedSignatureFrame;
    appState.creation.selectedSignatureFrame = selected;
    resultMomentsList.querySelectorAll('input[name="aura-moment"]').forEach((input) => {
      input.checked = input.value === sid;
    });
    btnDownloadImage.hidden = !(selected && selected.url);
    if (selected && selected.url) showResultStill(selected.url);
  }

  function renderResultMoments() {
    const state = window.AURA_SIGNATURE ? window.AURA_SIGNATURE.getState() : null;
    const moments = (state && state.topSignatureMoments) || [];
    const selected = state && state.selectedSignatureFrame;
    resultMomentsList.innerHTML = "";
    resultMoments.hidden = moments.length === 0;
    hideResultStill();
    moments.forEach((moment) => {
      const label = document.createElement("label");
      label.className = "signature-moment";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "aura-moment";
      input.value = String(moment.id);
      input.checked = !!(selected && String(selected.id) === String(moment.id));
      const card = document.createElement("span");
      card.className = "signature-moment-card";
      const img = document.createElement("img");
      img.src = moment.url;
      img.alt = "";
      img.draggable = false;
      const stamp = document.createElement("span");
      stamp.className = "signature-moment-time";
      stamp.textContent = `${String(Math.max(0, Math.round(moment.t / 1000))).padStart(2, "0")}s`;
      card.appendChild(img);
      card.appendChild(stamp);
      label.appendChild(input);
      label.appendChild(card);
      resultMomentsList.appendChild(label);
    });
    syncMomentSelection(selected);
    btnDownloadMoments.hidden = moments.length < 2;
    btnDownloadMoments.textContent = moments.length === 2 ? "Télécharger les 2" : "Télécharger les 3";
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function pauseResultVideo() {
    hideResultStill();
    resultVideo.pause();
    resultVideo.removeAttribute("src");
    resultVideo.load();
  }

  function syncPreview() {
    if (!window.AURA_PREVIEW) return;
    const palette = paletteById(appState.auraConfig.palette);
    window.AURA_PREVIEW.setPalette(palette.colors);
    window.AURA_PREVIEW.setGlow(appState.auraConfig.glow);
    window.AURA_PREVIEW.setMood(appState.auraConfig.mood);
  }

  function startPreview() {
    if (!window.AURA_PREVIEW || !previewCanvas) return;
    syncPreview();
    window.AURA_PREVIEW.start(previewCanvas);
  }

  function stopPreview() {
    if (window.AURA_PREVIEW) window.AURA_PREVIEW.stop();
  }

  function stopTimerLoop() {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    timerRaf = 0;
  }

  function updateTimerDisplay() {
    if (!window.AURA_RECORD) return;
    recordTimer.textContent = formatDuration(window.AURA_RECORD.getElapsedMs());
  }

  function tickTimer() {
    if (recordStatus() !== "recording") {
      timerRaf = 0;
      return;
    }
    const elapsed = window.AURA_RECORD.getElapsedMs();
    recordTimer.textContent = formatDuration(elapsed);
    const maxMs = (window.AURA_RECORD.RECORDING_MAX_DURATION || 30) * 1000;
    if (elapsed >= maxMs) {
      finishRecording();
      return;
    }
    timerRaf = requestAnimationFrame(tickTimer);
  }

  function showTimer(visible) {
    recordTimer.hidden = !visible;
    document.body.classList.toggle("is-recording", visible);
    if (visible) updateTimerDisplay();
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
    showTimer(recording || paused);
    if (recording) {
      stopTimerLoop();
      timerRaf = requestAnimationFrame(tickTimer);
    } else {
      stopTimerLoop();
      if (paused) updateTimerDisplay();
    }

    pauseEdit.hidden = !paused;
    if (!paused) {
      pauseGlowList.hidden = true;
      pausePaletteList.hidden = true;
    } else {
      syncPauseEditSelection();
    }
  }

  function go(screen, options) {
    const from = appState.screen;
    const silent = options && options.silent;
    if (from === screen && !(options && options.force)) return;

    if (from === APP_SCREENS.CONFIG && screen !== APP_SCREENS.CONFIG) {
      stopPreview();
    }

    if (from === APP_SCREENS.RESULT && screen !== APP_SCREENS.RESULT) {
      pauseResultVideo();
    }

    if (
      from === APP_SCREENS.CREATE &&
      screen !== APP_SCREENS.CREATE &&
      screen !== APP_SCREENS.PROCESSING
    ) {
      stopTimerLoop();
      showTimer(false);
      if (window.AURA_RECORD) window.AURA_RECORD.cleanup();
      if (window.AURA_SIGNATURE) window.AURA_SIGNATURE.reset();
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
    if (!creating) closePauseEdit();

    if (window.AURA_ENGINE) window.AURA_ENGINE.setInteractive(creating);
    if (creating) syncRecordButtons();
    else showTimer(false);
    updateViewportMode();

    if (screen === APP_SCREENS.CONFIG) {
      window.requestAnimationFrame(() => startPreview());
    }

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
    window.AURA_ENGINE.setMood(appState.auraConfig.mood);
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
    resetSignature();
    go(APP_SCREENS.CREATE);
  }

  function leaveCreateToConfig() {
    if (appState.busy) return;
    window.AURA_RECORD.cleanup();
    resetSignature();
    window.AURA_ENGINE.resetMatter();
    window.AURA_ENGINE.setInteractive(false);
    go(APP_SCREENS.CONFIG, { history: "replace" });
  }

  function leaveResultToConfig() {
    pauseResultVideo();
    window.AURA_RECORD.cleanup();
    resetSignature();
    window.AURA_ENGINE.resetMatter();
    window.AURA_ENGINE.setInteractive(false);
    go(APP_SCREENS.CONFIG, { history: "replace" });
  }

  function replayResult() {
    hideResultStill();
    if (!resultVideo.src) return;
    resultVideo.currentTime = 0;
    const play = resultVideo.play();
    if (play && typeof play.catch === "function") play.catch(() => {});
  }

  function appendSwatches(parent, colors) {
    const swatches = document.createElement("span");
    swatches.className = "swatches";
    colors.forEach((rgb) => {
      const dot = document.createElement("i");
      dot.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      swatches.appendChild(dot);
    });
    parent.appendChild(swatches);
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
      appendSwatches(btn, palette.colors);
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = palette.name;
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        appState.auraConfig.palette = palette.id;
        root.querySelectorAll(".choice-card").forEach((card) => {
          card.classList.toggle("is-selected", card.dataset.id === palette.id);
        });
        syncPausePaletteSelection();
        syncPreview();
      });
      root.appendChild(btn);
    });
  }

  function appendGlowPreview(parent, glowId) {
    const preview = document.createElement("span");
    preview.className = `glow-preview glow-preview--${glowId}`;
    const core = document.createElement("span");
    core.className = "core";
    preview.appendChild(core);
    let extra = 0;
    let extraClass = "dot";
    if (glowId === "spark") extra = 6;
    else if (glowId === "ember" || glowId === "burst") extra = 5;
    else if (glowId === "hearts") {
      extra = 7;
      extraClass = "heart";
    }
    for (let i = 0; i < extra; i += 1) {
      const dot = document.createElement("span");
      dot.className = extraClass;
      preview.appendChild(dot);
    }
    parent.appendChild(preview);
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
      appendGlowPreview(btn, glow.id);
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = glow.name;
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        if (!glow.available) return;
        appState.auraConfig.glow = glow.id;
        root.querySelectorAll(".choice-card").forEach((card) => {
          card.classList.toggle("is-selected", card.dataset.id === glow.id);
        });
        syncPauseGlowSelection();
        syncPreview();
      });
      root.appendChild(btn);
    });
  }

  function renderPauseGlowCards() {
    pauseGlowList.innerHTML = "";
    window.AURA_GLOWS.forEach((glow) => {
      if (!glow.available) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pause-edit-card";
      btn.dataset.id = glow.id;
      if (glow.id === appState.auraConfig.glow) btn.classList.add("is-selected");
      appendGlowPreview(btn, glow.id);
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = glow.name;
      btn.appendChild(label);
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        applyGlowLive(glow.id);
      });
      pauseGlowList.appendChild(btn);
    });
    syncPauseEditSelection();
  }

  function renderPausePaletteCards() {
    pausePaletteList.innerHTML = "";
    window.AURA_PALETTES.forEach((palette) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pause-edit-card";
      btn.dataset.id = palette.id;
      if (palette.id === appState.auraConfig.palette) btn.classList.add("is-selected");
      appendSwatches(btn, palette.colors);
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = palette.name;
      btn.appendChild(label);
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        applyPaletteLive(palette.id);
      });
      pausePaletteList.appendChild(btn);
    });
    syncPausePaletteSelection();
  }

  function renderMoodCards() {
    const root = document.getElementById("mood-list");
    root.innerHTML = "";
    window.AURA_MOODS.forEach((mood) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mood-card";
      btn.dataset.id = mood.id;
      if (mood.id === appState.auraConfig.mood) btn.classList.add("is-selected");
      const label = document.createElement("span");
      label.className = "choice-label";
      label.textContent = mood.name;
      const lede = document.createElement("span");
      lede.className = "mood-lede";
      lede.textContent = mood.lede;
      btn.appendChild(label);
      btn.appendChild(lede);
      btn.addEventListener("click", () => {
        appState.auraConfig.mood = mood.id;
        root.querySelectorAll(".mood-card").forEach((card) => {
          card.classList.toggle("is-selected", card.dataset.id === mood.id);
        });
        syncPreview();
      });
      root.appendChild(btn);
    });
  }

  function showResult() {
    const rec = window.AURA_RECORD.getState();
    const sig = window.AURA_SIGNATURE
      ? window.AURA_SIGNATURE.getState()
      : { selectedSignatureFrame: null, topSignatureMoments: [] };
    const palette = paletteById(appState.auraConfig.palette);
    const glow = glowById(appState.auraConfig.glow);
    const mood = moodById(appState.auraConfig.mood);
    const durationMs = window.AURA_RECORD.getElapsedMs();
    appState.creation = {
      name: pickAuraName(palette.id, glow.id, mood.id),
      palette: palette.id,
      glow: glow.id,
      mood: mood.id,
      durationMs,
      selectedSignatureFrame: sig.selectedSignatureFrame,
    };

    resultName.textContent = appState.creation.name;
    resultMeta.textContent = `${glow.name} · ${palette.name} · ${mood.name}`;
    resultMetaSub.textContent = formatDuration(durationMs);
    renderResultMoments();

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
      if (!sig.selectedSignatureFrame) {
        resultName.textContent = "";
        resultMeta.textContent = "";
        resultMetaSub.textContent = "";
      }
    }

    go(APP_SCREENS.RESULT);
    appState.busy = false;
  }

  async function finishRecording() {
    if (appState.busy || appState.screen !== APP_SCREENS.CREATE) return;
    if (!isRecordingLive()) return;
    appState.busy = true;
    stopTimerLoop();
    showTimer(false);
    closePauseEdit();
    if (window.AURA_SIGNATURE) {
      window.AURA_SIGNATURE.pause();
      window.AURA_SIGNATURE.captureNow(true);
    }
    window.AURA_ENGINE.setInteractive(false);
    createBar.hidden = true;
    btnBackConfig.hidden = true;
    go(APP_SCREENS.PROCESSING);
    try {
      await window.AURA_RECORD.stop();
    } catch (err) {
      /* continue to result even if capture failed */
    }
    if (window.AURA_SIGNATURE) {
      try {
        await window.AURA_SIGNATURE.finalize();
      } catch (err) {
        /* keep result flow even if scoring failed */
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    await window.AURA_RECORD.showInterstitialAd();
    showResult();
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
      resetSignature();
      window.AURA_ENGINE.resetMatter();
      window.AURA_ENGINE.setInteractive(false);
      go(APP_SCREENS.CONFIG, { history: "none" });
      return;
    }

    if (screen === APP_SCREENS.RESULT) {
      pauseResultVideo();
      window.AURA_RECORD.cleanup();
      resetSignature();
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
      if (status === "paused") {
        window.AURA_RECORD.resume();
        if (window.AURA_SIGNATURE) window.AURA_SIGNATURE.resume();
      } else {
        window.AURA_RECORD.start();
        if (window.AURA_SIGNATURE) window.AURA_SIGNATURE.start();
      }
    } catch (err) {
      appState.recording.status = "idle";
    }
    syncRecordButtons();
  });

  btnPause.addEventListener("click", (event) => {
    event.stopPropagation();
    if (appState.busy || appState.screen !== APP_SCREENS.CREATE) return;
    window.AURA_RECORD.pause();
    if (window.AURA_SIGNATURE) window.AURA_SIGNATURE.pause();
    syncRecordButtons();
  });

  btnEditGlow.addEventListener("click", (event) => {
    event.stopPropagation();
    if (appState.busy || appState.screen !== APP_SCREENS.CREATE) return;
    if (recordStatus() !== "paused") return;
    togglePauseList(pauseGlowList);
  });

  btnEditPalette.addEventListener("click", (event) => {
    event.stopPropagation();
    if (appState.busy || appState.screen !== APP_SCREENS.CREATE) return;
    if (recordStatus() !== "paused") return;
    togglePauseList(pausePaletteList);
  });

  btnStop.addEventListener("click", (event) => {
    event.stopPropagation();
    finishRecording();
  });

  resultVideo.addEventListener("click", replayResult);

  resultMomentsList.addEventListener("change", (event) => {
    const input = event.target;
    if (!input || input.name !== "aura-moment") return;
    applyMomentSelection(input.value);
  });
  resultMomentsList.addEventListener("click", (event) => {
    const label = event.target.closest(".signature-moment");
    if (!label || !resultMomentsList.contains(label)) return;
    const input = label.querySelector('input[name="aura-moment"]');
    if (!input) return;
    input.checked = true;
    applyMomentSelection(input.value);
  });

  btnDownloadImage.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!window.AURA_SIGNATURE) return;
    try {
      const blob = await window.AURA_SIGNATURE.exportPngBlob();
      if (!blob) return;
      triggerDownload(blob, window.AURA_SIGNATURE.imageFileName(appState.creation.name));
    } catch (err) {
      /* keep the result usable */
    }
  });

  btnDownloadMoments.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!window.AURA_SIGNATURE) return;
    try {
      const files = await window.AURA_SIGNATURE.exportAllPngBlobs();
      for (let i = 0; i < files.length; i += 1) {
        triggerDownload(
          files[i].blob,
          window.AURA_SIGNATURE.imageFileName(appState.creation.name, files[i].index)
        );
        await new Promise((resolve) => window.setTimeout(resolve, 280));
      }
    } catch (err) {
      /* keep the result usable */
    }
  });

  document.getElementById("btn-new-aura").addEventListener("click", () => {
    if (appState.busy) return;
    leaveResultToConfig();
  });

  renderPaletteCards();
  renderGlowCards();
  renderPauseGlowCards();
  renderPausePaletteCards();
  renderMoodCards();
  tryLockPortrait();
  updateViewportMode();
  history.replaceState({ screen: APP_SCREENS.HOME }, "", "#");
  go(APP_SCREENS.HOME, { silent: true });
  window.addEventListener("popstate", handlePopState);
  window.addEventListener("resize", () => {
    updateViewportMode();
    if (appState.screen === APP_SCREENS.CONFIG && window.AURA_PREVIEW) {
      window.AURA_PREVIEW.resize();
    }
  });
  window.addEventListener("orientationchange", () => {
    tryLockPortrait();
    updateViewportMode();
  });
})();
