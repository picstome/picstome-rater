const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  rateFiles: (data) => ipcRenderer.invoke("rate-files", data),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onInit: (cb) => ipcRenderer.on("init", (_, d) => cb(d)),
  onIncomingRate: (cb) => ipcRenderer.on("incoming-rate", (_, d) => cb(d)),
  onUpdateStatus: (cb) => ipcRenderer.on("update-status", (_, d) => cb(d)),
});
