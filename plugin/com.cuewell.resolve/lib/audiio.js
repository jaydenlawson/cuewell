"use strict";

const fs = require("fs");
const path = require("path");

const API = "https://audiio.com/api/";
const MASTER_HOST = "https://d2t2ss1zux7287.cloudfront.net";
const PEAKS = 160;

const GENRES = ["acoustic", "ambient", "cinematic", "classical", "country", "electronic", "folk", "hiphop", "indie", "jazz", "lofi", "pop", "rb", "rock", "soul"];
const MOODS = ["calm", "chill", "epic", "happy", "hopeful", "romantic", "tense", "upbeat", "uplifting"];

function buildQuery({ term, genre, mood, sort, page, limit } = {}) {
  const params = new URLSearchParams();
  params.set("page", String(page || 1));
  params.set("limit", String(Math.min(48, Math.max(1, limit || 24))));
  if (term) params.set("term", String(term).trim());
  if (genre) params.set("genre", genre);
  if (mood) params.set("mood", mood);
  if (sort && sort !== "title" && sort !== "match") params.set("sort", sort === "energy" ? "newest" : sort);
  return params.toString();
}

async function api(pathname, { token, method = "GET", body } = {}) {
  const headers = { accept: "application/json", "user-agent": "Cuewell/1.0" };
  if (body) headers["content-type"] = "application/json";
  if (token) headers.authorization = token;
  const response = await fetch(`${API}${String(pathname).replace(/^\//, "")}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text.slice(0, 240) };
  }
  if (!response.ok) {
    const error = new Error((data && (data.message || data.error)) || `Audiio returned ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function flags(raw, prefix) {
  return Object.keys(raw || {})
    .filter((key) => key.startsWith(prefix) && raw[key] === true)
    .map((key) => key.slice(prefix.length));
}

function waveform(jsonField) {
  let text = "";
  if (!jsonField) return [];
  if (typeof jsonField === "string") text = jsonField;
  else if (jsonField.type === "Buffer" && Array.isArray(jsonField.data)) text = Buffer.from(jsonField.data).toString("utf8");
  if (!text.startsWith("[")) return [];
  let values = [];
  try {
    values = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(values) || !values.length) return [];
  const peaks = [];
  for (let bucket = 0; bucket < PEAKS; bucket += 1) {
    const start = Math.floor((bucket * values.length) / PEAKS);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * values.length) / PEAKS));
    let max = 0;
    for (let index = start; index < end; index += 1) max = Math.max(max, Number(values[index]) || 0);
    peaks.push(Math.round(Math.min(1, max) * 1000) / 1000);
  }
  return peaks;
}

function mapTrack(raw) {
  if (!raw || raw.id == null) return null;
  const artist = raw.artist || {};
  const album = raw.album || {};
  const stems = (raw.stems || [])
    .filter((stem) => stem && stem.url && stem.type && stem.type !== "fullMix")
    .map((stem) => ({
      type: stem.type,
      label: stem.label || stem.type,
      url: stem.url,
    }));
  const slug = raw.slug || "";
  const pageUrl = artist.slug && album.slug && slug
    ? `https://audiio.com/${artist.slug}/${album.slug}/${slug}`
    : "https://audiio.com";
  return {
    id: `audiio:${raw.id}`,
    source: "audiio",
    audiioId: raw.id,
    title: raw.title || "Untitled",
    artist: artist.name || "Audiio",
    artistSlug: artist.slug || "",
    albumSlug: album.slug || "",
    slug,
    path: "",
    remoteUrl: raw.song || "",
    masterPath: raw.sound_pro || "",
    duration: Number(raw.duration) || 0,
    bpm: raw.bpm || null,
    key: raw.musical_key || "",
    genres: raw.genres || flags(raw, "genre_"),
    moods: flags(raw, "mood_"),
    tags: flags(raw, "theme_"),
    vocals: raw.vocal_none === false,
    energy: null,
    description: album.title ? `From ${album.title}` : "",
    license: "Use is covered only by your Audiio membership. Placing a cue does not create the license by itself.",
    peaks: waveform(raw.json),
    features: null,
    stems,
    thumbnail: raw.thumbnail || "",
    pageUrl,
    createdAt: raw.created_at || "",
  };
}

