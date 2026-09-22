"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CuewellCatalog = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function catalogFactory() {

const PHRASES = [
  ["without vocals", { vocals: false, label: "instrumental" }],
  ["no vocals", { vocals: false, label: "instrumental" }],
  ["instrumental", { vocals: false, label: "instrumental" }],
  ["with vocals", { vocals: true, label: "vocals" }],
  ["hip hop", { genres: ["hiphop"], label: "hip hop" }],
  ["hip-hop", { genres: ["hiphop"], label: "hip hop" }],
  ["lo-fi", { genres: ["lofi"], moods: ["chill"], bpm: 84, energy: 0.4, label: "lo-fi" }],
  ["lofi", { genres: ["lofi"], moods: ["chill"], bpm: 84, energy: 0.4, label: "lo-fi" }],
  ["sound design", { moods: ["tense", "dark"], label: "sound design" }],
  ["voice over", { vocals: true, label: "vocals" }],
  ["voiceover", { vocals: true, label: "vocals" }],
];

const WORDS = {
  sad: { moods: ["melancholy", "sad", "somber"], energy: 0.28, bpm: 76 },
  melancholy: { moods: ["melancholy", "sad"], energy: 0.28 },
  somber: { moods: ["somber", "melancholy"], energy: 0.3 },
  slow: { bpm: 72, energy: 0.3 },
  fast: { bpm: 126, energy: 0.78 },
  quick: { bpm: 124, energy: 0.72 },
  epic: { moods: ["epic", "heroic"], genres: ["cinematic"], energy: 0.88, bpm: 118 },
  heroic: { moods: ["heroic", "epic"], genres: ["cinematic"], energy: 0.84 },
  trailer: { moods: ["epic", "tense"], genres: ["cinematic"], energy: 0.9, bpm: 120 },
  cinematic: { genres: ["cinematic"], moods: ["epic", "spacious"] },
  calm: { moods: ["calm", "gentle", "peaceful"], energy: 0.24, bpm: 74 },
  peaceful: { moods: ["peaceful", "calm"], energy: 0.22 },
  gentle: { moods: ["gentle", "intimate"], energy: 0.28 },
  happy: { moods: ["bright", "hopeful", "playful"], energy: 0.7, bpm: 112 },
  bright: { moods: ["bright", "hopeful"], energy: 0.68 },
  hopeful: { moods: ["hopeful", "warm"], energy: 0.55 },
  uplifting: { moods: ["hopeful", "bright"], energy: 0.7, bpm: 108 },
  warm: { moods: ["warm", "hopeful"], energy: 0.45 },
  dark: { moods: ["dark", "tense"], energy: 0.4 },
  tense: { moods: ["tense", "dark"], energy: 0.48, bpm: 90 },
  scary: { moods: ["tense", "dark"], energy: 0.5 },
  playful: { moods: ["playful", "bright"], energy: 0.66, bpm: 120 },
  fun: { moods: ["playful", "bright"], energy: 0.7 },
  intimate: { moods: ["intimate", "gentle"], energy: 0.2, bpm: 68 },
  quiet: { moods: ["calm", "intimate"], energy: 0.2, bpm: 70 },
  spacious: { moods: ["spacious", "calm"], genres: ["ambient"], energy: 0.3 },
  ambient: { genres: ["ambient"], moods: ["calm", "spacious"], energy: 0.28 },
  drone: { genres: ["ambient"], tags: ["drone"], energy: 0.2 },
  piano: { tags: ["piano"], genres: ["classical", "ambient"] },
  guitar: { tags: ["guitar"], genres: ["folk", "acoustic", "indie"] },
  acoustic: { genres: ["acoustic", "folk"], tags: ["guitar"], energy: 0.4 },
  folk: { genres: ["folk", "acoustic"], tags: ["guitar"] },
  drums: { tags: ["drums"], energy: 0.72 },
  beat: { tags: ["drums"], energy: 0.7 },
  bass: { tags: ["bass"], energy: 0.55 },
  electronic: { genres: ["electronic"], tags: ["synth"] },
  synth: { genres: ["electronic"], tags: ["synth"] },
  pop: { genres: ["pop"], energy: 0.68, bpm: 114 },
  rock: { genres: ["rock"], tags: ["drums"], energy: 0.82, bpm: 126 },
  indie: { genres: ["indie"], energy: 0.55 },
  classical: { genres: ["classical"], tags: ["piano"], energy: 0.35 },
  orchestral: { genres: ["cinematic", "classical"], moods: ["epic"], energy: 0.6 },
  hiphop: { genres: ["hiphop"], bpm: 90, energy: 0.62 },
  chill: { moods: ["chill", "calm"], genres: ["lofi"], energy: 0.35, bpm: 84 },
  groovy: { moods: ["groovy", "confident"], bpm: 96, energy: 0.58 },
  confident: { moods: ["confident"], energy: 0.66 },
  corporate: { moods: ["hopeful", "bright"], genres: ["pop", "indie"], energy: 0.58, bpm: 110 },
  commercial: { moods: ["bright", "hopeful"], genres: ["pop"], energy: 0.66 },
  documentary: { moods: ["spacious", "calm"], genres: ["ambient", "classical"], energy: 0.34, bpm: 80 },
  travel: { moods: ["hopeful", "spacious"], genres: ["indie", "acoustic"], energy: 0.52 },
  wedding: { moods: ["warm", "hopeful", "gentle"], genres: ["acoustic", "folk"], energy: 0.4 },
  sports: { moods: ["energetic", "confident"], tags: ["drums"], energy: 0.86, bpm: 122 },
  energetic: { moods: ["energetic"], energy: 0.84, bpm: 124 },
  night: { moods: ["dark", "intimate", "melancholy"], energy: 0.32, bpm: 80 },
  vocals: { vocals: true },
  vocal: { vocals: true },
  singer: { vocals: true },
  short: { duration: 6 },
  brief: { duration: 6 },
  long: { duration: 20 },
  pad: { tags: ["pad"], genres: ["ambient"] },
  minimal: { moods: ["intimate", "calm"], energy: 0.22 },
};

