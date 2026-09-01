(() => {
  "use strict";

  const MAX_RECORDING_DURATION = 0;
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
    recorderState.status = "idle";
    recorderState.recorder = null;
    recorderState.chunks = [];
    recorderState.stream = null;
    recorderState.blob = null;
    recorderState.url = null;
  }

  function start() {
    const canvas = window.AURA_ENGINE && window.AURA_ENGINE.getCanvas();
    if (!canvas || typeof MediaRecorder === "undefined") {
      throw new Error("recording-unavailable");
    }
    if (recorderState.status === "recording") return recorderState;

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
    return recorderState;
  }

  function pause() {
    if (!recorderState.recorder || recorderState.recorder.state !== "recording") {
      return recorderState;
    }
    try {
      recorderState.recorder.pause();
      recorderState.status = "paused";
    } catch (err) {
      recorderState.status = "recording";
    }
    return recorderState;
  }

  function resume() {
    if (!recorderState.recorder || recorderState.recorder.state !== "paused") {
      return recorderState;
    }
    try {
      recorderState.recorder.resume();
      recorderState.status = "recording";
    } catch (err) {
      recorderState.status = recorderState.recorder.state || "recording";
    }
    return recorderState;
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
      rec.onstop = () => {
        const type = recorderState.mimeType || "video/webm";
        recorderState.blob = new Blob(recorderState.chunks, { type });
        recorderState.url = URL.createObjectURL(recorderState.blob);
        recorderState.status = "ready";
        recorderState.recorder = null;
        resolve(recorderState);
      };
      rec.onerror = () => {
        recorderState.status = "idle";
        reject(new Error("recording-failed"));
      };
      rec.stop();
    });
  }

  function fileName() {
    const day = new Date().toISOString().slice(0, 10);
    const ext = (recorderState.mimeType || "").indexOf("mp4") !== -1 ? "mp4" : "webm";
    return `aura-${day}.${ext}`;
  }

  async function showInterstitialAd() {
    return Promise.resolve();
  }

  window.AURA_RECORD = {
    MAX_RECORDING_DURATION,
    RECORD_QUALITY,
    start,
    pause,
    resume,
    stop,
    cleanup,
    showInterstitialAd,
    fileName,
    getState() {
      return recorderState;
    },
    getMimeType() {
      return recorderState.mimeType || pickMimeType();
    },
  };
})();
