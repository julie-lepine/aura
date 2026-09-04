const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const langs = ["fr", "en", "es", "de"];

function flatten(obj, prefix, out) {
  Object.keys(obj).forEach((key) => {
    const next = prefix ? prefix + "." + key : key;
    if (obj[key] && typeof obj[key] === "object") flatten(obj[key], next, out);
    else out.push(next);
  });
}

const dicts = {};
langs.forEach((lang) => {
  dicts[lang] = JSON.parse(fs.readFileSync(path.join(root, "locales", lang + ".json"), "utf8"));
});

const frKeys = [];
flatten(dicts.fr, "", frKeys);
langs.slice(1).forEach((lang) => {
  const keys = [];
  flatten(dicts[lang], "", keys);
  assert.deepStrictEqual(keys, frKeys, lang + " keys must match fr");
  frKeys.forEach((key) => {
    const parts = key.split(".");
    let cur = dicts[lang];
    parts.forEach((part) => {
      cur = cur[part];
    });
    assert.ok(typeof cur === "string" && cur.length, lang + " missing " + key);
  });
});

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const htmlKeys = [...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((m) => m[1]);
htmlKeys.forEach((key) => {
  assert.ok(frKeys.indexOf(key) >= 0, "html key missing in fr.json: " + key);
});

const flow = fs.readFileSync(path.join(root, "js/flow.js"), "utf8");
["config.soundOff", "config.soundOn", "result.downloadMoments2", "result.downloadMoments3", "result.saving", "result.saved", "result.saveFailed"].forEach((key) => {
  assert.ok(flow.indexOf('"' + key + '"') >= 0, "flow.js should use " + key);
  assert.ok(frKeys.indexOf(key) >= 0, "flow key missing in fr.json: " + key);
});

assert.ok(html.indexOf("js/i18n.js") >= 0, "index.html should load i18n.js");
assert.strictEqual(dicts.fr.glows.burst, "flash");
assert.strictEqual(dicts.es.glows.burst, "destello");
assert.strictEqual(dicts.de.glows.burst, "blitz");

console.log("i18n ok ·", frKeys.length, "keys ·", htmlKeys.length, "html bindings");
