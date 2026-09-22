"use strict";

const token = new URLSearchParams(location.search).get("token") || "";
const audio = new Audio();
const audioB = new Audio();
let state = null;
let refreshTimer = 0;
const ui = {
  view: "home",
  playlistId: null,
  query: "",
  sort: "title",
  genres: [],
  moods: [],
  vocals: "any",
  key: "",
  bpmMin: "",
  bpmMax: "",
  durationMin: "",
  durationMax: "",
  energyMin: "",
  energyMax: "",
  currentId: null,
  compareId: null,
  region: null,
  dragRegion: null,
  playing: false,
  side: "a",
  promptResults: [],
  matchIds: null,
  similarIds: null,
  page: 1,
  stem: null,
};

const $ = (id) => document.getElementById(id);

audio.addEventListener("timeupdate", drawWaves);
audio.addEventListener("ended", () => { ui.playing = false; paintTransport(); });
audioB.addEventListener("ended", () => { ui.playing = false; paintTransport(); });

document.querySelectorAll(".nav").forEach((button) => {
  button.addEventListener("click", () => {
    ui.view = button.dataset.view;
    ui.playlistId = null;
    ui.similarIds = null;
    ui.page = 1;
    if (state && state.account && ui.view === "favorites") run("audiioFavorites", {});
    else if (state && state.account && ui.view === "playlists") run("audiioPlaylists", {});
    else if (state && state.account && ui.view === "library") scheduleBrowse();
    else render();
  });
});

$("query").addEventListener("input", () => {
  ui.query = $("query").value;
  ui.page = 1;
  if (ui.view === "home" || ui.view === "files") ui.view = state && state.account ? "library" : "files";
  if (state && state.account) scheduleBrowse();
  else render();
});
$("signIn").addEventListener("click", () => run("audiioLogin", {}, (body) => `Signed in as ${body.state.account.name || body.state.account.email}.`));
$("signOut").addEventListener("click", () => run("audiioLogout", {}, "Signed out of Audiio."));
$("moreButton").addEventListener("click", () => {
  ui.page += 1;
  scheduleBrowse();
});
$("wavButton").addEventListener("click", () => place(false, { master: true }));
$("openFilters").addEventListener("click", () => {
  $("filters").classList.toggle("hidden");
  if (!$("filters").classList.contains("hidden")) renderFilters();
});
$("openAsk").addEventListener("click", () => $("askDialog").showModal());
$("openMatch").addEventListener("click", () => $("matchDialog").showModal());
$("openSync").addEventListener("click", () => {
  paintSync();
  $("syncDialog").showModal();
});
$("demoButton").addEventListener("click", () => run("generateDemo", {}, "Demo library ready."));
$("indexButton").addEventListener("click", indexFolder);
$("reindexButton").addEventListener("click", () => run("reindex", {}, "Library reindexed."));
$("folderPath").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.value.trim()) run("indexFolder", { folder: event.target.value.trim() }, "Folder indexed.");
});
$("playButton").addEventListener("click", togglePlay);
$("favoriteButton").addEventListener("click", () => current() && run(current().source === "audiio" ? "audiioFavorite" : "toggleFavorite", { id: current().id }));
$("similarButton").addEventListener("click", showSimilar);
$("compareButton").addEventListener("click", () => {
  if (!ui.compareId) {
    toast("Choose Compare on a second cue.");
    return;
  }
  ui.compareId = null;
  ui.side = "a";
  audioB.pause();
  render();
});
$("licenseButton").addEventListener("click", () => current() && run("licenseTrack", { trackId: current().id }, "Saved to the license log."));
$("audiioPageButton").addEventListener("click", () => current() && run("openAudiioPage", { id: current().id }, "Opened the Audiio page, where the official license form lives."));
$("poolButton").addEventListener("click", () => place(true));
$("placeButton").addEventListener("click", () => place(false));
$("dragButton").addEventListener("click", dragCurrent);
$("editButton").addEventListener("click", openEdit);
$("askRun").addEventListener("click", runAsk);
$("askSave").addEventListener("click", saveAsk);
$("matchRun").addEventListener("click", () => runMatch({ text: $("matchText").value }));
$("matchFile").addEventListener("click", matchFile);
$("lanToggle").addEventListener("change", () => run("setLan", { enabled: $("lanToggle").checked }, $("lanToggle").checked ? "Phone access is on." : "Phone access is off."));
$("copyLink").addEventListener("click", copyLink);
$("editSave").addEventListener("click", saveEdit);
$("csvLink").addEventListener("click", (event) => {
  event.preventDefault();
  window.location = `/licenses.csv?token=${encodeURIComponent(token)}`;
});

