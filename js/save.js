(() => {
  "use strict";

  const CACHE_DIR = "CACHE";
  const ALBUM_NAME = "aura";
  const CHUNK_BYTES = 128 * 1024;

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
    try {
      if (typeof cap.registerPlugin === "function") {
        return cap.registerPlugin(name);
      }
    } catch (err) {
      /* déjà enregistré */
    }
    return (cap.Plugins && cap.Plugins[name]) || null;
  }

  function waitMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function stemName(name) {
    return String(name || "aura").replace(/\.[^.]+$/, "") || "aura";
  }

  function isImageFile(blob, name) {
    const mime = blob && blob.type ? String(blob.type) : "";
    if (mime.indexOf("image/") === 0) return true;
    return /\.(png|jpe?g|gif|webp)$/i.test(String(name || ""));
  }

  function canSaveToGallery(blob, name) {
    if (isImageFile(blob, name)) return true;
    const mime = blob && blob.type ? String(blob.type) : "";
    if (mime.indexOf("mp4") !== -1) return true;
    return /\.mp4$/i.test(String(name || ""));
  }

  function toFsPath(uri) {
    const value = String(uri || "");
    const marker = "/_capacitor_file_";
    const at = value.indexOf(marker);
    if (at !== -1) return decodeURIComponent(value.slice(at + marker.length));
    if (value.indexOf("file:") === 0) {
      try {
        return decodeURIComponent(new URL(value).pathname);
      } catch (err) {
        return value.replace(/^file:\/\//, "");
      }
    }
    return value;
  }

  function asFileUri(uri) {
    const path = toFsPath(uri);
    if (!path) return "";
    if (path.indexOf("file:") === 0 || path.indexOf("content:") === 0) return path;
    if (path.charAt(0) === "/") return "file://" + path;
    return path;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      const slice = bytes.subarray(i, Math.min(i + step, bytes.length));
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }

  function saveWeb(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function writeBlobToCache(filesystem, blob, name) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (!bytes.length) throw new Error("empty-file");

    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const slice = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length));
      const data = bytesToBase64(slice);
      if (offset === 0) {
        await filesystem.writeFile({
          path: name,
          data,
          directory: CACHE_DIR,
          recursive: true,
        });
      } else {
        await filesystem.appendFile({
          path: name,
          data,
          directory: CACHE_DIR,
        });
      }
    }

    const loc = await filesystem.getUri({
      path: name,
      directory: CACHE_DIR,
    });
    const uri = asFileUri(loc && loc.uri);
    if (!uri) throw new Error("missing-uri");
    return { uri, path: toFsPath(uri) };
  }

  async function ensureAlbumId(media) {
    try {
      await media.createAlbum({ name: ALBUM_NAME });
    } catch (err) {
      /* l’album existe déjà */
    }

    let albumsPath = "";
    try {
      const info = await media.getAlbumsPath();
      albumsPath = info && info.path ? String(info.path) : "";
    } catch (err) {
      albumsPath = "";
    }

    try {
      const listed = await media.getAlbums();
      const albums = listed && listed.albums ? listed.albums : [];
      const match = albums.find((album) => {
        if (!album || album.name !== ALBUM_NAME) return false;
        if (!albumsPath) return true;
        return String(album.identifier || "").indexOf(albumsPath) === 0;
      });
      if (match && match.identifier) return match.identifier;
    } catch (err) {
      /* on reconstruit le chemin */
    }

    if (albumsPath) {
      return albumsPath.replace(/\/+$/, "") + "/" + ALBUM_NAME;
    }
    throw new Error("album-unavailable");
  }

  async function saveToGallery(media, path, name, blob) {
    const albumIdentifier = await ensureAlbumId(media);
    const opts = {
      path,
      albumIdentifier,
      fileName: stemName(name),
    };
    if (isImageFile(blob, name)) await media.savePhoto(opts);
    else await media.saveVideo(opts);
  }

  async function shareUris(share, uris, title) {
    const files = uris.filter(Boolean);
    if (!share || !files.length) throw new Error("share-unavailable");
    try {
      await share.share({
        title: title || ALBUM_NAME,
        dialogTitle: title || ALBUM_NAME,
        files,
      });
      return { method: "share" };
    } catch (err) {
      const message = String(err && (err.message || err));
      if (/cancel/i.test(message)) return { method: "share", canceled: true };
      throw err;
    }
  }

  async function saveNative(files) {
    const filesystem = nativePlugin("Filesystem");
    if (!filesystem || typeof filesystem.writeFile !== "function") {
      throw new Error("filesystem-unavailable");
    }
    const media = nativePlugin("Media");
    const share = nativePlugin("Share");
    const written = [];

    for (let i = 0; i < files.length; i += 1) {
      written.push(await writeBlobToCache(filesystem, files[i].blob, files[i].name));
    }

    const galleryOk =
      media &&
      typeof media.savePhoto === "function" &&
      files.every((file) => canSaveToGallery(file.blob, file.name));

    if (galleryOk) {
      try {
        for (let i = 0; i < files.length; i += 1) {
          await saveToGallery(media, written[i].path, files[i].name, files[i].blob);
        }
        return { method: "gallery" };
      } catch (err) {
        /* partage si la galerie refuse le fichier */
      }
    }

    return shareUris(
      share,
      written.map((item) => item.uri),
      files[0] && files[0].name
    );
  }

  async function saveBlobs(files) {
    const list = (files || []).filter((item) => item && item.blob && item.name);
    if (!list.length) return { method: "none" };

    if (isNativeApp()) {
      return saveNative(list);
    }

    for (let i = 0; i < list.length; i += 1) {
      saveWeb(list[i].blob, list[i].name);
      if (i < list.length - 1) await waitMs(280);
    }
    return { method: "web" };
  }

  async function saveBlob(blob, name) {
    return saveBlobs([{ blob, name }]);
  }

  window.AURA_SAVE = {
    saveBlob,
    saveBlobs,
    isNativeApp,
  };
})();