function num(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textBlob(track) {
  return [
    track.title,
    track.artist,
    track.key,
    track.description,
    ...(track.genres || []),
    ...(track.moods || []),
    ...(track.tags || []),
  ].join(" ").toLowerCase();
}

function textScore(track, query) {
  const title = (track.title || "").toLowerCase();
  const blob = textBlob(track);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  let score = 0;
  for (const term of terms) {
    if (title === term) score += 8;
    else if (title.startsWith(term)) score += 5;
    else if (title.includes(term)) score += 3;
    else if (blob.includes(term)) score += 1;
    else return 0;
  }
  return score;
}

function matchesFilters(track, opts) {
  if (opts.ids && !opts.ids.includes(track.id)) return false;
  if (opts.genres && opts.genres.length && !opts.genres.some((genre) => (track.genres || []).includes(genre))) return false;
  if (opts.moods && opts.moods.length && !opts.moods.some((mood) => (track.moods || []).includes(mood))) return false;
  if (opts.vocals === "vocals" && !track.vocals) return false;
  if (opts.vocals === "instrumental" && track.vocals) return false;
  if (opts.key && track.key !== opts.key) return false;
  if (opts.bpmMin != null && !(track.bpm >= opts.bpmMin)) return false;
  if (opts.bpmMax != null && !(track.bpm <= opts.bpmMax)) return false;
  if (opts.durationMin != null && !(track.duration >= opts.durationMin)) return false;
  if (opts.durationMax != null && !(track.duration <= opts.durationMax)) return false;
  if (opts.energyMin != null && !(track.energy >= opts.energyMin)) return false;
  if (opts.energyMax != null && !(track.energy <= opts.energyMax)) return false;
  if (opts.query && !textScore(track, opts.query)) return false;
  return true;
}

function searchTracks(tracks, opts = {}) {
  const filtered = tracks.filter((track) => matchesFilters(track, opts));
  const query = (opts.query || "").trim();
  const sort = opts.sort || (query ? "match" : "title");
  const rows = filtered.map((track) => ({ track, score: query ? textScore(track, query) : 0 }));
  if (opts.order) {
    const index = new Map(opts.order.map((id, position) => [id, position]));
    rows.sort((a, b) => (index.get(a.track.id) ?? 1e9) - (index.get(b.track.id) ?? 1e9));
  } else {
    rows.sort((a, b) => {
      if (sort === "bpm") return (a.track.bpm || 999) - (b.track.bpm || 999);
      if (sort === "duration") return (a.track.duration || 0) - (b.track.duration || 0);
      if (sort === "energy") return (b.track.energy || 0) - (a.track.energy || 0);
      if (sort === "match") return b.score - a.score || a.track.title.localeCompare(b.track.title);
      return a.track.title.localeCompare(b.track.title);
    });
  }
  return rows.map((row) => row.track);
}

function understandPrompt(prompt) {
  let remaining = ` ${(prompt || "").toLowerCase()} `;
  const profile = {
    moods: [],
    genres: [],
    tags: [],
    vocals: null,
    energy: [],
    bpm: [],
    duration: [],
    labels: [],
  };
  const phrases = [...PHRASES].sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, effect] of phrases) {
    const needle = ` ${phrase} `;
    if (remaining.includes(needle)) {
      applyEffect(profile, effect);
      remaining = remaining.split(needle).join(" ");
    }
  }
  for (const word of remaining.split(/[^a-z0-9+]+/).filter(Boolean)) {
    if (WORDS[word]) applyEffect(profile, WORDS[word], word);
  }
  return profile;
}