document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes(event.target.tagName);
  if (event.key === " " && !typing) {
    event.preventDefault();
    togglePlay();
  } else if (!typing && (event.key === "f" || event.key === "F") && current()) {
    run("toggleFavorite", { id: current().id });
  } else if (!typing && (event.key === "l" || event.key === "L") && current()) {
    run("licenseTrack", { trackId: current().id }, "Saved to the license log.");
  } else if (event.key === "Enter" && !typing && current()) {
    place(false);
  }
});

const wave = $("wave");
const waveB = $("waveB");
pointerSelect(wave, () => current(), true);
pointerSelect(waveB, () => trackById(ui.compareId), false);

boot().catch((error) => toast(error.message, true));

async function boot() {
  if (!token) {
    $("status").textContent = "Open Cuewell from Resolve, or use the sync link from a machine where it is already running.";
    return;
  }
  await refresh();
  if (state && state.account) scheduleBrowse();
  const events = new EventSource(`/events?token=${encodeURIComponent(token)}`);
  events.onmessage = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh().catch(() => {}), 150);
  };
}

async function refresh() {
  const response = await fetch("/api/state", { headers: authHeaders() });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load the library.");
  state = body.state || body;
  render();
}

async function run(name, payload, success) {
  try {
    const response = await fetch("/api/call", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ name, payload: payload || {} }),
    });
    const body = await response.json();
    if (body.state) state = body.state;
    if (!response.ok || body.ok === false) throw new Error(body.error || "Request failed.");
    render();
    if (success) toast(typeof success === "function" ? success(body) : success);
    return body;
  } catch (error) {
    toast(error.message, true);
    return null;
  }
}

function authHeaders() {
  return { "x-cuewell-token": token };
}

function render() {
  if (!state) return;
  $("countLibrary").textContent = String(state.account ? state.audiioTotal || (state.audiioTracks || []).length : state.tracks.length);
  $("accountTag").textContent = state.account
    ? `${state.account.name || state.account.email}${state.account.membership && state.account.membership.lifetime ? " · lifetime" : ""}`
    : "Sign in with your Audiio account";
  $("signIn").classList.toggle("hidden", Boolean(state.account));
  $("signOut").classList.toggle("hidden", !state.account);
  $("wavButton").classList.toggle("hidden", !(state.account && state.account.membership && (state.account.membership.lifetime || state.account.membership.pro)));
  $("countFavorites").textContent = String(state.favorites.length);
  $("countPlaylists").textContent = String(state.playlists.length);
  $("countLicensed").textContent = String(state.licenses.length);
  document.querySelectorAll(".nav").forEach((button) => button.classList.toggle("active", button.dataset.view === ui.view && !ui.playlistId));
  renderPlaylists();
  renderFilters();
  renderList();
  paintTransport();
  drawWaves();
  $("dragButton").classList.toggle("hidden", !(window.cuewell && window.cuewell.startDrag));
}

function renderPlaylists() {
  const nav = $("playlistNav");
  nav.replaceChildren();
  for (const playlist of state.playlists) {
    const button = buttonEl(playlist.name, "ghost", () => {
      ui.view = "playlist";
      ui.playlistId = playlist.id;
      ui.similarIds = null;
      if (playlist.source === "audiio") run("audiioPlaylistTracks", { id: playlist.id });
      else render();
    });
    if (ui.playlistId === playlist.id) button.classList.add("active");
    nav.append(button);
  }
}

