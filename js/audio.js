(() => {
  "use strict";

  const STORAGE_KEY = "aura-sound-enabled";
  const TARGET_VOLUME = 0.42;
  const FADE_MS = 650;

  const TRACKS = {
    soft: {
      calm: "sons/1.doux/doux-calme.aac",
      flow: "sons/1.doux/doux-flot.aac",
      wild: "sons/1.doux/doux-vive.aac",
    },
    spark: {
      calm: "sons/2.etincelle/etincelle-calme.aac",
      flow: "sons/2.etincelle/etincelle-flot.aac",
      wild: "sons/2.etincelle/etincelle-vive.aac",
    },
    feu: {
      calm: "sons/3.fumee/fumee-calme.aac",
      flow: "sons/3.fumee/fumee-flot.aac",
      wild: "sons/3.fumee/fumee-vive.aac",
    },
    burst: {
      calm: "sons/4.eclat/eclat-calme.aac",
      flow: "sons/4.eclat/eclat-flot.aac",
      wild: "sons/4.eclat/eclat-vive.aac",
    },
    liquid: {
      calm: "sons/5.liquide/liquide-calme.aac",
      flow: "sons/5.liquide/liquide-flot.aac",
      wild: "sons/5.liquide/liquide-vive.aac",
    },
    hearts: {
      calm: "sons/6.coeurs/coeurs-calme.aac",
      flow: "sons/6.coeurs/coeurs-flot.aac",
      wild: "sons/6.coeurs/coeurs-vive.aac",
    },
  };

  let enabled = true;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "off";
  } catch (err) {
    /* localStorage can be unavailable in private contexts */
  }

  const players = [createPlayer(), createPlayer()];
  let activeIndex = 0;
  let fadeFrame = 0;
  let operationId = 0;

  function createPlayer() {
    const player = new Audio();
    player.loop = true;
    player.preload = "auto";
    player.setAttribute("playsinline", "");
    player._auraPath = "";
    return player;
  }

  function trackFor(glowId, moodId) {
    const glowTracks = TRACKS[glowId] || TRACKS.soft;
    return glowTracks[moodId] || glowTracks.flow;
  }

  function cancelFade() {
    if (fadeFrame) cancelAnimationFrame(fadeFrame);
    fadeFrame = 0;
  }

  function resetPlayer(player) {
    player.pause();
    player.volume = 0;
    player.removeAttribute("src");
    player.load();
    player._auraPath = "";
  }

  function fade(from, to, duration, operation, onComplete) {
    cancelFade();
    const startedAt = performance.now();
    const fromVolume = from ? from.volume : 0;
    const toVolume = to ? to.volume : 0;

    function step(now) {
      if (operation !== operationId) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      if (from) from.volume = fromVolume * (1 - progress);
      if (to) to.volume = toVolume + (TARGET_VOLUME - toVolume) * progress;
      if (progress < 1) {
        fadeFrame = requestAnimationFrame(step);
      } else {
        fadeFrame = 0;
        if (onComplete) onComplete();
      }
    }

    fadeFrame = requestAnimationFrame(step);
  }

  function startPlayer(player, path) {
    player._auraPath = path;
    player.src = path;
    player.currentTime = 0;
    player.volume = 0;
    return player.play();
  }

  function play(glowId, moodId) {
    if (!enabled) return Promise.resolve(false);

    const path = trackFor(glowId, moodId);
    const current = players[activeIndex];
    const operation = ++operationId;
    cancelFade();

    if (current._auraPath === path) {
      const playback = current.paused ? current.play() : Promise.resolve();
      return playback
        .then(() => {
          if (operation !== operationId) return false;
          fade(null, current, FADE_MS, operation);
          return true;
        })
        .catch(() => false);
    }

    const nextIndex = activeIndex === 0 ? 1 : 0;
    const next = players[nextIndex];
    resetPlayer(next);
    const playback = startPlayer(next, path);

    return playback
      .then(() => {
        if (operation !== operationId) {
          resetPlayer(next);
          return false;
        }
        fade(current._auraPath ? current : null, next, FADE_MS, operation, () => {
          resetPlayer(current);
          activeIndex = nextIndex;
        });
        return true;
      })
      .catch(() => {
        resetPlayer(next);
        return false;
      });
  }

  function pause() {
    operationId += 1;
    cancelFade();
    players.forEach((player) => player.pause());
  }

  function stop(options) {
    const immediate = options && options.immediate;
    const operation = ++operationId;
    cancelFade();

    if (immediate) {
      players.forEach(resetPlayer);
      return;
    }

    const playing = players.filter((player) => player._auraPath && !player.paused);
    if (!playing.length) {
      players.forEach(resetPlayer);
      return;
    }

    const startedAt = performance.now();
    const volumes = playing.map((player) => player.volume);
    function step(now) {
      if (operation !== operationId) return;
      const progress = Math.min(1, (now - startedAt) / 300);
      playing.forEach((player, index) => {
        player.volume = volumes[index] * (1 - progress);
      });
      if (progress < 1) {
        fadeFrame = requestAnimationFrame(step);
      } else {
        fadeFrame = 0;
        players.forEach(resetPlayer);
      }
    }
    fadeFrame = requestAnimationFrame(step);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch (err) {
      /* keep the preference for the current session */
    }
    if (!enabled) stop({ immediate: true });
    return enabled;
  }

  window.AURA_AUDIO = {
    play,
    pause,
    stop,
    setEnabled,
    isEnabled() {
      return enabled;
    },
  };
})();
