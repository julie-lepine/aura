(() => {
  "use strict";

  const SUPPORTED = ["fr", "en", "es", "de"];
  const STORAGE_KEY = "aura-lang";

  let lang = "fr";
  let dict = {};
  let fallback = {};

  function normalize(tag) {
    if (!tag) return "";
    const primary = String(tag).trim().replace(/_/g, "-").split("-")[0].toLowerCase();
    return SUPPORTED.indexOf(primary) >= 0 ? primary : "";
  }

  function detect() {
    try {
      const stored = normalize(localStorage.getItem(STORAGE_KEY));
      if (stored) return stored;
    } catch (err) {
      /* private context */
    }
    const candidates =
      navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language || navigator.userLanguage];
    for (let i = 0; i < candidates.length; i += 1) {
      const hit = normalize(candidates[i]);
      if (hit) return hit;
    }
    return "fr";
  }

  function lookup(source, key) {
    if (!source || !key) return "";
    const parts = String(key).split(".");
    let cur = source;
    for (let i = 0; i < parts.length; i += 1) {
      if (!cur || typeof cur !== "object") return "";
      cur = cur[parts[i]];
    }
    return typeof cur === "string" ? cur : "";
  }

  function t(key) {
    return lookup(dict, key) || lookup(fallback, key) || "";
  }

  function localeUrl(code) {
    return new URL("locales/" + code + ".json", window.location.href).href;
  }

  async function loadJson(code) {
    const res = await fetch(localeUrl(code), { cache: "no-cache" });
    if (!res.ok) throw new Error("locale-" + code);
    return res.json();
  }

  function applyCatalogs() {
    if (window.AURA_PALETTES) {
      window.AURA_PALETTES.forEach((item) => {
        const name = t("palettes." + item.id);
        if (name) item.name = name;
      });
    }
    if (window.AURA_GLOWS) {
      window.AURA_GLOWS.forEach((item) => {
        const name = t("glows." + item.id);
        if (name) item.name = name;
      });
    }
    if (window.AURA_MOODS) {
      window.AURA_MOODS.forEach((item) => {
        const name = t("moods." + item.id + ".name");
        const lede = t("moods." + item.id + ".lede");
        if (name) item.name = name;
        if (lede) item.lede = lede;
      });
    }
  }

  function applyDom(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const text = t(el.getAttribute("data-i18n"));
      if (text) el.textContent = text;
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const text = t(el.getAttribute("data-i18n-aria"));
      if (text) el.setAttribute("aria-label", text);
    });
  }

  function apply() {
    document.documentElement.lang = lang;
    applyCatalogs();
    applyDom(document);
  }

  const ready = (async () => {
    lang = detect();
    try {
      fallback = await loadJson("fr");
    } catch (err) {
      fallback = {};
    }
    if (lang === "fr") {
      dict = fallback;
    } else {
      try {
        dict = await loadJson(lang);
      } catch (err) {
        dict = fallback;
        lang = "fr";
      }
    }
    if (lookup(fallback, "intro.enter") || lookup(dict, "intro.enter")) {
      apply();
    }
    return lang;
  })();

  window.AURA_I18N = {
    t,
    apply,
    applyDom,
    ready,
    getLang() {
      return lang;
    },
  };
})();