function renderFilters() {
  const box = $("filters");
  if (box.classList.contains("hidden")) return;
  const catalog = window.CuewellCatalog;
  const genres = state.account
    ? ["acoustic", "ambient", "cinematic", "classical", "country", "electronic", "folk", "hiphop", "indie", "jazz", "lofi", "pop", "rock", "soul"]
    : catalog.uniqueSorted(state.tracks, "genres");
  const moods = state.account
    ? ["calm", "chill", "epic", "happy", "hopeful", "romantic", "tense", "upbeat"]
    : catalog.uniqueSorted(state.tracks, "moods");
  const keys = [...new Set(state.tracks.map((track) => track.key).filter(Boolean))].sort();
  box.replaceChildren();
  box.append(chipRow("Genres", genres, ui.genres, (value) => toggle(ui.genres, value)));
  box.append(chipRow("Moods", moods, ui.moods, (value) => toggle(ui.moods, value)));
  const grid = div("filter-grid");
  grid.append(selectField("Vocals", ["any", "vocals", "instrumental"], ui.vocals, (value) => { ui.vocals = value; render(); }));
  grid.append(selectField("Key", ["", ...keys], ui.key, (value) => { ui.key = value; render(); }));
  grid.append(selectField("Sort", ["title", "match", "bpm", "duration", "newest"], ui.sort, (value) => {
    ui.sort = value;
    ui.page = 1;
    if (state.account && ui.view !== "files") scheduleBrowse();
    else render();
  }));
  grid.append(numberField("BPM min", ui.bpmMin, (value) => { ui.bpmMin = value; render(); }));
  grid.append(numberField("BPM max", ui.bpmMax, (value) => { ui.bpmMax = value; render(); }));
  grid.append(numberField("Seconds min", ui.durationMin, (value) => { ui.durationMin = value; render(); }));
  grid.append(numberField("Seconds max", ui.durationMax, (value) => { ui.durationMax = value; render(); }));
  grid.append(numberField("Energy min", ui.energyMin, (value) => { ui.energyMin = value; render(); }));
  grid.append(numberField("Energy max", ui.energyMax, (value) => { ui.energyMax = value; render(); }));
  box.append(grid);
}

function renderList() {
  const list = $("list");
  const status = $("status");
  list.replaceChildren();
  if (!state.account && ui.view !== "files" && !state.tracks.length) {
    status.textContent = "Sign in to search your Audiio catalog. My files still holds a local library.";
    return;
  }
  if (!state.account && ui.view !== "files") {
    status.textContent = "Sign in to Audiio to search, preview, favorite, and place that catalog. My files is the local library.";
  }
  if (state.account && ui.view === "home" && !ui.query) {
    status.textContent = `${state.account.name}. ${state.audiioTotal || 0} cues in the Audiio catalog.`;
    list.append(homeBlock("From your Audiio catalog", state.audiioTracks || []));
    return;
  }
  if (ui.view === "home" && !ui.query && !ui.similarIds && !ui.matchIds) {
    status.textContent = state.resolveProject ? `Project: ${state.resolveProject}` : "Favorites, playlists, and licensed cues stay in this library.";
    list.append(homeBlock("Recently previewed", idsToTracks(state.recent)));
    list.append(homeBlock("Favorites", idsToTracks(state.favorites).slice(0, 6)));
    list.append(homeBlock("Playlists", []));
    const playlistBlock = list.lastChild;
    if (!state.playlists.length) playlistBlock.append(p("No playlists yet. Ask for a cue and save the results."));
    for (const playlist of state.playlists.slice(0, 6)) {
      playlistBlock.append(buttonEl(`${playlist.name} · ${playlist.trackIds.length}`, "ghost", () => {
        ui.view = "playlist";
        ui.playlistId = playlist.id;
        render();
      }));
    }
    const licensed = state.resolveProject
      ? state.licenses.filter((license) => license.project === state.resolveProject)
      : state.licenses;
    list.append(homeBlock(state.resolveProject ? "Licensed in this project" : "Licensed songs", []));
    const licenseBlock = list.lastChild;
    renderLicenses(licenseBlock, licensed.slice(0, 8));
    return;
  }
  const tracks = shownTracks();
  status.textContent = statusText(tracks);
  if (!tracks.length) {
    list.append(p("Nothing matches. Clear a filter, or describe the cue with Ask."));
    return;
  }
  for (const track of tracks) list.append(trackRow(track));
  if (ui.view === "licensed") renderLicenses(list, state.licenses);
}

