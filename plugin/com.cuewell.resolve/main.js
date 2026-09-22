"use strict";

const { app, BrowserWindow, dialog, ipcMain, nativeImage, session } = require("electron");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { createEngine, defaultDataDir } = require("./lib/engine");
const { startServer } = require("./lib/server");

const PLUGIN_ID = "com.cuewell.resolve";

let WorkflowIntegration = null;
let resolveObject = null;
let mainWindow = null;
let engine = null;

function ensureWorkflowNode() {
  const target = path.join(__dirname, "WorkflowIntegration.node");
  if (fs.existsSync(target)) return;
  const examples = process.platform === "win32"
    ? path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "Blackmagic Design", "DaVinci Resolve", "Support", "Developer", "Workflow Integrations", "Examples", "SamplePlugin", "WorkflowIntegration.node")
    : "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node";
  if (!fs.existsSync(examples)) return;
  try {
    fs.copyFileSync(examples, target);
  } catch (error) {
    console.error("Could not copy WorkflowIntegration.node:", error.message);
  }
}

async function getResolve() {
  if (!WorkflowIntegration) return null;
  if (!resolveObject) {
    const ready = await WorkflowIntegration.Initialize(PLUGIN_ID);
    if (!ready) return null;
    resolveObject = await WorkflowIntegration.GetResolve();
  }
  return resolveObject || null;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#12110f",
    title: "Cuewell",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.loadURL(url);
}

function writeDragIcon(file) {
  const size = 32;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const inside = (dx * dx) + (dy * dy) < 150;
      const index = row + 1 + (x * 4);
      raw[index] = inside ? 227 : 18;
      raw[index + 1] = inside ? 154 : 17;
      raw[index + 2] = inside ? 69 : 15;
      raw[index + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return nativeImage.createFromPath(file);
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc;
}

const resolveAdapter = {
  async projectName() {
    const resolve = await getResolve();
    if (!resolve) return "";
    const manager = await resolve.GetProjectManager();
    const project = manager && await manager.GetCurrentProject();
    if (!project || !project.GetName) return "";
    return (await project.GetName()) || "";
  },
  place: placeOnTimeline,
};

async function placeOnTimeline(request) {
  const resolve = await getResolve();
  if (!resolve) return { ok: false, error: "Cuewell is not connected to Resolve. Open it from Workspace > Workflow Integrations and try again." };
  const manager = await resolve.GetProjectManager();
  const project = manager && await manager.GetCurrentProject();
  if (!project) return { ok: false, error: "Open a Resolve project first." };
  const mediaPool = await project.GetMediaPool();
  if (!mediaPool) return { ok: false, error: "Resolve did not return a media pool." };
  const root = await mediaPool.GetRootFolder();
  let bin = await findFolder(root, "Cuewell");
  if (!bin) bin = await mediaPool.AddSubFolder(root, "Cuewell");
  if (bin) await mediaPool.SetCurrentFolder(bin);

  let clips = asArray(await mediaPool.ImportMedia([request.path])).filter(Boolean);
  if (!clips.length && resolve.GetMediaStorage) {
    const storage = await resolve.GetMediaStorage();
    if (storage) clips = asArray(await storage.AddItemListToMediaPool([request.path])).filter(Boolean);
  }
  if (!clips.length) return { ok: false, error: "Resolve did not import that file." };
  if (request.poolOnly) return { ok: true, message: `Added “${request.title}” to the Cuewell bin.` };

  const timeline = await project.GetCurrentTimeline();
  if (!timeline) return { ok: true, message: `Added “${request.title}” to the Cuewell bin. Open a timeline to place it at the playhead.` };
  const fpsSetting = Number(await timeline.GetSetting("timelineFrameRate"));
  const nominal = Math.round(fpsSetting) || 24;
  const timelineStart = Number(await timeline.GetStartFrame()) || 0;
  const recordFrame = timelineStart + Math.max(0, tcToFrames(await timeline.GetCurrentTimecode(), nominal) - tcToFrames(await timeline.GetStartTimecode(), nominal));
  let clipFps = nominal;
  try {
    const properties = await clips[0].GetClipProperty();
    const fps = properties && Number(properties.FPS || properties.fps);
    if (fps) clipFps = fps;
  } catch {
    // Use the timeline frame rate.
  }
  const clipInfo = {
    mediaPoolItem: clips[0],
    startFrame: Math.max(0, Math.round(request.startSec * clipFps)),
    endFrame: Math.max(1, Math.round(request.endSec * clipFps)),
    mediaType: 2,
    recordFrame,
  };
  if (request.audioTrack) clipInfo.trackIndex = request.audioTrack;
  const placed = await mediaPool.AppendToTimeline([clipInfo]);
  if (!asArray(placed).some(Boolean)) {
    return { ok: true, message: `Added “${request.title}” to the Cuewell bin. Drag it from Cuewell if the timeline did not accept it.` };
  }
  return { ok: true, message: `Placed “${request.title}” at the playhead.` };
}

async function findFolder(root, name) {
  if (!root || !root.GetSubFolderList) return null;
  for (const folder of asArray(await root.GetSubFolderList())) {
    if (folder && await folder.GetName() === name) return folder;
  }
  return null;
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.length === "number") {
    const list = [];
    for (let index = 0; index < value.length; index += 1) list.push(value[index]);
    return list;
  }
  return [value];
}