function mapList(data) {
  const rows = Array.isArray(data)
    ? data
    : (data && (data.tracks || data.favorites || data.results || data.playlists || data.userPlaylists)) || [];
  return rows.map((row) => mapTrack(row.track || row)).filter(Boolean);
}

async function search(options, token) {
  const data = await api(`tracks?${buildQuery(options)}`, { token });
  return {
    tracks: (data.tracks || []).map(mapTrack).filter(Boolean),
    total: Number(data.total) || 0,
    page: Number(data.page) || Number(options.page) || 1,
  };
}

async function verify(token) {
  return api(`auth/verify-token?token=${encodeURIComponent(token)}&_t=${Date.now()}`, { token });
}

async function refresh(accountId, refreshToken) {
  return api(`auth/refresh-token?accountId=${encodeURIComponent(accountId)}&refreshToken=${encodeURIComponent(refreshToken)}`);
}

function publicAccount(payload, extra = {}) {
  const account = (payload && (payload.account || payload.user)) || payload || {};
  const membership = (payload && payload.memberships) || account.membership || {};
  return {
    id: account.id || extra.accountId || null,
    uuid: account.uuid || extra.uuid || null,
    email: account.email || "",
    name: [account.first_name, account.last_name].filter(Boolean).join(" ") || account.name || account.email || "Audiio account",
    membership: {
      lifetime: Boolean(membership.lifetime),
      pro: Boolean(membership.pro || membership.isPro),
      lifetimeSfx: Boolean(membership.lifetimeSFX || membership.lifetimeSfx),
    },
  };
}

function canDownloadMaster(account) {
  const membership = account?.membership || {};
  return Boolean(membership.lifetime || membership.pro || membership.lifetimeSfx);
}

function masterUrl(track) {
  if (!track || !track.masterPath) return "";
  if (String(track.masterPath).startsWith("http")) return track.masterPath;
  const suffix = track.masterPath.startsWith("/") ? track.masterPath : `/${track.masterPath}`;
  return `${MASTER_HOST}${suffix}`;
}

async function favorites(token, page = 1) {
  const data = await api(`accounts/favorites?sfx=0&page=${page}`, { token });
  return mapList(data);
}

async function setFavorite(token, audiioId, isSfx = false) {
  return api(`tracks/${audiioId}/favorite`, { token, method: "POST", body: { isSfx } });
}

async function similar(audiioId, token) {
  const data = await api("tracks/ai/similar", { token, method: "POST", body: { track: { id: audiioId }, page: 1 } });
  return mapList(data);
}

async function ask(prompt, token) {
  const data = await api("hans/search", { token, method: "POST", body: { term: prompt } });
  return mapList(data);
}

async function matchLink(link, token) {
  const data = await api("tracks/ai/linkmatch", { token, method: "POST", body: { link, ignoreVocals: false } });
  return mapList(data);
}

async function playlistTracks(token, playlistId) {
  const data = await api(`playlists/user-playlist/tracks?page=1&id=${encodeURIComponent(playlistId)}`, { token });
  return mapList(data);
}