function catalogTracks() {
  if (ui.view === "files" || !state.account) return state.tracks;
  return state.audiioTracks || [];
}

function shownTracks() {
  const catalog = window.CuewellCatalog;
  if (ui.similarIds) return idsToTracks(ui.similarIds);
  if (ui.view === "ask") return ui.promptResults;
  if (ui.view === "match" && ui.matchIds) return idsToTracks(ui.matchIds);
  let ids = null;
  let order = null;
  if (ui.view === "favorites") ids = state.favorites;
  if (ui.view === "licensed") ids = [...new Set(state.licenses.map((license) => license.trackId))];
  if (ui.view === "playlist") {
    const playlist = state.playlists.find((item) => item.id === ui.playlistId);
    ids = playlist ? playlist.trackIds : [];
    order = ids;
  }
  return catalog.searchTracks(catalogTracks(), {
    query: ui.query,
    ids,
    order,
    genres: ui.genres,
    moods: ui.moods,
    vocals: ui.vocals,
    key: ui.key,
    bpmMin: numOrNull(ui.bpmMin),
    bpmMax: numOrNull(ui.bpmMax),
    durationMin: numOrNull(ui.durationMin),
    durationMax: numOrNull(ui.durationMax),
    energyMin: ui.energyMin === "" ? null : Number(ui.energyMin) / 100,
    energyMax: ui.energyMax === "" ? null : Number(ui.energyMax) / 100,
    sort: ui.sort,
  });
}

function statusText(tracks) {
  if (ui.similarIds && current()) return `Similar to ${current().title}`;
  if (ui.view === "ask") return "Results from your description.";
  if (ui.view === "match") return $("matchNote").textContent || "Reference matches.";
  if (ui.view === "playlist") {
    const playlist = state.playlists.find((item) => item.id === ui.playlistId);
    return playlist ? playlist.name : "Playlist";
  }
  return `${tracks.length} cue${tracks.length === 1 ? "" : "s"}`;
}

function trackRow(track) {
  const row = document.createElement("article");
  row.className = `track${track.id === ui.currentId ? " current" : ""}`;
  const spark = document.createElement("canvas");
  spark.className = "spark";
  spark.width = 72;
  spark.height = 36;
  drawPeaks(spark, track.peaks, null, 0, track.duration);
  const text = div("");
  text.append(div("title", track.title));
  text.append(p(`${track.artist} · ${formatTime(track.duration)} · ${track.bpm ? `${track.bpm} bpm` : "bpm unknown"} · ${track.key || "key unknown"} · ${(track.moods || []).slice(0, 2).join(", ") || "untagged"}`));
  const actions = div("row-actions");
  actions.append(buttonEl(track.id === ui.currentId && ui.playing ? "Pause" : "Preview", "ghost", () => preview(track.id)));
  actions.append(buttonEl(state.favorites.includes(track.id) ? "Favorited" : "Favorite", "ghost", () => run(track.source === "audiio" ? "audiioFavorite" : "toggleFavorite", { id: track.id })));
  actions.append(buttonEl("Similar", "ghost", () => { ui.currentId = track.id; showSimilar(); }));
  actions.append(buttonEl("Compare", "ghost", () => setCompare(track.id)));
  actions.append(buttonEl("License", "ghost", () => run("licenseTrack", { trackId: track.id }, "Saved to the license log.")));
  actions.append(buttonEl("Timeline", "", () => { ui.currentId = track.id; ui.region = null; place(false); }));
  if (state.playlists.length) {
    const menu = document.createElement("select");
    menu.append(new Option("Add to playlist", ""));
    for (const playlist of state.playlists) menu.append(new Option(playlist.name, playlist.id));
    menu.addEventListener("change", () => {
      if (menu.value) run("addToPlaylist", { playlistId: menu.value, trackId: track.id }, "Added to playlist.");
    });
    actions.append(menu);
  }
  row.append(spark, text, actions);
  row.addEventListener("dblclick", () => preview(track.id));
  if (window.cuewell && window.cuewell.startDrag) {
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      event.preventDefault();
      window.cuewell.startDrag(track.id);
    });
  }
  return row;
}