function tcToFrames(timecode, fps) {
  if (!timecode || typeof timecode !== "string") return 0;
  const drop = timecode.includes(";");
  const [hours = 0, minutes = 0, seconds = 0, frames = 0] = timecode.split(/[:;]/).map((part) => parseInt(part, 10) || 0);
  let total = ((hours * 3600) + (minutes * 60) + seconds) * fps + frames;
  if (drop && (fps === 30 || fps === 60)) {
    const dropFrames = fps === 60 ? 4 : 2;
    const totalMinutes = (hours * 60) + minutes;
    total -= dropFrames * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return total;
}

function audiioLogin() {
  return new Promise((resolve) => {
    const partition = "persist:cuewell-audiio";
    const audiioSession = session.fromPartition(partition);
    const win = new BrowserWindow({
      width: 1040,
      height: 840,
      title: "Sign in to Audiio",
      parent: mainWindow || undefined,
      webPreferences: { partition, nodeIntegration: false, contextIsolation: true },
    });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };
    const timer = setInterval(async () => {
      try {
        const cookies = await audiioSession.cookies.get({ url: "https://audiio.com" });
        const cookie = cookies.find((item) => item.name === "auth_web_token");
        if (!cookie || !cookie.value) return;
        const extra = await win.webContents.executeJavaScript(`(() => {
          let userId = null;
          try { userId = JSON.parse(localStorage.getItem("player-storage") || "{}").state?.userId || null; } catch (error) {}
          return { refreshToken: localStorage.getItem("refreshToken"), accountId: userId };
        })()`);
        finish({ token: cookie.value, refreshToken: extra && extra.refreshToken, accountId: extra && extra.accountId });
      } catch {
        // The page is still loading.
      }
    }, 1000);
    win.on("closed", () => finish(null));
    win.loadURL("https://audiio.com/account/login");
  });
}

app.whenReady().then(async () => {
  ensureWorkflowNode();
  try {
    WorkflowIntegration = require("./WorkflowIntegration.node");
  } catch (error) {
    console.error("WorkflowIntegration.node is unavailable:", error.message);
  }
  engine = createEngine({
    dataDir: defaultDataDir(),
    resolve: resolveAdapter,
    audiioLogin,
    audiioLogout: async () => {
      await session.fromPartition("persist:cuewell-audiio").clearStorageData();
    },
  });
  const iconPath = path.join(engine.dataDir, "drag-icon.png");
  const dragIcon = writeDragIcon(iconPath);
  const server = await startServer(engine, { port: 47321 });

  ipcMain.handle("cuewell:chooseFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("cuewell:chooseFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav", "aif", "aiff", "mp3", "m4a", "aac", "flac", "ogg"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.on("cuewell:drag", (event, id) => {
    const track = engine.track(id);
    if (!track || !fs.existsSync(track.path)) return;
    event.sender.startDrag({ file: track.path, icon: dragIcon });
  });

  createWindow(server.info().localUrl);
});

app.on("window-all-closed", async () => {
  if (WorkflowIntegration) {
    try { await WorkflowIntegration.CleanUp(); } catch { /* already closed */ }
  }
  app.quit();
});
