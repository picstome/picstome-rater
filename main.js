const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const APP_NAME = "Picstome Rater";

const MAX_FILES = 5000;
const BATCH_SIZE = 20;
const EXIFTOOL_TIMEOUT_MS = 60000;
const PROBE_TIMEOUT_MS = 5000;
const IMAGE_EXTS = ["jpg", "jpeg", "dng"];
const RAW_EXTS = ["cr3", "cr2", "arw", "nef", "raf", "orf", "rw2"];

const STRINGS = {
  en: {
    selectFolderTitle: "Where are your photos?",
    folderError: "Folder not accessible",
    notFoundDetail: "not found",
    updateAvailable: "Update available — downloading...",
    updateReady: "Update ready. Restart the app to install it.",
    exiftoolMissing: "Photo tool unavailable",
    tooManyFiles: "Too many files in one link (limit {max})",
    invalidRequest: "Invalid request",
    noFolder: "No folder selected",
    waiting: "Waiting for a Picstome link...",
    needFolder: "Select a photos folder first",
    needFiles: "Waiting for a Picstome link...",
    ready: "Ready to rate {n} photo{s} with {r} ★",
    applying: "Applying rating…",
    applyBtn: "Apply rating",
    changeBtn: "Change...",
    folderLabel: "Photos folder",
    photos: "photos",
    rating: "Rating",
    rated: "✓ {n} file{s} rated",
    notFound: "⚠ {n} not found",
    errors: "✖ {n} error{s}",
  },
  es: {
    selectFolderTitle: "¿Dónde están tus fotos?",
    folderError: "Carpeta no accesible",
    notFoundDetail: "no encontrado",
    updateAvailable: "Actualización disponible — descargando...",
    updateReady: "Actualización lista. Reinicia la app para instalarla.",
    exiftoolMissing: "Herramienta de fotos no disponible",
    tooManyFiles: "Demasiados archivos en un enlace (límite {max})",
    invalidRequest: "Solicitud inválida",
    noFolder: "Ninguna carpeta seleccionada",
    waiting: "Esperando enlace de Picstome...",
    needFolder: "Selecciona primero la carpeta de fotos",
    needFiles: "Esperando enlace de Picstome...",
    ready: "Listo para ratear {n} foto{s} con {r} ★",
    applying: "Aplicando rating…",
    applyBtn: "Aplicar rating",
    changeBtn: "Cambiar...",
    folderLabel: "Carpeta de fotos",
    photos: "fotos",
    rating: "Rating",
    rated: "✓ {n} archivo{s} rateado{s}",
    notFound: "⚠ {n} no encontrado{s}",
    errors: "✖ {n} error{s}",
  },
};

function getLang() {
  const locale = app.getLocale() || "en";
  return locale.toLowerCase().startsWith("es") ? "es" : "en";
}

function t(key, vars) {
  const lang = getLang();
  let str = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    str = str.replace(/\{(\w+)\}/g, (m, name) =>
      name in vars ? String(vars[name]) : m,
    );
  }
  return str;
}

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("Could not save config:", err);
  }
}

function exiftoolPath() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.join(__dirname, "resources");

  return process.platform === "win32"
    ? path.join(base, "exiftool.exe")
    : path.join(base, "exiftool");
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function normalizeRating(value) {
  const v = String(value ?? "").trim();
  return ["1", "2", "3", "4", "5"].includes(v) ? v : "1";
}

function ratingPercentFromStars(rating) {
  const map = {
    0: "0",
    1: "1",
    2: "25",
    3: "50",
    4: "75",
    5: "99",
  };
  return map[String(rating)] ?? "0";
}

function sanitizeFileNames(files) {
  if (!Array.isArray(files) || files.length === 0) return null;
  if (files.length > MAX_FILES) return null;

  const names = [];
  for (const file of files) {
    if (typeof file !== "string") return null;
    const name = file.trim();
    if (!name || name.length > 255) return null;
    if (name === "." || name === "..") return null;
    if (/[\\/]/.test(name)) return null;
    if (/[\u0000-\u001f\u007f]/.test(name)) return null;
    names.push(name);
  }
  return names;
}

function errorDetails(names, msg) {
  return names.map((name) => ({ name, status: "error", msg }));
}

