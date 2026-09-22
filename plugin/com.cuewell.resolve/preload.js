"use strict";

const { contextBridge, ipcRenderer } = require("electron/renderer");

contextBridge.exposeInMainWorld("cuewell", {
  inResolve: true,
  chooseFolder: () => ipcRenderer.invoke("cuewell:chooseFolder"),
  chooseFile: () => ipcRenderer.invoke("cuewell:chooseFile"),
  startDrag: (id) => ipcRenderer.send("cuewell:drag", id),
});
