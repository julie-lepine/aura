(() => {
  "use strict";

  const TEST_INTERSTITIAL_ID = "ca-app-pub-3940256099942544/1033173712";
  const SHOW_TIMEOUT_MS = 12000;
  const PREPARE_WAIT_MS = 8000;
  const CONSENT_INFO_TIMEOUT_MS = 8000;
  const InterstitialAdPluginEvents = {
    Loaded: "interstitialAdLoaded",
    FailedToLoad: "interstitialAdFailedToLoad",
    Showed: "interstitialAdShowed",
    FailedToShow: "interstitialAdFailedToShow",
    Dismissed: "interstitialAdDismissed",
  };

  let admob = null;
  let initPromise = null;
  let initialized = false;
  let listenersBound = false;
  let interstitialReady = false;
  let preparePromise = null;
  let dismissWaiter = null;
  let consentChoice = "";

  function isNativeApp() {
    const cap = typeof window !== "undefined" ? window.Capacitor : undefined;
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) {
      return true;
    }
    const platform = cap && typeof cap.getPlatform === "function" ? cap.getPlatform() : "";
    return platform === "android" || platform === "ios";
  }

  function nativePlugin(name) {
    const cap = window.Capacitor;
    if (!cap) return null;
    const fromRegistry = cap.Plugins && cap.Plugins[name];
    if (fromRegistry) return fromRegistry;
    try {
      if (typeof cap.registerPlugin === "function") {
        return cap.registerPlugin(name);
      }
    } catch (err) {
      /* déjà enregistré */
    }
    return null;
  }

  function waitMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function applyChoice(choice) {
    consentChoice = choice === "accepted" || choice === "refused" ? choice : "";
  }

  function hasConsentChoice() {
    return consentChoice === "accepted" || consentChoice === "refused";
  }

  function useNonPersonalizedAds() {
    return consentChoice !== "accepted";
  }

  function bindListeners(plugin) {
    if (listenersBound || !plugin || typeof plugin.addListener !== "function") return;
    listenersBound = true;
    plugin.addListener(InterstitialAdPluginEvents.Loaded, () => {
      interstitialReady = true;
    });
    plugin.addListener(InterstitialAdPluginEvents.FailedToLoad, () => {
      interstitialReady = false;
    });
    plugin.addListener(InterstitialAdPluginEvents.Dismissed, () => {
      interstitialReady = false;
      if (dismissWaiter) dismissWaiter();
    });
    plugin.addListener(InterstitialAdPluginEvents.FailedToShow, () => {
      interstitialReady = false;
      if (dismissWaiter) dismissWaiter();
    });
  }

  async function ensureSdk() {
    if (!isNativeApp()) return false;
    if (initialized && admob) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        const plugin = nativePlugin("AdMob");
        if (!plugin) {
          initPromise = null;
          return false;
        }
        bindListeners(plugin);
        try {
          await plugin.initialize();
        } catch (err) {
          /* initialize() peut échouer sur le parent banner : le SDK reste utilisable */
        }
        admob = plugin;
        initialized = true;
        return true;
      } catch (err) {
        initialized = false;
        admob = null;
        initPromise = null;
        return false;
      }
    })();

    return initPromise;
  }

  async function ensureReady() {
    if (!hasConsentChoice()) return false;
    return ensureSdk();
  }

  async function requestConsentInfoSafe() {
    if (!admob || typeof admob.requestConsentInfo !== "function") return null;
    try {
      return await Promise.race([
        admob.requestConsentInfo(),
        waitMs(CONSENT_INFO_TIMEOUT_MS).then(() => null),
      ]);
    } catch (err) {
      return null;
    }
  }

  function formIsRequired(info) {
    const status = info && info.status ? String(info.status).toUpperCase() : "";
    return Boolean(info && info.isConsentFormAvailable && status === "REQUIRED");
  }

  async function showUmpForm() {
    if (!admob || typeof admob.showConsentForm !== "function") {
      return { adsAllowed: hasConsentChoice() };
    }
    const after = await admob.showConsentForm();
    return { adsAllowed: Boolean(after && after.canRequestAds), info: after };
  }

  async function syncUmpIfNeeded() {
    if (!hasConsentChoice() || !isNativeApp()) {
      return { adsAllowed: hasConsentChoice() };
    }
    if (!(await ensureSdk()) || !admob) return { adsAllowed: true };
    const info = await requestConsentInfoSafe();
    if (!info) return { adsAllowed: true };
    if (formIsRequired(info)) {
      try {
        await showUmpForm();
      } catch (err) {
        /* garder le choix in-app : refuser = pubs non personnalisées */
      }
    }
    return { adsAllowed: true };
  }

  async function resolveLaunchConsent() {
    if (!isNativeApp()) return { handled: false };
    if (!(await ensureSdk()) || !admob) return { handled: false };
    const info = await requestConsentInfoSafe();
    if (!formIsRequired(info)) return { handled: false };
    try {
      const result = await showUmpForm();
      return { handled: true, adsAllowed: result.adsAllowed };
    } catch (err) {
      return { handled: false };
    }
  }

  async function preloadInterstitial() {
    if (!(await ensureReady()) || !admob) return false;
    interstitialReady = false;
    preparePromise = admob
      .prepareInterstitial({
        adId: TEST_INTERSTITIAL_ID,
        isTesting: true,
        npa: useNonPersonalizedAds(),
      })
      .then(() => {
        interstitialReady = true;
        return true;
      })
      .catch(() => {
        interstitialReady = false;
        return false;
      });
    try {
      return await preparePromise;
    } catch (err) {
      interstitialReady = false;
      return false;
    }
  }

  async function showInterstitialAd() {
    if (!(await ensureReady()) || !admob) return;
    if (!interstitialReady) {
      await Promise.race([preloadInterstitial(), waitMs(PREPARE_WAIT_MS)]);
    } else if (preparePromise) {
      await Promise.race([preparePromise, waitMs(PREPARE_WAIT_MS)]);
    }
    if (!interstitialReady) return;

    await new Promise((resolve) => {
      let settled = false;
      let timer = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        dismissWaiter = null;
        window.clearTimeout(timer);
        resolve();
      };
      dismissWaiter = finish;
      timer = window.setTimeout(finish, SHOW_TIMEOUT_MS);
      admob.showInterstitial().catch(finish);
    });

    interstitialReady = false;
    preparePromise = null;
  }

  window.AURA_ADS = {
    applyChoice,
    resolveLaunchConsent,
    syncUmpIfNeeded,
    preloadInterstitial,
    showInterstitialAd,
  };

  ensureSdk();
})();
