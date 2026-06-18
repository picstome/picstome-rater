const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

// ─── i18n ─────────────────────────────────────────────────────────────────────
const STRINGS = {
  en: {
    selectFolderTitle: "Where are your photos?",
    noFolder: "No folder selected",
    waiting: "Waiting for a Picstome link...",
    ready: (n, r) =>
      `Ready to rate ${n} photo${n !== 1 ? "s" : ""} with ${r} ⭐`,
    applying: "⏳ Applying rating...",
    applyBtn: "Apply rating",
    changeBtn: "Change...",
    folderLabel: "Photos folder",
    photos: "photos",
    rating: "Rating",
    updateAvailable: "Update available — downloading...",
    updateReady: "Update ready. It will be installed on next launch.",
    rated: (n) => `✅ ${n} photo${n !== 1 ? "s" : ""} rated`,
    notFound: (n) => `⚠️ ${n} not found`,
    errors: (n) => `❌ ${n} error${n !== 1 ? "s" : ""}`,
    notFoundDetail: "not found",
    folderError: "Folder not accessible",
  },
  es: {
    selectFolderTitle: "¿Dónde están tus fotos?",
    noFolder: "Ninguna carpeta seleccionada",
    waiting: "Esperando enlace de Picstome...",
    ready: (n, r) =>
      `Listo para ratear ${n} foto${n !== 1 ? "s" : ""} con ${r} ⭐`,
    applying: "⏳ Aplicando rating...",
    applyBtn: "Aplicar rating",
    changeBtn: "Cambiar...",
    folderLabel: "Carpeta de fotos",
    photos: "fotos",
    rating: "Rating",
    updateAvailable: "Actualización disponible — descargando...",
    updateReady: "Actualización lista. Se instalará al cerrar la app.",
    rated: (n) =>
      `✅ ${n} foto${n !== 1 ? "s" : ""} rateada${n !== 1 ? "s" : ""}`,
    notFound: (n) => `⚠️ ${n} no encontrada${n !== 1 ? "s" : ""}`,
    errors: (n) => `❌ ${n} error${n !== 1 ? "es" : ""}`,
    notFoundDetail: "no encontrado",
    folderError: "Carpeta no accesible",
  },
};

function getLang() {
  const locale = app.getLocale();
  return locale.startsWith("es") ? "es" : "en";
}

function t(key, ...args) {
  const lang = getLang();
  const str = STRINGS[lang][key] ?? STRINGS["en"][key];
  return typeof str === "function" ? str(...args) : str;
}

// ─── Config ───────────────────────────────────────────────────────────────────
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

let mainWindow = null;
let pendingRate = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 440,
    resizable: false,
    show: false,
    title: "PicstomeRater",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("index.html");

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("init", { strings: STRINGS[getLang()] });
    if (pendingRate) {
      mainWindow.webContents.send("incoming-rate", pendingRate);
      pendingRate = null;
    }
  });

  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

if (process.defaultApp) {
  if (process.argv.length >= 2)
    app.setAsDefaultProtocolClient("picstome", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
} else {
  app.setAsDefaultProtocolClient("picstome");
}

function handleURL(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "rate") return;
    const files = (parsed.searchParams.get("files") ?? "")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    const rating = parsed.searchParams.get("rating") ?? "1";
    if (files.length === 0) return;
    const data = { files, rating };
    if (!mainWindow || !mainWindow.webContents) {
      pendingRate = data;
      return;
    }
    mainWindow.show();
    mainWindow.focus();
    if (mainWindow.webContents.isLoading()) pendingRate = data;
    else mainWindow.webContents.send("incoming-rate", data);
  } catch (e) {
    console.error("Invalid URL:", e);
  }
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) handleURL(url);
  else pendingURL = url;
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (event, argv) => {
    const url = argv.find((a) => a.startsWith("picstome://"));
    if (url) handleURL(url);
  });
}

ipcMain.handle("get-config", () => loadConfig());

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t("selectFolderTitle"),
    properties: ["openDirectory"],
  });
  if (!result.canceled && result.filePaths[0]) return result.filePaths[0];
  return null;
});

ipcMain.handle("rate-files", async (event, { files, rating, photosDir }) => {
  const cfg = loadConfig();
  cfg.photosDir = photosDir;
  saveConfig(cfg);
  return await doRate(files, rating, photosDir);
});

ipcMain.handle("install-update", () => autoUpdater.quitAndInstall());

function doRate(files, rating, photosDir) {
  return new Promise((resolve) => {
    const exiftool = exiftoolPath();
    const RAW_EXTS = [
      "jpg",
      "jpeg",
      "dng",
      "cr3",
      "cr2",
      "arw",
      "nef",
      "raf",
      "orf",
      "rw2",
    ];
    let dirFiles = [];
    try {
      dirFiles = fs.readdirSync(photosDir);
    } catch {
      resolve({
        rated: 0,
        notFound: files.length,
        errors: 0,
        details: files.map((f) => ({
          name: f,
          status: "error",
          msg: t("folderError"),
        })),
      });
      return;
    }
    const details = [];
    let pending = files.length,
      rated = 0,
      notFound = 0,
      errors = 0;
    function done() {
      if (--pending === 0) resolve({ rated, notFound, errors, details });
    }
    files.forEach((base) => {
      let found = null;
      for (const ext of RAW_EXTS) {
        const match = dirFiles.find(
          (f) => f.toLowerCase() === `${base.toLowerCase()}.${ext}`,
        );
        if (match) {
          found = path.join(photosDir, match);
          break;
        }
      }
      if (!found) {
        notFound++;
        details.push({
          name: base,
          status: "notfound",
          msg: t("notFoundDetail"),
        });
        done();
        return;
      }
      execFile(
        exiftool,
        [
          "-m",
          "-overwrite_original",
          "-quiet",
          "-if",
          "$Rating < 1",
          `-XMP:Rating=${rating}`,
          `-EXIF:Rating=${rating}`,
          found,
        ],
        (err) => {
          if (err) {
            errors++;
            details.push({ name: base, status: "error", msg: err.message });
          } else {
            rated++;
            details.push({
              name: base,
              status: "ok",
              file: path.basename(found),
            });
          }
          done();
        },
      );
    });
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", () =>
    mainWindow?.webContents.send("update-status", {
      type: "available",
      msg: t("updateAvailable"),
    }),
  );
  autoUpdater.on("update-downloaded", () =>
    mainWindow?.webContents.send("update-status", {
      type: "ready",
      msg: t("updateReady"),
    }),
  );
  autoUpdater.checkForUpdatesAndNotify();
}

let pendingURL = null;

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  const urlArg = process.argv.find((a) => a.startsWith("picstome://"));
  if (urlArg) handleURL(urlArg);
  else if (pendingURL) {
    handleURL(pendingURL);
    pendingURL = null;
  }
});

app.on("window-all-closed", () => {});
app.on("activate", () => mainWindow?.show());