function homeBlock(title, tracks) {
  const block = div("home-block");
  block.append(el("h2", "", title));
  if (tracks.length) {
    for (const track of tracks) block.append(trackRow(track));
  } else if (title.startsWith("Recent") || title.startsWith("Fav")) {
    block.append(p(title.startsWith("Recent") ? "Preview a cue and it will wait here." : "Mark a cue with Favorite and it syncs to this list."));
  }
  return block;
}

function renderLicenses(parent, licenses) {
  if (!licenses.length) {
    parent.append(p("Nothing licensed yet. License stores the track, the Resolve project name, and the terms."));
    return;
  }
  for (const license of licenses) {
    const track = trackById(license.trackId);
    const row = div("license-row");
    const text = div("");
    text.append(div("title", track ? track.title : "Missing track"));
    text.append(p(`${license.project} · ${new Date(license.createdAt).toLocaleString()} · ${license.terms}`));
    row.append(text, buttonEl("Remove", "ghost", () => run("removeLicense", { id: license.id })));
    parent.append(row);
  }
}

function paintTransport() {
  const track = current();
  $("playButton").textContent = ui.playing ? "Pause" : "Play";
  $("nowTitle").textContent = track ? track.title : "Nothing playing";
  const compare = trackById(ui.compareId);
  if (!track) {
    $("nowMeta").textContent = "Preview a cue, compare two, then license it and drop it on the timeline.";
  } else {
    const region = activeRegion(track);
    const regionText = ui.region ? `Region ${formatTime(region.start)}–${formatTime(region.end)}. ` : "";
    const compareText = compare && compare.id !== track.id ? `Comparing with ${compare.title}. ` : "";
    $("nowMeta").textContent = `${regionText}${compareText}${track.artist}. ${track.license}`;
  }
  $("favoriteButton").textContent = track && state.favorites.includes(track.id) ? "Favorited" : "Favorite";
  const stems = $("stems");
  stems.replaceChildren();
  if (track && track.stems && track.stems.length) {
    stems.append(buttonEl("Full mix", ui.stem ? "" : "on", () => { ui.stem = null; reloadPreview(); }));
    for (const stem of track.stems) {
      const selected = ui.stem && ui.stem.trackId === track.id && ui.stem.type === stem.type;
      stems.append(buttonEl(stem.label, selected ? "on" : "", () => {
        ui.stem = { trackId: track.id, type: stem.type };
        reloadPreview();
      }));
    }
  }
  $("compareButton").textContent = ui.compareId ? "Clear compare" : "Compare";
  waveB.classList.toggle("hidden", !compare || compare.id === (track && track.id));
}

function preview(id) {
  ui.side = "a";
  if (ui.currentId !== id) {
    ui.currentId = id;
    ui.region = null;
    ui.playing = false;
    audio.src = mediaUrl(id);
    run("noteRecent", { id }).then(() => {
      audio.play().then(() => { ui.playing = true; paintTransport(); }).catch(() => {});
    });
    return;
  }
  togglePlay();
}