function applyEffect(profile, effect, label) {
  for (const mood of effect.moods || []) profile.moods.push(mood);
  for (const genre of effect.genres || []) profile.genres.push(genre);
  for (const tag of effect.tags || []) profile.tags.push(tag);
  if (effect.vocals != null) profile.vocals = effect.vocals;
  if (effect.energy != null) profile.energy.push(effect.energy);
  if (effect.bpm != null) profile.bpm.push(effect.bpm);
  if (effect.duration != null) profile.duration.push(effect.duration);
  profile.labels.push(effect.label || label);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function overlap(wanted, have) {
  const got = have || [];
  return wanted.filter((item) => got.includes(item));
}

function rankByPrompt(tracks, prompt) {
  const profile = understandPrompt(prompt);
  const targetEnergy = average(profile.energy);
  const targetBpm = average(profile.bpm);
  const targetDuration = average(profile.duration);
  const understood = [...new Set(profile.labels.filter(Boolean))];
  const fallbackQuery = (prompt || "").trim();
  const results = tracks.map((track) => {
    let score = 0;
    const why = [];
    const moods = overlap([...new Set(profile.moods)], track.moods);
    const genres = overlap([...new Set(profile.genres)], track.genres);
    const tags = overlap([...new Set(profile.tags)], track.tags);
    score += moods.length * 3;
    score += genres.length * 3;
    score += tags.length * 2.5;
    if (moods.length) why.push(moods.slice(0, 2).join(" / "));
    if (genres.length) why.push(genres[0]);
    if (tags.length) why.push(tags[0]);
    if (profile.vocals != null) {
      if (track.vocals === profile.vocals) {
        score += 3;
        why.push(profile.vocals ? "vocals" : "instrumental");
      } else {
        score -= 6;
      }
    }
    if (targetEnergy != null && track.energy != null) {
      const closeness = 1 - Math.min(1, Math.abs(track.energy - targetEnergy) / 0.55);
      score += closeness * 2;
    }
    if (targetBpm != null && track.bpm) {
      const closeness = 1 - Math.min(1, Math.abs(track.bpm - targetBpm) / 36);
      score += closeness * 2;
      if (closeness > 0.65) why.push(`${track.bpm} bpm`);
    }
    if (targetDuration != null && track.duration) {
      const closeness = 1 - Math.min(1, Math.abs(track.duration - targetDuration) / 12);
      score += closeness * 1.5;
    }
    if (!understood.length && fallbackQuery) score += textScore(track, fallbackQuery);
    else if (fallbackQuery) score += textScore(track, fallbackQuery) * 0.35;
    return { track, score, why: [...new Set(why)].slice(0, 4).join(" · ") };
  }).filter((row) => row.score > 0);
  results.sort((a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title));
  return { understood, results };
}

function jaccard(left, right) {
  const a = new Set(left || []);
  const b = new Set(right || []);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function featureVector(track) {
  const features = track.features || {};
  return [
    num(features.centroid, 0.5),
    num(features.zcr, 0.2),
    num(features.low, 0.33),
    num(features.mid, 0.33),
    num(features.high, 0.33),
    num(features.flux, 0.2),
    num(track.bpm, 100) / 180,
    num(track.energy, 0.5),
    track.vocals ? 1 : 0,
  ];
}

function cosine(left, right) {
  let dot = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftEnergy += left[i] * left[i];
    rightEnergy += right[i] * right[i];
  }
  if (!leftEnergy || !rightEnergy) return 0;
  return dot / Math.sqrt(leftEnergy * rightEnergy);
}

function similarTracks(tracks, id, limit = 12) {
  const seed = tracks.find((track) => track.id === id);
  if (!seed) return [];
  const seedVector = featureVector(seed);
  return tracks
    .filter((track) => track.id !== id)
    .map((track) => {
      const audio = cosine(seedVector, featureVector(track));
      const meta = (jaccard(seed.moods, track.moods) * 0.45)
        + (jaccard(seed.genres, track.genres) * 0.45)
        + (jaccard(seed.tags, track.tags) * 0.25)
        + (seed.key && seed.key === track.key ? 0.12 : 0)
        + (seed.vocals === track.vocals ? 0.08 : 0)
        + (seed.bpm && track.bpm ? (1 - Math.min(1, Math.abs(seed.bpm - track.bpm) / 40)) * 0.2 : 0);
      return { track, score: audio * 0.55 + meta };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function licensesToCsv(licenses, tracks) {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const header = ["Project", "Track", "Artist", "Licensed at", "Terms", "Note"];
  const lines = [header.join(",")];
  for (const license of licenses) {
    const track = byId.get(license.trackId);
    lines.push([
      license.project || "",
      track ? track.title : license.trackId,
      track ? track.artist : "",
      license.createdAt || "",
      license.terms || "",
      license.note || "",
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function uniqueSorted(tracks, field) {
  const values = new Set();
  for (const track of tracks) {
    for (const value of track[field] || []) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

return {
  searchTracks,
  rankByPrompt,
  similarTracks,
  licensesToCsv,
  uniqueSorted,
  understandPrompt,
};
}));
