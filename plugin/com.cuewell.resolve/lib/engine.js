"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const catalog = require("./catalog");
const audio = require("./audio");
const audiio = require("./audiio");

function defaultDataDir() {
  if (process.env.CUEWELL_DATA) return process.env.CUEWELL_DATA;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cuewell");
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Cuewell");
  return path.join(os.homedir(), ".local", "share", "cuewell");
}

function createEngine({ dataDir = defaultDataDir(), resolve, audiioLogin, audiioLogout } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const libraryPath = path.join(dataDir, "library.json");
  const sessionPath = path.join(dataDir, "session.json");
  const state = loadJson(libraryPath, emptyLibrary());
  const session = loadJson(sessionPath, {});
  if (!session.token) {
    session.token = crypto.randomBytes(24).toString("hex");
    writeJson(sessionPath, session);
  }
  const listeners = new Set();
  const audiioPath = path.join(dataDir, "audiio-session.json");
  let audiioSession = loadJson(audiioPath, {});
  let audiioCache = [];
  let audiioTracks = [];
  let audiioTotal = 0;
  let audiioPage = 1;

  function emit() {
    for (const listener of listeners) listener();
  }

  function save() {
    writeJson(libraryPath, state);
    emit();
  }

  function publicState() {
    return {
      revision: state.revision,
      folders: state.folders,
      tracks: state.tracks,
      favorites: state.favorites,
      recent: state.recent,
      playlists: state.playlists,
      licenses: state.licenses,
      lan: state.lan,
      dataDir,
      account: audiioSession.account || null,
      audiioTracks,
      audiioTotal,
      audiioPage,
    };
  }

  function rememberAudiio(tracks, replacePage) {
    const byId = new Map(audiioCache.map((item) => [item.id, item]));
    for (const item of tracks || []) {
      if (item && item.id) byId.set(item.id, item);
    }
    audiioCache = [...byId.values()].slice(-400);
    if (replacePage) audiioTracks = tracks || [];
  }

  function track(id) {
    return state.tracks.find((item) => item.id === id)
      || audiioCache.find((item) => item.id === id)
      || audiioTracks.find((item) => item.id === id)
      || null;
  }

  async function handle(name, payload = {}) {
    switch (name) {
      case "state":
        return ok(await withProject(publicState()));
      case "audiioLogin":
        return connectAudiio();
      case "audiioLogout":
        return disconnectAudiio();
      case "audiioBrowse":
        return browseAudiio(payload);
      case "audiioFavorites":
        return loadAudiioFavorites(payload.page);
      case "audiioPlaylists":
        return loadAudiioPlaylists();
      case "audiioPlaylistTracks":
        return loadAudiioPlaylistTracks(payload.id);
      case "audiioSimilar":
        return audiioSimilar(payload.id);
      case "audiioAsk":
        return audiioAsk(payload.prompt);
      case "audiioMatch":
        return audiioMatch(payload.link || payload.text);
      case "audiioFavorite":
        return audiioFavorite(payload.id);
      case "generateDemo":
        return generateDemo();
      case "indexFolder":
        return indexFolder(payload.folder);
      case "forgetFolder":
        return forgetFolder(payload.folder);
      case "reindex":
        return reindex();
      case "updateTrack":
        return updateTrack(payload.id, payload.patch || {});
      case "toggleFavorite":
        return toggleFavorite(payload.id);
      case "noteRecent":
        return noteRecent(payload.id);
      case "createPlaylist":
        return createPlaylist(payload.name, payload.trackIds || []);
      case "renamePlaylist":
        return renamePlaylist(payload.id, payload.name);
      case "deletePlaylist":
        return deletePlaylist(payload.id);
      case "addToPlaylist":
        return addToPlaylist(payload.playlistId, payload.trackId);
      case "removeFromPlaylist":
        return removeFromPlaylist(payload.playlistId, payload.trackId);
      case "playlistFromPrompt":
        return playlistFromPrompt(payload.prompt, payload.name);
      case "licenseTrack":
        return licenseTrack(payload.trackId, payload.note || "");
      case "removeLicense":
        return removeLicense(payload.id);
      case "licensesCsv":
        return { ok: true, csv: catalog.licensesToCsv(state.licenses, state.tracks) };
      case "place":
        return place(payload);
      case "matchReference":
        return matchReference(payload);
      case "setLan":
        state.lan = Boolean(payload.enabled);
        save();
        return ok(publicState(), { restart: true });
      default:
        return { ok: false, error: `Unknown action ${name}` };
    }
  }

  function generateDemo() {
    const folder = path.join(dataDir, "audio");
    const demoTracks = audio.generateDemo(folder);
    const paths = new Set(demoTracks.map((item) => item.path));
    state.tracks = state.tracks.filter((item) => item.source !== "demo" && !paths.has(item.path));
    for (const demo of demoTracks) state.tracks.push(demo);
    if (!state.folders.includes(folder)) state.folders.push(folder);
    save();
    return ok(publicState(), { count: demoTracks.length });
  }

  function indexFolder(folder) {
    if (!folder || typeof folder !== "string") return { ok: false, error: "Choose a folder to index." };
    const resolved = safeDir(folder);
    if (!resolved) return { ok: false, error: "That folder does not exist." };
    const files = audio.walkAudio(resolved);
    let added = 0;
    let updated = 0;
    for (const file of files) {
      const info = audio.inspectAudio(file);
      if (!info || !info.duration) continue;
      const fresh = audio.trackFromFile(file, info);
      const existing = state.tracks.find((item) => item.path === file);
      if (!existing) {
        fresh.id = crypto.randomUUID();
        state.tracks.push(fresh);
        added += 1;
      } else if (existing.source === "demo" && !existing.locked) {
        existing.duration = fresh.duration || existing.duration;
        existing.peaks = fresh.peaks;
        existing.features = fresh.features;
        updated += 1;
      } else {
        state.tracks[state.tracks.indexOf(existing)] = mergeTrack(existing, fresh);
        updated += 1;
      }
    }
    if (!state.folders.includes(resolved)) state.folders.push(resolved);
    save();
    return ok(publicState(), { added, updated, scanned: files.length });
  }

  function forgetFolder(folder) {
    const resolved = path.resolve(folder || "");
    state.folders = state.folders.filter((item) => item !== resolved);
    const removed = new Set(state.tracks.filter((item) => item.path.startsWith(resolved + path.sep) || item.path === resolved).map((item) => item.id));
    state.tracks = state.tracks.filter((item) => !removed.has(item.id));
    dropIds(removed);
    save();
    return ok(publicState(), { removed: removed.size });
  }

  function reindex() {
    const folders = [...state.folders];
    let added = 0;
    let updated = 0;
    let scanned = 0;
    for (const folder of folders) {
      if (!fs.existsSync(folder)) continue;
      const result = indexFolder(folder);
      if (result.ok) {
        added += result.result.added;
        updated += result.result.updated;
        scanned += result.result.scanned;
      }
    }
    const missing = new Set(state.tracks.filter((item) => !fs.existsSync(item.path)).map((item) => item.id));
    if (missing.size) {
      state.tracks = state.tracks.filter((item) => !missing.has(item.id));
      dropIds(missing);
      save();
    }
    return ok(publicState(), { added, updated, scanned, removed: missing.size });
  }

  function updateTrack(id, patch) {
    const current = track(id);
    if (!current) return { ok: false, error: "Track not found." };
    const next = { ...current, locked: true };
    if (typeof patch.title === "string") next.title = patch.title.trim().slice(0, 160) || current.title;
    if (typeof patch.artist === "string") next.artist = patch.artist.trim().slice(0, 160) || current.artist;
    if (typeof patch.key === "string") next.key = patch.key.trim().slice(0, 16);
    if (typeof patch.description === "string") next.description = patch.description.trim().slice(0, 400);
    if (typeof patch.license === "string") next.license = patch.license.trim().slice(0, 400);
    if (patch.genres) next.genres = audioList(patch.genres);
    if (patch.moods) next.moods = audioList(patch.moods);
    if (patch.tags) next.tags = audioList(patch.tags);
    if (patch.bpm != null && patch.bpm !== "") next.bpm = clampNumber(patch.bpm, 40, 240);
    if (patch.energy != null && patch.energy !== "") next.energy = clampNumber(patch.energy, 0, 1);
    if (patch.vocals != null) next.vocals = Boolean(patch.vocals);
    replace(next);
    save();
    return ok(publicState());
  }

  function toggleFavorite(id) {
    if (!track(id)) return { ok: false, error: "Track not found." };
    if (state.favorites.includes(id)) state.favorites = state.favorites.filter((item) => item !== id);
    else state.favorites.unshift(id);
    save();
    return ok(publicState(), { favorite: state.favorites.includes(id) });
  }

  function noteRecent(id) {
    if (!track(id)) return { ok: false, error: "Track not found." };
    state.recent = [id, ...state.recent.filter((item) => item !== id)].slice(0, 20);
    save();
    return ok(publicState());
  }

  function createPlaylist(name, trackIds) {
    const playlist = {
      id: crypto.randomUUID(),
      name: cleanName(name, "New playlist"),
      trackIds: uniqueExisting(trackIds),
      createdAt: new Date().toISOString(),
    };
    state.playlists.unshift(playlist);
    save();
    return ok(publicState(), { playlist });
  }

  function renamePlaylist(id, name) {
    const playlist = state.playlists.find((item) => item.id === id);
    if (!playlist) return { ok: false, error: "Playlist not found." };
    playlist.name = cleanName(name, playlist.name);
    save();
    return ok(publicState());
  }

  function deletePlaylist(id) {
    state.playlists = state.playlists.filter((item) => item.id !== id);
    save();
    return ok(publicState());
  }

  function addToPlaylist(playlistId, trackId) {
    const playlist = state.playlists.find((item) => item.id === playlistId);
    if (!playlist || !track(trackId)) return { ok: false, error: "Playlist or track not found." };
    if (!playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId);
    save();
    return ok(publicState());
  }

  function removeFromPlaylist(playlistId, trackId) {
    const playlist = state.playlists.find((item) => item.id === playlistId);
    if (!playlist) return { ok: false, error: "Playlist not found." };
    playlist.trackIds = playlist.trackIds.filter((item) => item !== trackId);
    save();
    return ok(publicState());
  }

  function playlistFromPrompt(prompt, name) {
    const ranked = catalog.rankByPrompt(state.tracks, prompt || "");
    const trackIds = ranked.results.slice(0, 12).map((row) => row.track.id);
    if (!trackIds.length) return { ok: false, error: "No tracks matched that description." };
    const playlist = {
      id: crypto.randomUUID(),
      name: cleanName(name || prompt, "Prompt playlist"),
      trackIds,
      createdAt: new Date().toISOString(),
    };
    state.playlists.unshift(playlist);
    save();
    return ok(publicState(), { playlist, understood: ranked.understood });
  }

  async function licenseTrack(trackId, note) {
    const current = track(trackId);
    if (!current) return { ok: false, error: "Track not found." };
    const project = resolve && resolve.projectName ? await resolve.projectName() : "";
    const license = {
      id: crypto.randomUUID(),
      trackId,
      project: project || "Unassigned project",
      note: String(note || "").slice(0, 240),
      terms: current.license,
      createdAt: new Date().toISOString(),
    };
    state.licenses.unshift(license);
    save();
    return ok(await withProject(publicState()), { license });
  }

  function removeLicense(id) {
    state.licenses = state.licenses.filter((item) => item.id !== id);
    save();
    return ok(publicState());
  }

  async function place(payload) {
    const current = track(payload.trackId);
    if (!current) return { ok: false, error: "Track not found." };
    const localPath = await ensureLocalAudio(current, payload);
    if (!localPath) return { ok: false, error: "Could not download that Audiio cue." };
    const startSec = Math.max(0, Number(payload.startSec) || 0);
    const endSec = Math.min(current.duration || startSec + 0.25, Number(payload.endSec) || current.duration || startSec + 0.25);
    if (endSec - startSec < 0.05) return { ok: false, error: "Select a longer region." };
    if (!resolve || !resolve.place) {
      return { ok: false, error: "Open Cuewell from Workspace > Workflow Integrations inside DaVinci Resolve Studio to place audio on the timeline." };
    }
    const result = await resolve.place({
      path: localPath,
      title: payload.stem ? `${current.title} (${payload.stem})` : current.title,
      startSec,
      endSec,
      poolOnly: Boolean(payload.poolOnly),
      audioTrack: payload.audioTrack || 0,
    });
    if (!result || result.ok === false) {
      return { ok: false, error: (result && (result.error || result.message)) || "Resolve did not place that cue.", state: await withProject(publicState()) };
    }
    return ok(await withProject(publicState()), result);
  }

  async function matchReference(payload) {
    if (payload.filePath) {
      const file = path.resolve(payload.filePath);
      if (!fs.existsSync(file) || !audio.isAudioFile(file)) return { ok: false, error: "Choose an audio file to match." };
      const info = audio.inspectAudio(file);
      if (!info) return { ok: false, error: "Could not read that audio file." };
      const probe = audio.trackFromFile(file, info);
      probe.id = "probe";
      const ranked = catalog.similarTracks(state.tracks.concat([probe]), probe.id, 12);
      return ok(publicState(), {
        explanation: `Matched from the audio of ${path.basename(file)}. The file was not copied into the library.`,
        trackIds: ranked.map((row) => row.track.id),
      });
    }
    const text = String(payload.text || "").trim();
    if (!text) return { ok: false, error: "Paste a description or a public link." };
    let query = text;
    let explanation = "Matched from your description.";
    if (/^https?:\/\//i.test(text)) {
      const fetched = await fetchReference(text);
      if (!fetched.ok) return fetched;
      query = fetched.text;
      explanation = fetched.explanation;
    }
    const ranked = catalog.rankByPrompt(state.tracks, query);
    return ok(publicState(), {
      explanation,
      understood: ranked.understood,
      trackIds: ranked.results.slice(0, 12).map((row) => row.track.id),
    });
  }

  async function connectAudiio() {
    if (!audiioLogin) {
      return { ok: false, error: "Sign in from the Resolve panel. Cuewell opens Audiio’s own login page there." };
    }
    const login = await audiioLogin();
    if (!login || !login.token) return { ok: false, error: "Sign-in was closed before Audiio set a session." };
    try {
      return await adoptAudiioSession(login);
    } catch (error) {
      return { ok: false, error: error.message || "Audiio rejected that session." };
    }
  }

  async function adoptAudiioSession(login) {
    let token = login.token;
    let verified = null;
    try {
      verified = await audiio.verify(token);
    } catch (error) {
      if (login.refreshToken && login.accountId) {
        const refreshed = await audiio.refresh(login.accountId, login.refreshToken);
        token = refreshed.token || token;
        verified = await audiio.verify(token);
      } else {
        throw error;
      }
    }
    audiioSession = {
      token,
      refreshToken: login.refreshToken || audiioSession.refreshToken || "",
      accountId: login.accountId || null,
      account: audiio.publicAccount(verified, login),
    };
    const temporary = `${audiioPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(audiioSession, null, 2));
    fs.renameSync(temporary, audiioPath);
    emit();
    const browse = await browseAudiio({ page: 1 });
    return browse.ok ? browse : ok(publicState());
  }

  async function disconnectAudiio() {
    if (audiioLogout) {
      try { await audiioLogout(); } catch { /* the local session is still removed */ }
    }
    audiioSession = {};
    audiioCache = [];
    audiioTracks = [];
    audiioTotal = 0;
    audiioPage = 1;
    fs.rmSync(audiioPath, { force: true });
    emit();
    return ok(publicState());
  }

  function requireAudiio() {
    if (!audiioSession.token || !audiioSession.account) {
      const error = new Error("Sign in to Audiio first.");
      error.status = 401;
      throw error;
    }
    return audiioSession.token;
  }

  async function browseAudiio(payload) {
    const token = requireAudiio();
    const result = await audiio.search({
      term: payload.term || payload.query || "",
      genre: payload.genre || "",
      mood: payload.mood || "",
      sort: payload.sort || "",
      page: payload.page || 1,
      limit: payload.limit || 24,
    }, token);
    rememberAudiio(result.tracks, true);
    audiioTotal = result.total;
    audiioPage = result.page;
    emit();
    return ok(publicState(), { total: result.total, page: result.page, count: result.tracks.length });
  }

  async function loadAudiioFavorites(page = 1) {
    const token = requireAudiio();
    const tracks = await audiio.favorites(token, page || 1);
    rememberAudiio(tracks, true);
    state.favorites = tracks.map((item) => item.id);
    save();
    return ok(publicState(), { count: tracks.length });
  }

  async function loadAudiioPlaylists() {
    const token = requireAudiio();
    const playlists = await audiio.userPlaylists(token, audiioSession.account.uuid);
    state.playlists = playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      audiioId: playlist.audiioId,
      trackIds: [],
      source: "audiio",
      createdAt: new Date().toISOString(),
    }));
    save();
    return ok(publicState(), { count: playlists.length });
  }

  async function loadAudiioPlaylistTracks(id) {
    const playlist = state.playlists.find((item) => item.id === id);
    if (!playlist || !playlist.audiioId) return { ok: false, error: "That is not an Audiio playlist." };
    const tracks = await audiio.playlistTracks(requireAudiio(), playlist.audiioId);
    rememberAudiio(tracks, true);
    playlist.trackIds = tracks.map((item) => item.id);
    save();
    return ok(publicState(), { count: tracks.length });
  }

  async function audiioSimilar(id) {
    const current = track(id);
    if (!current || !current.audiioId) return { ok: false, error: "Choose an Audiio cue first." };
    const tracks = await audiio.similar(current.audiioId, requireAudiio());
    rememberAudiio(tracks, true);
    emit();
    return ok(publicState(), { trackIds: tracks.map((item) => item.id) });
  }

  async function audiioAsk(prompt) {
    if (!String(prompt || "").trim()) return { ok: false, error: "Describe the cue you want." };
    const tracks = await audiio.ask(String(prompt).trim(), requireAudiio());
    rememberAudiio(tracks, true);
    emit();
    return ok(publicState(), { trackIds: tracks.map((item) => item.id), count: tracks.length });
  }

  async function audiioMatch(link) {
    if (!String(link || "").trim()) return { ok: false, error: "Paste a reference link." };
    const tracks = await audiio.matchLink(String(link).trim(), requireAudiio());
    rememberAudiio(tracks, true);
    emit();
    return ok(publicState(), { trackIds: tracks.map((item) => item.id), explanation: "Audiio LinkMatch results for that link." });
  }

  async function audiioFavorite(id) {
    const current = track(id);
    if (!current || !current.audiioId) return toggleFavorite(id);
    await audiio.setFavorite(requireAudiio(), current.audiioId, false);
    if (state.favorites.includes(id)) state.favorites = state.favorites.filter((item) => item !== id);
    else state.favorites.unshift(id);
    save();
    return ok(publicState(), { favorite: state.favorites.includes(id) });
  }

  async function ensureLocalAudio(current, payload) {
    if (current.path && fs.existsSync(current.path)) return current.path;
    const stem = (current.stems || []).find((item) => item.type === payload.stem);
    let url = stem ? stem.url : current.remoteUrl;
    let suffix = stem ? stem.type : "mix";
    if (payload.master) {
      if (!audiio.canDownloadMaster(audiioSession.account)) {
        throw new Error("Full WAV download is available when the signed-in Audiio account includes it. This session can place the preview mix.");
      }
      url = audiio.masterUrl(current);
      suffix = "wav";
    }
    if (!url) return "";
    const extension = payload.master ? "wav" : "mp3";
    const file = path.join(dataDir, "cache", `${current.audiioId || "cue"}-${suffix}.${extension}`);
    if (!fs.existsSync(file)) await audiio.cacheDownload(url, file);
    return file;
  }

  function replace(next) {
    const index = state.tracks.findIndex((item) => item.id === next.id);
    if (index >= 0) state.tracks[index] = next;
  }

  function dropIds(removed) {
    state.favorites = state.favorites.filter((id) => !removed.has(id));
    state.recent = state.recent.filter((id) => !removed.has(id));
    for (const playlist of state.playlists) playlist.trackIds = playlist.trackIds.filter((id) => !removed.has(id));
  }

  async function withProject(body) {
    let resolveProject = null;
    if (resolve && resolve.projectName) {
      try {
        resolveProject = await resolve.projectName();
      } catch {
        resolveProject = null;
      }
    }
    return { ...body, resolveProject };
  }

  function ok(body, result) {
    return { ok: true, state: body, result: result || null };
  }

  return {
    dataDir,
    token: session.token,
    handle,
    track,
    getState: publicState,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function mergeTrack(existing, fresh) {
  if (!existing.locked) return { ...fresh, id: existing.id, createdAt: existing.createdAt };
  return {
    ...fresh,
    id: existing.id,
    createdAt: existing.createdAt,
    title: existing.title,
    artist: existing.artist,
    genres: existing.genres,
    moods: existing.moods,
    tags: existing.tags,
    bpm: existing.bpm,
    key: existing.key,
    vocals: existing.vocals,
    energy: existing.energy,
    description: existing.description,
    license: existing.license,
    locked: true,
  };
}

function emptyLibrary() {
  return {
    revision: 0,
    folders: [],
    tracks: [],
    favorites: [],
    recent: [],
    playlists: [],
    licenses: [],
    lan: false,
  };
}

function loadJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return { ...fallback };
  }
}

function writeJson(file, value) {
  if (Object.prototype.hasOwnProperty.call(value, "revision")) value.revision = (value.revision || 0) + 1;
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

function safeDir(folder) {
  try {
    const resolved = fs.realpathSync(folder);
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function audioList(value) {
  const source = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(source.map((item) => String(item).trim().toLowerCase()).filter(Boolean))].slice(0, 8);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function cleanName(name, fallback) {
  const text = String(name || "").trim().slice(0, 80);
  return text || fallback;
}

function uniqueExisting(ids) {
  const seen = new Set();
  const result = [];
  for (const id of ids || []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

async function fetchReference(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "That link is not a valid URL." };
  }
  if (!isPublicHttp(url)) return { ok: false, error: "Use a public http or https link. Local and private addresses are blocked." };
  const host = url.hostname.toLowerCase();
  try {
    if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const data = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(input)}`);
      const text = `${data.title || ""} ${data.author_name || ""}`.trim();
      return { ok: true, text, explanation: `Matched from the YouTube title “${data.title || "untitled"}”. The video was not downloaded.` };
    }
    if (host.endsWith("spotify.com") || host.endsWith("spotify.link")) {
      const data = await fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(input)}`);
      const text = `${data.title || ""} ${data.author_name || ""}`.trim();
      return { ok: true, text, explanation: `Matched from the Spotify title “${data.title || "untitled"}”. The song was not downloaded.` };
    }
    const page = await fetchText(input);
    const title = metaContent(page, "og:title") || tagText(page, "title");
    const description = metaContent(page, "og:description") || "";
    const text = `${title} ${description}`.trim();
    if (!text) return { ok: false, error: "That page did not include a title to match." };
    return { ok: true, text, explanation: `Matched from the page title “${title}”. The page audio was not downloaded.` };
  } catch (error) {
    return { ok: false, error: `Could not read that link (${error.message}). Paste a description instead.` };
  }
}

function isPublicHttp(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (match) {
    const parts = match.slice(1).map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return false;
  }
  if (host.includes(":")) return false;
  return true;
}

async function fetchJson(url) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "user-agent": "Cuewell/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "user-agent": "Cuewell/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (type && !/text|json|xml|html/i.test(type)) throw new Error("not a text page");
  const text = await response.text();
  return text.slice(0, 180000);
}

function metaContent(html, property) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i");
  const match = pattern.exec(html);
  return match ? decode(match[1] || match[2] || "") : "";
}

function tagText(html, tag) {
  const match = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i").exec(html);
  return match ? decode(match[1]) : "";
}

function decode(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

module.exports = {
  createEngine,
  defaultDataDir,
  isPublicHttp,
};