function togglePlay() {
  const track = ui.side === "b" ? trackById(ui.compareId) : current();
  const active = ui.side === "b" ? audioB : audio;
  if (!track) return;
  if (!active.src) active.src = mediaUrl(track.id);
  if (active.paused) {
    const region = activeRegion(track);
    if (ui.region && (active.currentTime < region.start || active.currentTime >= region.end)) active.currentTime = region.start;
    active.play().then(() => { ui.playing = true; paintTransport(); }).catch((error) => toast(error.message, true));
  } else {
    active.pause();
    ui.playing = false;
    paintTransport();
  }
}

function setCompare(id) {
  if (!ui.currentId || ui.currentId === id) {
    ui.currentId = id;
    ui.compareId = null;
  } else {
    ui.compareId = id;
    audioB.src = mediaUrl(id);
  }
  render();
}

function showSimilar() {
  const track = current();
  if (!track) return;
  if (track.source === "audiio") {
    ui.similarIds = null;
    ui.view = "library";
    run("audiioSimilar", { id: track.id }, "Similar Audiio cues.");
    return;
  }
  ui.similarIds = window.CuewellCatalog.similarTracks(state.tracks, track.id, 12).map((row) => row.track.id);
  ui.view = "files";
  render();
}

function runAsk() {
  if (state && state.account) {
    run("audiioAsk", { prompt: $("prompt").value }, "Audiio search results.").then((body) => {
      if (!body) return;
      ui.view = "library";
      ui.similarIds = null;
      $("askDialog").close();
      render();
    });
    return;
  }
  const ranked = window.CuewellCatalog.rankByPrompt(state.tracks, $("prompt").value);
  ui.promptResults = ranked.results.map((row) => row.track);
  ui.view = "ask";
  $("askUnderstood").textContent = ranked.understood.length
    ? `Understood: ${ranked.understood.join(", ")}`
    : "No musical keywords recognized, so this falls back to text search.";
  $("askDialog").close();
  render();
}

function saveAsk() {
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  run("playlistFromPrompt", { prompt, name: prompt.slice(0, 80) }, (body) => `Playlist “${body.result.playlist.name}” saved.`).then((body) => {
    if (!body) return;
    ui.view = "playlist";
    ui.playlistId = body.result.playlist.id;
    $("askDialog").close();
    render();
  });
}

async function runMatch(payload) {
  if (state && state.account && payload.text && /^https?:\/\//i.test(payload.text)) {
    const body = await run("audiioMatch", { link: payload.text });
    if (!body) return;
    ui.view = "library";
    $("matchNote").textContent = (body.result && body.result.explanation) || "";
    $("matchDialog").close();
    render();
    return;
  }
  const body = await run("matchReference", payload);
  if (!body) return;
  ui.matchIds = body.result.trackIds;
  ui.view = "match";
  $("matchNote").textContent = body.result.explanation || "";
  $("matchDialog").close();
  render();
  $("status").textContent = body.result.explanation || "";
}

async function matchFile() {
  if (window.cuewell && window.cuewell.chooseFile) {
    const file = await window.cuewell.chooseFile();
    if (file) runMatch({ filePath: file });
    return;
  }
  toast("Choosing a reference file is available in the Resolve panel. Paste a description or public link here.", true);
}

async function indexFolder() {
  let folder = $("folderPath").value.trim();
  if (window.cuewell && window.cuewell.chooseFolder) {
    const picked = await window.cuewell.chooseFolder();
    if (picked) folder = picked;
  }
  if (!folder) {
    toast("Choose a folder, or paste its path.", true);
    return;
  }
  $("folderPath").value = folder;
  run("indexFolder", { folder }, (body) => `Indexed ${body.result.scanned} files, ${body.result.added} new.`);
}

function place(poolOnly, extra = {}) {
  const track = current();
  if (!track) return;
  const region = activeRegion(track);
  run("place", {
    trackId: track.id,
    startSec: region.start,
    endSec: region.end,
    poolOnly,
    stem: ui.stem && ui.stem.trackId === track.id ? ui.stem.type : "",
    master: Boolean(extra.master),
  }, (body) => body.result && body.result.message ? body.result.message : (poolOnly ? "Added to the media pool." : "Placed at the playhead."));
}

