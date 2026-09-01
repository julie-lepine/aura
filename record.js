(() => {
  "use strict";

  const RECORDING_MAX_DURATION = 30;
  const RECORD_QUALITY = "standard";
  const RECORD_FPS = 30;

  const recorderState = {
    status: "idle",
    recorder: null,
    chunks: [],
    stream: null,
    blob: null,
    url: null,
    mimeType: "",
    elapsedMs: 0,
    runStartedAt: 0,
  };

  function pickMimeType() {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
      return "";
    }
    const candidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return "";
  }

  function cleanup() {
    if (recorderState.recorder && recorderState.recorder.state !== "inactive") {
      try {
        recorderState.recorder.stop();
      } catch (err) {
        /* ignore */
      }
    }
    if (recorderState.url) {
      URL.revokeObjectURL(recorderState.url);
    }
    if (recorderState.stream) {
      recorderState.stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (err) {
          /* ignore */
        }
      });
    }
    recorderState.status = "idle";
    recorderState.recorder = null;
    recorderState.chunks = [];
    recorderState.stream = null;
    recorderState.blob = null;
    recorderState.url = null;
    recorderState.elapsedMs = 0;
    recorderState.runStartedAt = 0;
  }

  function start() {
    const canvas = window.AURA_ENGINE && window.AURA_ENGINE.getCanvas();
    if (!canvas || typeof MediaRecorder === "undefined") {
      throw new Error("recording-unavailable");
    }
    if (recorderState.status === "recording" || recorderState.status === "processing" || recorderState.status === "paused") {
      return recorderState;
    }

    if (recorderState.url) URL.revokeObjectURL(recorderState.url);
    recorderState.blob = null;
    recorderState.url = null;
    recorderState.chunks = [];
    recorderState.mimeType = pickMimeType();

    recorderState.stream = canvas.captureStream(RECORD_FPS);
    const options = recorderState.mimeType
      ? { mimeType: recorderState.mimeType }
      : undefined;
    recorderState.recorder = new MediaRecorder(recorderState.stream, options);

    recorderState.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) recorderState.chunks.push(event.data);
    };

    recorderState.recorder.start(250);
    recorderState.status = "recording";
    recorderState.elapsedMs = 0;
    recorderState.runStartedAt = performance.now();
    return recorderState;
  }

  function pause() {
    if (!recorderState.recorder || recorderState.recorder.state !== "recording") {
      return recorderState;
    }
    try {
      recorderState.recorder.pause();
    } catch (err) {
      /* native pause may be unavailable */
    }
    recorderState.status =
      recorderState.recorder.state === "paused" ? "paused" : "recording";
    if (recorderState.status === "paused" && recorderState.runStartedAt) {
      recorderState.elapsedMs += performance.now() - recorderState.runStartedAt;
      recorderState.runStartedAt = 0;
    }
    return recorderState;
  }

  function resume() {
    if (!recorderState.recorder) return recorderState;
    if (recorderState.recorder.state === "recording") {
      recorderState.status = "recording";
      return recorderState;
    }
    if (recorderState.recorder.state !== "paused") return recorderState;
    try {
      recorderState.recorder.resume();
    } catch (err) {
      /* keep status from native state */
    }
    recorderState.status =
      recorderState.recorder.state === "recording" ? "recording" : "paused";
    if (recorderState.status === "recording") {
      recorderState.runStartedAt = performance.now();
    }
    return recorderState;
  }

  function freezeElapsed() {
    if (recorderState.runStartedAt) {
      recorderState.elapsedMs += performance.now() - recorderState.runStartedAt;
      recorderState.runStartedAt = 0;
    }
  }

  function getElapsedMs() {
    if (recorderState.status === "recording" && recorderState.runStartedAt) {
      return recorderState.elapsedMs + (performance.now() - recorderState.runStartedAt);
    }
    return recorderState.elapsedMs;
  }

  function stop() {
    return new Promise((resolve, reject) => {
      const rec = recorderState.recorder;
      if (!rec || rec.state === "inactive") {
        recorderState.status = recorderState.blob ? "ready" : "idle";
        resolve(recorderState);
        return;
      }

      recorderState.status = "processing";
      freezeElapsed();
      rec.onstop = () => {
        const type = recorderState.mimeType || "video/webm";
        recorderState.blob = new Blob(recorderState.chunks, { type });
        recorderState.url = URL.createObjectURL(recorderState.blob);
        recorderState.status = "ready";
        recorderState.recorder = null;
        if (recorderState.stream) {
          recorderState.stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch (err) {
              /* ignore */
            }
          });
          recorderState.stream = null;
        }
        resolve(recorderState);
      };
      rec.onerror = () => {
        recorderState.status = "idle";
        reject(new Error("recording-failed"));
      };
      rec.stop();
    });
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

  function fileName(title) {
    const ext = (recorderState.mimeType || "").indexOf("mp4") !== -1 ? "mp4" : "webm";
    return `aura-${slugify(title)}.${ext}`;
  }

  async function showInterstitialAd() {
    return Promise.resolve();
  }

  window.AURA_RECORD = {
    RECORDING_MAX_DURATION,
    MAX_RECORDING_DURATION: RECORDING_MAX_DURATION,
    RECORD_QUALITY,
    start,
    pause,
    resume,
    stop,
    cleanup,
    showInterstitialAd,
    fileName,
    getElapsedMs,
    getState() {
      return recorderState;
    },
    getMimeType() {
      return recorderState.mimeType || pickMimeType();
    },
  };
})();
