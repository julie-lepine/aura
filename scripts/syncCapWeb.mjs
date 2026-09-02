/**
 * Copie les fichiers web vers www/ (webDir Capacitor).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const www = path.join(root, "www");
const files = [
  "index.html",
  "style.css",
];

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(rel) {
  const from = path.join(root, rel);
  const to = path.join(www, rel);
  if (!fs.existsSync(from)) {
    throw new Error(`fichier manquant: ${rel}`);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(rel) {
  const from = path.join(root, rel);
  const to = path.join(www, rel);
  if (!fs.existsSync(from)) {
    throw new Error(`dossier manquant: ${rel}`);
  }
  fs.cpSync(from, to, { recursive: true });
}

rmDir(www);
fs.mkdirSync(www, { recursive: true });
for (const file of files) copyFile(file);
copyDir("js");
copyDir("assets");
console.log("www/ synchronisé");