let browseTimer = 0;
function scheduleBrowse() {
  clearTimeout(browseTimer);
  browseTimer = setTimeout(() => {
    run("audiioBrowse", {
      query: ui.query,
      genre: ui.genres[0] || "",
      mood: ui.moods[0] || "",
      sort: ui.sort === "title" || ui.sort === "match" ? "" : ui.sort,
      page: ui.page,
    });
  }, 280);
}

function dragCurrent() {
  const track = current();
  if (!track || !window.cuewell || !window.cuewell.startDrag) {
    toast("Drag onto the timeline from the Resolve panel.", true);
    return;
  }
  window.cuewell.startDrag(track.id);
}

function openEdit() {
  const track = current();
  if (!track) return;
  $("editTitle").value = track.title || "";
  $("editArtist").value = track.artist || "";
  $("editGenres").value = (track.genres || []).join(", ");
  $("editMoods").value = (track.moods || []).join(", ");
  $("editTags").value = (track.tags || []).join(", ");
  $("editBpm").value = track.bpm || "";
  $("editKey").value = track.key || "";
  $("editEnergy").value = track.energy == null ? "" : Math.round(track.energy * 100);
  $("editVocals").checked = Boolean(track.vocals);
  $("editDescription").value = track.description || "";
  $("editLicense").value = track.license || "";
  $("editDialog").showModal();
}

function saveEdit() {
  const track = current();
  if (!track) return;
  run("updateTrack", {
    id: track.id,
    patch: {
      title: $("editTitle").value,
      artist: $("editArtist").value,
      genres: $("editGenres").value,
      moods: $("editMoods").value,
      tags: $("editTags").value,
      bpm: $("editBpm").value,
      key: $("editKey").value,
      energy: $("editEnergy").value === "" ? "" : Number($("editEnergy").value) / 100,
      vocals: $("editVocals").checked,
      description: $("editDescription").value,
      license: $("editLicense").value,
    },
  }, "Track details saved.").then(() => $("editDialog").close());
}

function paintSync() {
  const connection = state && state.connection;
  $("lanToggle").checked = Boolean(state && state.lan);
  const box = $("syncLinks");
  box.replaceChildren();
  if (!connection) return;
  box.append(p(connection.localUrl));
  for (const url of connection.networkUrls || []) box.append(p(url));
  if (state.lan && !(connection.networkUrls || []).length) box.append(p("No other network address was found."));
}

function copyLink() {
  const connection = state && state.connection;
  const link = (state.lan && connection.networkUrls && connection.networkUrls[0]) || (connection && connection.localUrl) || "";
  if (!link) return;
  navigator.clipboard.writeText(link).then(() => toast("Link copied.")).catch(() => toast(link));
}

function drawWaves() {
  const track = current();
  drawPeaks(wave, track && track.peaks, ui.region, audio.src && ui.side !== "b" ? audio.currentTime : 0, track && track.duration);
  const other = trackById(ui.compareId);
  if (other && track && other.id !== track.id) {
    drawPeaks(waveB, other.peaks, null, audioB.currentTime, other.duration);
  }
}

function drawPeaks(canvas, peaks, region, time, duration) {
  const width = canvas.clientWidth || 300;
  const height = canvas.height;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#100e0c";
  context.fillRect(0, 0, width, height);
  if (!peaks || !peaks.length) return;
  if (region && duration) {
    context.fillStyle = "rgba(227, 154, 69, 0.18)";
    context.fillRect((region.start / duration) * width, 0, ((region.end - region.start) / duration) * width, height);
  }
  context.fillStyle = "#e39a45";
  const column = width / peaks.length;
  peaks.forEach((peak, index) => {
    const bar = Math.max(1, peak * (height - 4));
    context.fillRect(index * column, (height - bar) / 2, Math.max(1, column - 1), bar);
  });
  if (duration && time) {
    context.fillStyle = "#f6f1e8";
    context.fillRect((time / duration) * width, 0, 1, height);
  }
}

