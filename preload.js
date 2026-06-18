const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  rateFiles: (data) => ipcRenderer.invoke("rate-files", data),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onInit: (cb) => ipcRenderer.on("init", (_, data) => cb(data)),
  onIncomingRate: (cb) =>
    ipcRenderer.on("incoming-rate", (_, data) => cb(data)),
  onUpdateStatus: (cb) =>
    ipcRenderer.on("update-status", (_, data) => cb(data)),
});