let mainWindow = null;
let pendingRate = null;
let pendingURL = null;
let trustedPhotosDir = null;
let updateDownloaded = false;
let exiftoolProbePromise = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 700,
    minWidth: 720,
    minHeight: 620,
    resizable: true,
    show: false,
    title: APP_NAME,
    backgroundColor: "#FFF9EC",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellCheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  mainWindow.webContents.on("did-finish-load", () => {
    const cfg = loadConfig();
    trustedPhotosDir = isDirectory(cfg.photosDir) ? cfg.photosDir : null;

    mainWindow.webContents.send("init", {
      lang: getLang(),
      config: {
        photosDir: trustedPhotosDir || "",
        lastRating: normalizeRating(cfg.lastRating || "1"),
      },
      strings: STRINGS[getLang()],
    });

    if (pendingRate) {
      mainWindow.webContents.send("incoming-rate", pendingRate);
      pendingRate = null;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerProtocol() {
  if (process.defaultApp) {
    if (process.argv.length >= 2 && process.argv[1]) {
      app.setAsDefaultProtocolClient("picstome", process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient("picstome");
  }
}

function parseRateURL(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "picstome:") return null;
  if (parsed.hostname !== "rate") return null;

  const files = (parsed.searchParams.get("files") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (files.length === 0 || files.length > MAX_FILES) return null;

  const hasRating = parsed.searchParams.has("rating");
  const rating = hasRating
    ? normalizeRating(parsed.searchParams.get("rating"))
    : null;

  return { files, rating };
}

function handleURL(url) {
  try {
    const payload = parseRateURL(url);
    if (!payload) return;

    pendingRate = payload;

    if (app.isReady()) {
      showMainWindow();
    }
  } catch (err) {
    console.error("Invalid picstome URL:", err);
  }
}

function setupSingleInstance() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", (event, argv) => {
    const deepLink = argv.find(
      (arg) => typeof arg === "string" && arg.startsWith("picstome://"),
    );
    if (deepLink) {
      handleURL(deepLink);
    } else {
      showMainWindow();
    }
  });

  return true;
}

async function chooseFolder() {
  showMainWindow();

  const result = await dialog.showOpenDialog(mainWindow, {
    title: t("selectFolderTitle"),
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths?.[0]) return null;

  const dir = result.filePaths[0];
  if (!isDirectory(dir)) return null;

  const cfg = loadConfig();
  cfg.photosDir = dir;
  saveConfig(cfg);

  trustedPhotosDir = dir;

  return dir;
}

function findExactCaseInsensitive(dirFiles, base, ext) {
  const target = `${base}.${ext}`.toLowerCase();
  return dirFiles.find((f) => f.toLowerCase() === target) || null;
}

function exiftoolCandidates() {
  const tool = exiftoolPath();
  if (process.platform === "win32") {
    return [{ file: tool, prefix: [] }];
  }

  return [
    { file: tool, prefix: [] },
    { file: "/usr/bin/perl", prefix: [tool] },
    { file: "perl", prefix: [tool] },
  ];
}

async function probeExiftool() {
  const tool = exiftoolPath();

  try {
    if (process.platform !== "win32") {
      fs.chmodSync(tool, 0o755);
    }
  } catch {
    // best effort: packaged builds sometimes lose the executable bit
  }

  for (const candidate of exiftoolCandidates()) {
    if (candidate.file !== "perl" && !fs.existsSync(candidate.file)) continue;

    const works = await new Promise((resolve) => {
      execFile(
        candidate.file,
        [...candidate.prefix, "-ver"],
        { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
        (err, stdout) =>
          resolve(!err && /^\d+\.\d+/.test(String(stdout).trim())),
      );
    });

    if (works) return candidate;
  }

  console.error("No working exiftool found at:", tool);
  return null;
}

function getExiftool() {
  if (!exiftoolProbePromise) {
    exiftoolProbePromise = probeExiftool();
  }
  return exiftoolProbePromise;
}

function runExiftool(cmd, filePaths, rating) {
  return new Promise((resolve) => {
    const ratingPercent = ratingPercentFromStars(rating);

    const args = [
      ...cmd.prefix,
      "-m",
      "-overwrite_original",
      "-P",
      "-quiet",
      `-Rating=${rating}`,
      `-RatingPercent=${ratingPercent}`,
      ...filePaths,
    ];

    execFile(
      cmd.file,
      args,
      {
        timeout: EXIFTOOL_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || stdout || err.message || "").trim();
          resolve(new Error(msg || err.message));
          return;
        }
        resolve(null);
      },
    );
  });
}

async function doRate(files, rating, photosDir) {
  const exiftool = await getExiftool();
  let rated = 0;
  let notFound = 0;
  let errors = 0;

  let dirFiles;
  try {
    dirFiles = fs.readdirSync(photosDir);
  } catch {
    return {
      rated: 0,
      notFound: files.length,
      errors: 0,
      details: errorDetails(files, t("folderError")),
    };
  }

  if (!exiftool) {
    return {
      rated: 0,
      notFound: 0,
      errors: files.length,
      details: errorDetails(files, t("exiftoolMissing")),
    };
  }

  const slots = [];

  for (const base of files) {
    const matches = [];

    for (const ext of IMAGE_EXTS) {
      const match = findExactCaseInsensitive(dirFiles, base, ext);
      if (match) matches.push(path.join(photosDir, match));
    }

    for (const ext of RAW_EXTS) {
      const match = findExactCaseInsensitive(dirFiles, base, ext);
      if (match) matches.push(path.join(photosDir, match));
    }

    if (matches.length === 0) {
      notFound += 1;
      slots.push({
        file: false,
        detail: { name: base, status: "notfound", msg: t("notFoundDetail") },
      });
      continue;
    }

    for (const filePath of matches) {
      const name = path.basename(filePath);
      slots.push({
        file: true,
        name,
        filePath,
        detail: { name, status: "ok", file: name },
      });
    }
  }

  const fileSlots = slots.filter((slot) => slot.file);

  for (let i = 0; i < fileSlots.length; i += BATCH_SIZE) {
    const batch = fileSlots.slice(i, i + BATCH_SIZE);
    const batchErr = await runExiftool(
      exiftool,
      batch.map((slot) => slot.filePath),
      rating,
    );

    if (!batchErr) {
      for (const slot of batch) {
        rated += 1;
      }
      continue;
    }

    for (const slot of batch) {
      const err = await runExiftool(exiftool, [slot.filePath], rating);

      if (err) {
        errors += 1;
        slot.detail = {
          name: slot.name,
          status: "error",
          msg: err.message,
        };
      } else {
        rated += 1;
      }
    }
  }

  const details = slots.map((slot) => slot.detail);

  return { rated, notFound, errors, details };
}

ipcMain.handle("choose-folder", async () => {
  return await chooseFolder();
});

ipcMain.handle("get-config", () => {
  return loadConfig();
});

ipcMain.handle("rate-files", async (event, { files, rating, photosDir } = {}) => {
  const normalized = normalizeRating(rating);

  if (!Array.isArray(files) || files.length === 0) {
    return {
      rated: 0,
      notFound: 0,
      errors: 1,
      details: [{ name: "—", status: "error", msg: t("invalidRequest") }],
    };
  }

  if (files.length > MAX_FILES) {
    return {
      rated: 0,
      notFound: 0,
      errors: 1,
      details: [
        {
          name: `${files.length} files`,
          status: "error",
          msg: t("tooManyFiles", { max: MAX_FILES }),
        },
      ],
    };
  }

  const names = sanitizeFileNames(files);
  if (!names) {
    return {
      rated: 0,
      notFound: 0,
      errors: 1,
      details: [{ name: "—", status: "error", msg: t("invalidRequest") }],
    };
  }

  const requested =
    typeof photosDir === "string" && photosDir.length > 0
      ? path.resolve(photosDir)
      : null;
  if (
    !trustedPhotosDir ||
    !requested ||
    requested !== path.resolve(trustedPhotosDir)
  ) {
    return {
      rated: 0,
      notFound: 0,
      errors: names.length,
      details: errorDetails(names, t("folderError")),
    };
  }

  const cfg = loadConfig();
  cfg.lastRating = normalized;
  saveConfig(cfg);

  return await doRate(names, normalized, trustedPhotosDir);
});

ipcMain.handle("install-update", () => {
  if (!updateDownloaded) {
    return { ok: false };
  }
  autoUpdater.quitAndInstall();
  return { ok: true };
});

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    console.error("Auto-updater error:", err);
  });

  autoUpdater.on("update-available", () => {
    mainWindow?.webContents.send("update-status", {
      type: "available",
      msg: t("updateAvailable"),
    });
  });

  autoUpdater.on("update-downloaded", () => {
    updateDownloaded = true;
    mainWindow?.webContents.send("update-status", {
      type: "ready",
      msg: t("updateReady"),
    });
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error("Update check failed:", err);
  });
}

if (setupSingleInstance()) {
  registerProtocol();

  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) handleURL(url);
    else pendingURL = url;
  });

  app.whenReady().then(() => {
    createWindow();
    setupAutoUpdater();
    getExiftool().catch(() => {});

    const deepLink = process.argv.find(
      (arg) => typeof arg === "string" && arg.startsWith("picstome://"),
    );

    if (deepLink) {
      handleURL(deepLink);
    } else if (pendingURL) {
      handleURL(pendingURL);
      pendingURL = null;
    } else {
      showMainWindow();
    }
  });

  app.on("activate", () => {
    if (!mainWindow) {
      createWindow();
    }
    showMainWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