function pointerSelect(canvas, getTrack, selectsRegion) {
  let origin = null;
  canvas.addEventListener("pointerdown", (event) => {
    const track = getTrack();
    if (!track) return;
    origin = { x: event.clientX, time: timeAt(event, canvas, track.duration) };
    if (selectsRegion) ui.dragRegion = { start: origin.time, end: origin.time };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    const track = getTrack();
    if (!origin || !track) return;
    const time = timeAt(event, canvas, track.duration);
    if (selectsRegion) ui.region = normalizeRegion(origin.time, time, track.duration);
    drawWaves();
  });
  canvas.addEventListener("pointerup", (event) => {
    const track = getTrack();
    if (!origin || !track) return;
    const time = timeAt(event, canvas, track.duration);
    if (Math.abs(event.clientX - origin.x) < 4) {
      if (selectsRegion) ui.region = null;
      const active = canvas === waveB ? audioB : audio;
      ui.side = canvas === waveB ? "b" : "a";
      if (!active.src) active.src = mediaUrl(track.id);
      active.currentTime = time;
      active.play().then(() => { ui.playing = true; paintTransport(); }).catch(() => {});
    } else if (selectsRegion) {
      ui.region = normalizeRegion(origin.time, time, track.duration);
    }
    origin = null;
    paintTransport();
    drawWaves();
  });
}

function timeAt(event, canvas, duration) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return ratio * (duration || 0);
}

function normalizeRegion(a, b, duration) {
  const start = Math.max(0, Math.min(a, b));
  const end = Math.min(duration, Math.max(a, b));
  if (end - start < 0.2) return null;
  return { start, end };
}

function activeRegion(track) {
  if (ui.region) return ui.region;
  return { start: 0, end: track.duration || 0 };
}

function current() {
  return trackById(ui.currentId);
}

function trackById(id) {
  if (!state) return null;
  return state.tracks.find((track) => track.id === id) || (state.audiioTracks || []).find((track) => track.id === id) || null;
}

function reloadPreview() {
  const track = current();
  if (!track) return;
  audio.src = mediaUrl(track.id);
  audio.play().then(() => { ui.playing = true; paintTransport(); drawWaves(); }).catch(() => {});
}

function idsToTracks(ids) {
  return (ids || []).map(trackById).filter(Boolean);
}

function mediaUrl(id) {
  const stem = ui.stem && ui.stem.trackId === id ? `&stem=${encodeURIComponent(ui.stem.type)}` : "";
  return `/media/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}${stem}`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function numOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toggle(list, value) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else list.push(value);
  ui.page = 1;
  if (state && state.account && ui.view !== "files") scheduleBrowse();
  else render();
}

function chipRow(label, values, selected, onClick) {
  const row = div("");
  row.append(p(label));
  const chips = div("chip-row");
  for (const value of values) {
    const button = buttonEl(value, selected.includes(value) ? "on" : "", () => onClick(value));
    chips.append(button);
  }
  if (!values.length) chips.append(p("Index or load the demo library to fill these."));
  row.append(chips);
  return row;
}

function selectField(label, values, selected, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const select = document.createElement("select");
  for (const value of values) select.append(new Option(value || "Any", value));
  select.value = selected;
  select.addEventListener("change", () => onChange(select.value));
  wrap.append(select);
  return wrap;
}

function numberField(label, value, onChange) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  wrap.append(input);
  return wrap;
}

function buttonEl(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function div(className, text) {
  return el("div", className, text);
}
function p(text) {
  return el("p", "meta", text);
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function toast(message, bad) {
  const node = div(`toast${bad ? " bad" : ""}`, message);
  $("toasts").append(node);
  setTimeout(() => node.remove(), 4200);
}
