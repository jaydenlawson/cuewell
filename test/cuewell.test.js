"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const audiio = require("../plugin/com.cuewell.resolve/lib/audiio");
const catalog = require("../plugin/com.cuewell.resolve/lib/catalog");
const audio = require("../plugin/com.cuewell.resolve/lib/audio");
const { createEngine, isPublicHttp } = require("../plugin/com.cuewell.resolve/lib/engine");
const { startServer } = require("../plugin/com.cuewell.resolve/lib/server");

const library = [
  track("calm", "Glass Harbour", ["ambient"], ["calm", "spacious"], ["piano"], false, 0.22, 72, 16),
  track("sad", "Last Tram", ["ambient"], ["melancholy", "sad"], ["piano", "vocals"], true, 0.26, 76, 16),
  track("rock", "Kickoff", ["rock"], ["energetic"], ["drums"], false, 0.86, 128, 12),
  track("hop", "Neon Service", ["hiphop"], ["confident", "groovy"], ["drums", "bass"], false, 0.64, 92, 13),
];

function track(id, title, genres, moods, tags, vocals, energy, bpm, duration) {
  return { id, title, artist: "Cuewell", genres, moods, tags, vocals, energy, bpm, duration, key: "A", description: title, features: { centroid: energy, zcr: 0.1, low: 0.4, mid: 0.4, high: 0.2, flux: 0.2 } };
}

test("filters vocals, tempo, and text", () => {
  const slow = catalog.searchTracks(library, { bpmMax: 80, vocals: "instrumental" });
  assert.deepEqual(slow.map((item) => item.id), ["calm"]);
  const query = catalog.searchTracks(library, { query: "kickoff", sort: "match" });
  assert.equal(query[0].id, "rock");
});

test("prompt search prefers a slow sad piano cue", () => {
  const ranked = catalog.rankByPrompt(library, "slow sad piano, no vocals");
  assert.ok(ranked.understood.includes("instrumental"));
  assert.equal(ranked.results[0].track.id, "calm");
  const sung = catalog.rankByPrompt(library, "slow sad piano vocals");
  assert.equal(sung.results[0].track.id, "sad");
});

test("similar tracks stay near genre and tempo", () => {
  const ranked = catalog.similarTracks(library, "hop", 3);
  assert.notEqual(ranked[0].track.id, "sad");
  assert.ok(ranked.some((row) => row.track.tags.includes("drums")));
});

test("license csv escapes quotes", () => {
  const csv = catalog.licensesToCsv([{ trackId: "sad", project: 'Client "North"', createdAt: "2026-09-22T00:00:00.000Z", terms: "Free, with credit", note: "end card" }], library);
  assert.match(csv, /"Client ""North"""/);
  assert.match(csv, /"Free, with credit"/);
});

test("tempo estimate finds a 120 bpm click", () => {
  const sampleRate = 22050;
  const samples = new Float32Array(sampleRate * 8);
  for (let time = 0; time < 8; time += 0.5) {
    const start = Math.floor(time * sampleRate);
    for (let i = 0; i < 180; i += 1) samples[start + i] = Math.sin((2 * Math.PI * 90 * i) / sampleRate) * Math.exp(-i / 70);
  }
  const bpm = audio.estimateBpmFromSamples(samples, sampleRate);
  assert.ok(bpm >= 118 && bpm <= 122, `expected about 120, got ${bpm}`);
});

test("mp4 duration reads mvhd", () => {
  const body = Buffer.alloc(20);
  body.writeUInt32BE(1000, 12);
  body.writeUInt32BE(2500, 16);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + body.length, 0);
  const atom = Buffer.concat([size, Buffer.from("mvhd"), body]);
  assert.equal(audio.mp4Duration(atom), 2.5);
});

