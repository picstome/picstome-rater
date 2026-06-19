const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const APP_NAME = "Picstome Rater";

const STRINGS = {
  en: {
    selectFolderTitle: "Where are your photos?",
    folderError: "Folder not accessible",
    notFoundDetail: "not found",
    updateAvailable: "Update available — downloading...",
    updateReady: "Update ready. Restart the app to install it.",
  },
  es: {
    selectFolderTitle: "¿Dónde están tus fotos?",
    folderError: "Carpeta no accesible",
    notFoundDetail: "no encontrado",
    updateAvailable: "Actualización disponible — descargando...",
    updateReady: "Actualización lista. Reinicia la app para instalarla.",
  },
};

function getLang() {
  const locale = app.getLocale() || "en";
  return locale.toLowerCase().startsWith("es") ? "es" : "en";
}

function t(key) {
  const lang = getLang();
  return STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
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
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function exiftoolPath() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.join(__dirname, "resources");

  return process.platform === "win32"
    ? path.join(base, "exiftool.exe")
    : path.join(base, "exiftool");
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

let mainWindow = null;
let pendingRate = null;
let pendingURL = null;
let isQuitting = false;

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
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.on("did-finish-load", () => {
    const cfg = loadConfig();

    mainWindow.webContents.send("init", {
      lang: getLang(),
      config: {
        ...cfg,
        lastRating: normalizeRating(cfg.lastRating || "1"),
      },
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

  const hasRating = parsed.searchParams.has("rating");
  const rating = hasRating
    ? normalizeRating(parsed.searchParams.get("rating"))
    : null;

  if (!files.length) return null;
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

  const cfg = loadConfig();
  cfg.photosDir = result.filePaths[0];
  saveConfig(cfg);

  return result.filePaths[0];
}

function findExactCaseInsensitive(dirFiles, base, ext) {
  const target = `${base}.${ext}`.toLowerCase();
  return dirFiles.find((f) => f.toLowerCase() === target) || null;
}

function runExiftoolOnFile(exiftool, filePath, rating) {
  return new Promise((resolve) => {
    const ratingPercent = ratingPercentFromStars(rating);

    execFile(
      exiftool,
      [
        "-m",
        "-overwrite_original",
        "-P",
        "-quiet",
        `-Rating=${rating}`,
        `-RatingPercent=${ratingPercent}`,
        filePath,
      ],
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
  const exiftool = exiftoolPath();
  const IMAGE_EXTS = ["jpg", "jpeg", "dng"];
  const RAW_EXTS = ["cr3", "cr2", "arw", "nef", "raf", "orf", "rw2"];

  let dirFiles = [];
  try {
    dirFiles = fs.readdirSync(photosDir);
  } catch {
    return {
      rated: 0,
      notFound: files.length,
      errors: 0,
      details: files.map((name) => ({
        name,
        status: "error",
        msg: t("folderError"),
      })),
    };
  }

  const details = [];
  let rated = 0;
  let notFound = 0;
  let errors = 0;

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
      details.push({
        name: base,
        status: "notfound",
        msg: t("notFoundDetail"),
      });
      continue;
    }

    for (const filePath of matches) {
      const err = await runExiftoolOnFile(exiftool, filePath, rating);

      if (err) {
        errors += 1;
        details.push({
          name: path.basename(filePath),
          status: "error",
          msg: err.message,
        });
      } else {
        rated += 1;
        details.push({
          name: path.basename(filePath),
          status: "ok",
          file: path.basename(filePath),
        });
      }
    }
  }

  return { rated, notFound, errors, details };
}

ipcMain.handle("choose-folder", async () => {
  return await chooseFolder();
});

ipcMain.handle("get-config", () => {
  return loadConfig();
});

ipcMain.handle("rate-files", async (event, { files, rating, photosDir }) => {
  const normalized = normalizeRating(rating);
  const cfg = loadConfig();
  cfg.photosDir = photosDir;
  cfg.lastRating = normalized;
  saveConfig(cfg);

  return await doRate(files, normalized, photosDir);
});

ipcMain.handle("install-update", () => {
  isQuitting = true;
  autoUpdater.quitAndInstall();
});

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", () => {
    mainWindow?.webContents.send("update-status", {
      type: "available",
      msg: t("updateAvailable"),
    });
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-status", {
      type: "ready",
      msg: t("updateReady"),
    });
  });

  autoUpdater.checkForUpdatesAndNotify();
}

if (!setupSingleInstance()) {
} else {
  registerProtocol();

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) handleURL(url);
    else pendingURL = url;
  });

  app.whenReady().then(() => {
    createWindow();
    setupAutoUpdater();

    const deepLink = process.argv.find(
      (arg) => typeof arg === "string" && arg.startsWith("picstome://"),
    );

    if (deepLink) {
      handleURL(deepLink);
    } else if (pendingURL) {
      handleURL(pendingURL);
      pendingURL = null;
    } else if (!app.isPackaged) {
      showMainWindow();
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