function mapSfx(raw) {
  if (!raw || raw.id == null) return null;
  const file = raw.title || "";
  const base = file.replace(/\.[^/.]+$/, "");
  let tags = [];
  if (Array.isArray(raw.genre)) tags = raw.genre;
  else if (typeof raw.genre === "string" && raw.genre) {
    try {
      const parsed = JSON.parse(raw.genre);
      tags = Array.isArray(parsed) ? parsed : [raw.genre];
    } catch {
      tags = [raw.genre];
    }
  }
  return {
    id: `sfx:${raw.id}`,
    source: "sfx",
    kind: "sfx",
    audiioId: raw.id,
    title: raw.comment || base || "Sound effect",
    artist: "Audiio SFX",
    path: "",
    remoteUrl: base ? `https://d2cx9kaw24fnh5.cloudfront.net/${base}.mp3` : "",
    masterPath: file ? `https://d2t2ss1zux7287.cloudfront.net/${file}` : "",
    duration: Number(raw.duration) || 0,
    bpm: null,
    key: "",
    genres: tags.map((tag) => String(tag).toLowerCase()),
    moods: [],
    tags: ["sfx"],
    vocals: false,
    energy: null,
    description: file,
    license: "Covered only by your Audiio sound-effects membership.",
    peaks: waveform(raw.json),
    features: null,
    stems: [],
    thumbnail: "",
    pageUrl: "https://audiio.com/sound-effects",
    createdAt: raw.created_at || "",
  };
}

async function searchSfx(options, token) {
  const params = new URLSearchParams();
  params.set("page", String(options.page || 1));
  params.set("limit", String(Math.min(48, Math.max(1, options.limit || 24))));
  if (options.term) params.set("search", String(options.term).trim());
  const data = await api(`sfx/?${params.toString()}`, { token });
  return {
    tracks: (data.sfxTracks || []).map(mapSfx).filter(Boolean),
    total: Number(data.total) || 0,
    page: Number(data.page) || Number(options.page) || 1,
  };
}

async function allFavorites(token, sfx = 0) {
  const tracks = [];
  let page = 1;
  let total = Infinity;
  while (tracks.length < total && page <= 20) {
    const data = await api(`accounts/favorites?sfx=${sfx ? 1 : 0}&page=${page}`, { token });
    const batch = (sfx ? (data.tracks || []).map(mapSfx) : mapList(data)).filter(Boolean);
    total = Number(data.total) || tracks.length + batch.length;
    tracks.push(...batch);
    if (!batch.length) break;
    page += 1;
  }
  return tracks;
}

function mapLicense(raw) {
  const track = raw.track ? mapTrack(raw.track) : null;
  return {
    id: `audiio-license:${raw.id}`,
    source: "audiio",
    trackId: track ? track.id : "",
    title: track ? track.title : `Track ${raw.track_id || ""}`.trim(),
    artist: track ? track.artist : "",
    project: raw.project || "",
    note: raw.order_number ? `#${raw.order_number}` : "",
    terms: raw.distribution || "",
    createdAt: raw.purchase_date || "",
    track,
  };
}

async function licenses(token) {
  const licenses = [];
  let page = 1;
  let total = Infinity;
  while (licenses.length < total && page <= 8) {
    const data = await api(`licenses?page=${page}&limit=50`, { token });
    const batch = (data.licenses || []).map(mapLicense).filter((item) => item.title);
    total = Number(data.meta && data.meta.totalLicenses) || licenses.length + batch.length;
    licenses.push(...batch);
    if (!batch.length) break;
    page += 1;
  }
  return { licenses, total };
}

async function userPlaylists(token, uuid) {
  if (!uuid) return [];
  const data = await api(`playlists/user-playlist/${encodeURIComponent(uuid)}`, { token });
  const rows = Array.isArray(data) ? data : (data.playlists || []);
  return rows.map((playlist) => ({
    id: String(playlist.uuid || playlist.id),
    name: playlist.title || playlist.name || "Playlist",
    uuid: playlist.uuid || "",
    audiioId: playlist.id,
  }));
}

async function cacheDownload(url, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Audiio audio returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000) throw new Error("Audiio returned an empty audio file.");
  fs.writeFileSync(file, bytes);
  return file;
}

module.exports = {
  GENRES,
  MOODS,
  ask,
  buildQuery,
  cacheDownload,
  canDownloadMaster,
  favorites,
  mapTrack,
  masterUrl,
  matchLink,
  publicAccount,
  refresh,
  search,
  setFavorite,
  similar,
  allFavorites,
  licenses,
  mapLicense,
  mapSfx,
  playlistTracks,
  searchSfx,
  userPlaylists,
  verify,
  waveform,
};