test("audiio track mapping keeps preview, stems, and waveform", () => {
  const peaks = Buffer.from(JSON.stringify([0, 0.25, 0.5, 1]));
  const track = audiio.mapTrack({
    id: 5,
    title: "Example",
    bpm: 90,
    duration: 12,
    vocal_none: true,
    musical_key: "aminor",
    song: "https://example.test/preview.mp3",
    sound_pro: "/example.wav",
    genres: ["ambient"],
    mood_calm: true,
    json: { type: "Buffer", data: [...peaks] },
    artist: { name: "Ada", slug: "ada" },
    album: { slug: "record", title: "Record" },
    slug: "example",
    stems: [{ type: "drums", label: "Drums", url: "https://example.test/drums.mp3" }, { type: "fullMix", url: "https://example.test/mix.mp3" }],
  });
  assert.equal(track.id, "audiio:5");
  assert.equal(track.remoteUrl, "https://example.test/preview.mp3");
  assert.equal(track.vocals, false);
  assert.deepEqual(track.moods, ["calm"]);
  assert.deepEqual(track.stems.map((stem) => stem.type), ["drums"]);
  assert.equal(track.peaks.length, 160);
  assert.equal(audiio.buildQuery({ term: "piano", genre: "ambient", page: 2 }), "page=2&limit=24&term=piano&genre=ambient");
  assert.equal(audiio.canDownloadMaster({ membership: { lifetime: true } }), true);
  const account = audiio.publicAccount({ account: { id: 1, uuid: "u", first_name: "Ada", email: "a@b.c" }, memberships: { lifetime: true, lifetimeSFX: true } });
  assert.equal(account.membership.lifetime, true);
  assert.equal(account.membership.lifetimeSfx, true);
  const effect = audiio.mapSfx({ id: 9, title: "Audiio_Whoosh1.wav", comment: "Whoosh 1", duration: 5, genre: "[\"Whoosh\"]" });
  assert.equal(effect.title, "Whoosh 1");
  assert.equal(effect.remoteUrl, "https://d2cx9kaw24fnh5.cloudfront.net/Audiio_Whoosh1.mp3");
  assert.equal(effect.kind, "sfx");
  assert.equal(audiio.canDownloadMaster({ membership: {} }), false);
});

test("audiio catalog search returns playable cues", { timeout: 30000 }, async () => {
  const result = await audiio.search({ term: "piano", page: 1, limit: 2 });
  assert.ok(result.tracks.length > 0);
  assert.match(result.tracks[0].remoteUrl, /^https:\/\//);
  assert.equal(result.tracks[0].source, "audiio");
});

test("private reference links are refused", () => {
  assert.equal(isPublicHttp(new URL("http://127.0.0.1/secret")), false);
  assert.equal(isPublicHttp(new URL("http://192.168.1.4/a")), false);
  assert.equal(isPublicHttp(new URL("https://www.youtube.com/watch?v=abc")), true);
});

test("demo library, favorites, playlists, and timeline guard", { timeout: 180000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cuewell-"));
  const placed = [];
  const engine = createEngine({
    dataDir,
    resolve: {
      async projectName() { return "Cut 12"; },
      async place(request) { placed.push(request); return { ok: true, message: "Placed." }; },
    },
  });
  const generated = await engine.handle("generateDemo");
  assert.equal(generated.ok, true);
  assert.equal(generated.state.tracks.length, audio.DEMO_SPECS.length);
  assert.ok(fs.existsSync(generated.state.tracks[0].path));
  const sad = catalog.rankByPrompt(generated.state.tracks, "slow sad piano vocals");
  assert.equal(sad.results[0].track.title, "Last Tram");
  const favorite = await engine.handle("toggleFavorite", { id: "demo:last-tram" });
  assert.deepEqual(favorite.state.favorites, ["demo:last-tram"]);
  const playlist = await engine.handle("playlistFromPrompt", { prompt: "epic trailer drums", name: "Trailer" });
  assert.equal(playlist.state.playlists[0].name, "Trailer");
  assert.ok(playlist.state.playlists[0].trackIds.includes("demo:red-meridian"));
  const license = await engine.handle("licenseTrack", { trackId: "demo:last-tram", note: "end card" });
  assert.equal(license.state.licenses[0].project, "Cut 12");
  const placedResult = await engine.handle("place", { trackId: "demo:kitchen-timer", startSec: 0, endSec: 2 });
  assert.equal(placedResult.ok, true);
  assert.equal(placed[0].endSec, 2);
  const blocked = createEngine({ dataDir });
  const refused = await blocked.handle("place", { trackId: "demo:kitchen-timer" });
  assert.equal(refused.ok, false);
  const server = await startServer(engine, { port: 0 });
  const info = server.info();
  const stateResponse = await fetch(info.localUrl.replace("/?token=", "/api/state?token="));
  const body = await stateResponse.json();
  assert.equal(body.state.tracks.length, audio.DEMO_SPECS.length);
  const media = await fetch(`${info.localUrl.split("?")[0]}media/${encodeURIComponent("demo:kitchen-timer")}?token=${engine.token}`);
  const bytes = Buffer.from(await media.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  const denied = await fetch(`${info.localUrl.split("?")[0]}api/state`);
  assert.equal(denied.status, 401);
  await server.close();
});
