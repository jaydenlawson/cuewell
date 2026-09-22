"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DEMO_LICENSE = "Original Cuewell demo. Free to use in any project, including client work. No attribution required.";
const USER_LICENSE = "From your library. Confirm you have the right to use this recording before you license it into a project.";
const PEAKS = 160;
const AUDIO_EXT = new Set([".wav", ".aif", ".aiff", ".mp3", ".m4a", ".aac", ".flac", ".ogg"]);

const DEMO_SPECS = [
  spec("glass-harbour", "Glass Harbour", 72, "Amin", true, 220, 16, ["ambient"], ["calm", "spacious"], ["piano", "pad"], false, 0.22, 0, "Slow glassy harmonies for quiet establishing shots."),
  spec("night-market", "Night Market", 86, "F", false, 174.61, 14, ["lofi", "hiphop"], ["groovy", "chill"], ["drums", "bass"], false, 0.46, 0.55, "Dusty late-night drums and a soft bass loop."),
  spec("copper-line", "Copper Line", 108, "G", false, 196, 14, ["indie"], ["hopeful", "warm"], ["guitar"], false, 0.58, 0.35, "Hopeful indie guitar figure for travel and portraits."),
  spec("red-meridian", "Red Meridian", 120, "Dmin", true, 146.83, 16, ["cinematic"], ["epic", "heroic"], ["drums"], false, 0.9, 1, "Wide cinematic drums for trailers and sports opens."),
  spec("soft-radio", "Soft Radio", 116, "C", false, 261.63, 14, ["pop"], ["bright", "hopeful"], ["vocals", "synth"], true, 0.7, 0.45, "Bright pop bed with a synthesized vocal tone."),
  spec("paper-kite", "Paper Kite", 94, "D", false, 293.66, 15, ["folk", "acoustic"], ["warm", "gentle"], ["guitar"], false, 0.4, 0.15, "Warm acoustic guitar for wedding and documentary scenes."),
  spec("static-garden", "Static Garden", 102, "Emin", true, 164.81, 14, ["electronic"], ["dreamy", "spacious"], ["synth"], false, 0.52, 0.4, "Arpeggiated electronic garden, light and dreamy."),
  spec("low-ceiling", "Low Ceiling", 70, "Fmin", true, 87.31, 16, ["ambient", "cinematic"], ["dark", "tense"], ["drone"], false, 0.3, 0.2, "Low tense drone for night interiors."),
  spec("marble-stairs", "Marble Stairs", 80, "Bb", false, 233.08, 16, ["classical"], ["elegant", "calm"], ["piano"], false, 0.34, 0, "Sparse classical piano, unhurried."),
  spec("neon-service", "Neon Service", 92, "A", true, 110, 13, ["hiphop"], ["confident", "groovy"], ["drums", "bass"], false, 0.64, 0.85, "Confident hip hop drums with a dry bass."),
  spec("open-window", "Open Window", 98, "G", false, 392, 14, ["acoustic"], ["gentle", "hopeful"], ["guitar"], false, 0.42, 0.1, "Gentle acoustic pattern, morning light."),
  spec("last-tram", "Last Tram", 76, "Emin", true, 164.81, 16, ["ambient"], ["melancholy", "sad", "intimate"], ["piano", "vocals"], true, 0.26, 0, "Slow sad piano with a quiet synthesized vocal."),
  spec("kickoff", "Kickoff", 128, "E", false, 164.81, 12, ["rock"], ["energetic", "confident"], ["drums", "guitar"], false, 0.86, 1, "Fast rock drums for sports and montages."),
  spec("kitchen-timer", "Kitchen Timer", 132, "C", false, 523.25, 5, ["pop"], ["playful", "bright"], ["mallets"], false, 0.63, 0.3, "Short playful mallet cue."),
  spec("long-take", "Long Take", 60, "D", false, 146.83, 22, ["ambient"], ["spacious", "calm"], ["pad", "drone"], false, 0.18, 0, "Long calm pad for a held wide shot."),
  spec("whisper-cue", "Whisper Cue", 66, "A", true, 220, 4, ["ambient"], ["intimate", "gentle"], ["piano"], false, 0.16, 0, "Very short intimate piano sting."),
];

function spec(file, title, bpm, key, minor, root, seconds, genres, moods, tags, vocals, energy, drums, description) {
  return {
    id: `demo:${file}`,
    file: `${file}.wav`,
    title,
    artist: "Cuewell",
    bpm,
    key,
    minor,
    root,
    seconds,
    genres,
    moods,
    tags,
    vocals,
    energy,
    drums,
    description,
  };
}

function isAudioFile(file) {
  return AUDIO_EXT.has(path.extname(file).toLowerCase());
}

function walkAudio(folder) {
  const found = [];
  const pending = [folder];
  while (pending.length) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") pending.push(full);
      } else if (entry.isFile() && isAudioFile(full)) {
        found.push(full);
        if (found.length >= 20000) return found;
      }
    }
  }
  found.sort((a, b) => a.localeCompare(b));
  return found;
}

function inspectAudio(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".wav") {
    const analyzed = analyzeWav(file);
    if (analyzed) return analyzed;
  }
  const duration = durationOf(file);
  if (duration == null) return null;
  return {
    duration,
    sampleRate: null,
    peaks: flatPeaks(),
    features: null,
    bpm: null,
  };
}

function flatPeaks() {
  return Array.from({ length: PEAKS }, () => 0.08);
}

function analyzeWav(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12) return null;
    if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") return null;
    const size = fs.fstatSync(fd).size;
    let offset = 12;
    let fmt = null;
    let dataOffset = null;
    let dataSize = null;
    while (offset + 8 <= size) {
      const chunk = Buffer.alloc(8);
      if (fs.readSync(fd, chunk, 0, 8, offset) < 8) break;
      const id = chunk.toString("ascii", 0, 4);
      const chunkSize = chunk.readUInt32LE(4);
      const body = offset + 8;
      if (id === "fmt " && chunkSize >= 16) {
        const fmtBuf = Buffer.alloc(16);
        fs.readSync(fd, fmtBuf, 0, 16, body);
        fmt = {
          audioFormat: fmtBuf.readUInt16LE(0),
          channels: fmtBuf.readUInt16LE(2),
          sampleRate: fmtBuf.readUInt32LE(4),
          bits: fmtBuf.readUInt16LE(14),
        };
      } else if (id === "data") {
        dataOffset = body;
        dataSize = chunkSize;
        break;
      }
      offset = body + chunkSize + (chunkSize % 2);
    }
    if (!fmt || dataOffset == null || !fmt.channels || !fmt.sampleRate || !fmt.bits) return null;
    const bytesPerSample = fmt.bits / 8;
    if (![1, 3].includes(fmt.audioFormat) || ![1, 2, 3, 4].includes(bytesPerSample)) {
      const blockGuess = Math.max(1, fmt.channels * Math.max(1, bytesPerSample));
      return { duration: dataSize / (fmt.sampleRate * blockGuess), sampleRate: fmt.sampleRate, peaks: flatPeaks(), features: null, bpm: null };
    }
    const block = bytesPerSample * fmt.channels;
    const totalFrames = Math.floor(Math.min(dataSize, size - dataOffset) / block);
    const duration = totalFrames / fmt.sampleRate;
    const peaks = new Float32Array(PEAKS);
    const featureFrames = Math.min(totalFrames, fmt.sampleRate * 20);
    const lowCoef = Math.exp((-2 * Math.PI * 180) / fmt.sampleRate);
    const highCoef = Math.exp((-2 * Math.PI * 2000) / fmt.sampleRate);
    let lowState = 0;
    let highState = 0;
    let lowEnergy = 0;
    let midEnergy = 0;
    let highEnergy = 0;
    let square = 0;
    let crossings = 0;
    let previousSign = 0;
    let flux = 0;
    let fluxCount = 0;
    let previousFrame = 0;
    let frameSquare = 0;
    let frameCount = 0;
    const hop = Math.max(1, Math.round(fmt.sampleRate / 100));
    const envelope = [];
    let hopSquare = 0;
    let hopCount = 0;
    let previousRms = 0;
    const chunkFrames = 16384;
    for (let frame = 0; frame < totalFrames; frame += chunkFrames) {
      const count = Math.min(chunkFrames, totalFrames - frame);
      const buf = Buffer.alloc(count * block);
      const got = fs.readSync(fd, buf, 0, buf.length, dataOffset + frame * block);
      const framesRead = Math.floor(got / block);
      for (let i = 0; i < framesRead; i += 1) {
        let sample = 0;
        for (let channel = 0; channel < fmt.channels; channel += 1) {
          sample += readSample(buf, i * block + channel * bytesPerSample, fmt);
        }
        sample /= fmt.channels;
        const index = frame + i;
        const bucket = Math.min(PEAKS - 1, Math.floor((index / totalFrames) * PEAKS));
        const abs = Math.abs(sample);
        if (abs > peaks[bucket]) peaks[bucket] = abs;
        if (index < featureFrames) {
          square += sample * sample;
          const sign = sample > 0.001 ? 1 : sample < -0.001 ? -1 : previousSign;
          if (previousSign && sign && sign !== previousSign) crossings += 1;
          if (sign) previousSign = sign;
          lowState = ((1 - lowCoef) * sample) + (lowCoef * lowState);
          highState = ((1 - highCoef) * sample) + (highCoef * highState);
          const high = sample - highState;
          const mid = highState - lowState;
          lowEnergy += lowState * lowState;
          midEnergy += mid * mid;
          highEnergy += high * high;
          frameSquare += sample * sample;
          frameCount += 1;
          if (frameCount === 1024) {
            const rms = Math.sqrt(frameSquare / frameCount);
            flux += Math.abs(rms - previousFrame);
            fluxCount += 1;
            previousFrame = rms;
            frameSquare = 0;
            frameCount = 0;
          }
          hopSquare += sample * sample;
          hopCount += 1;
          if (hopCount === hop) {
            const rms = Math.sqrt(hopSquare / hopCount);
            envelope.push(Math.max(0, rms - previousRms));
            previousRms = rms;
            hopSquare = 0;
            hopCount = 0;
          }
        }
      }
    }
    const bandTotal = lowEnergy + midEnergy + highEnergy || 1;
    const centroid = ((lowEnergy * 180) + (midEnergy * 1000) + (highEnergy * 5000)) / bandTotal;
    const rms = featureFrames ? Math.sqrt(square / featureFrames) : 0;
    return {
      duration,
      sampleRate: fmt.sampleRate,
      peaks: Array.from(peaks, (value) => Math.round(value * 1000) / 1000),
      features: {
        centroid: round4(Math.min(1, centroid / (fmt.sampleRate / 2))),
        zcr: round4(featureFrames ? crossings / featureFrames : 0),
        low: round4(lowEnergy / bandTotal),
        mid: round4(midEnergy / bandTotal),
        high: round4(highEnergy / bandTotal),
        flux: round4(fluxCount ? flux / fluxCount : 0),
        rms: round4(rms),
      },
      bpm: estimateBpmFromEnvelope(envelope, 100),
    };
  } catch {
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function readSample(buffer, offset, fmt) {
  if (fmt.audioFormat === 3 && fmt.bits === 32) return buffer.readFloatLE(offset);
  if (fmt.bits === 16) return buffer.readInt16LE(offset) / 32768;
  if (fmt.bits === 8) return (buffer.readUInt8(offset) - 128) / 128;
  if (fmt.bits === 24) {
    const value = buffer.readUInt8(offset) | (buffer.readUInt8(offset + 1) << 8) | (buffer.readUInt8(offset + 2) << 16);
    const signed = value & 0x800000 ? value - 0x1000000 : value;
    return signed / 8388608;
  }
  if (fmt.bits === 32) return buffer.readInt32LE(offset) / 2147483648;
  return 0;
}

function estimateBpmFromEnvelope(envelope, rate) {
  if (!envelope || envelope.length < rate) return null;
  const minBpm = 60;
  const maxBpm = 180;
  const minLag = Math.max(1, Math.round((rate * 60) / maxBpm));
  const maxLag = Math.min(envelope.length - 1, Math.round((rate * 60) / minBpm));
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    const count = envelope.length - lag;
    for (let i = 0; i < count; i += 8) correlation += envelope[i] * envelope[i + lag];
    if (correlation > best) {
      best = correlation;
      bestLag = lag;
    }
  }
  if (!bestLag || best <= 0) return null;
  const bpm = Math.round((60 * rate) / bestLag);
  return bpm >= minBpm && bpm <= maxBpm ? bpm : null;
}

function estimateBpmFromSamples(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate / 100));
  const envelope = [];
  let previous = 0;
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let energy = 0;
    for (let j = 0; j < hop; j += 1) energy += samples[i + j] * samples[i + j];
    const rms = Math.sqrt(energy / hop);
    envelope.push(Math.max(0, rms - previous));
    previous = rms;
  }
  return estimateBpmFromEnvelope(envelope, 100);
}

function durationOf(file) {
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === ".wav") {
      const info = analyzeWav(file);
      return info ? info.duration : null;
    }
    if (ext === ".mp3") return mp3Duration(fs.readFileSync(file));
    if (ext === ".m4a" || ext === ".aac" || ext === ".mp4") return mp4Duration(fs.readFileSync(file));
    if (ext === ".flac") return flacDuration(fs.readFileSync(file));
  } catch {
    // Fall through to a system probe.
  }
  return probeDuration(file);
}

function probeDuration(file) {
  try {
    if (process.platform === "darwin") {
      const output = execFileSync("afinfo", [file], { encoding: "utf8", timeout: 8000 });
      const match = /estimated duration:\s*([0-9.]+)\s*sec/i.exec(output) || /duration:\s*([0-9.]+)/i.exec(output);
      if (match) return Number(match[1]);
    }
  } catch {
    // Optional.
  }
  try {
    const output = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8", timeout: 8000 });
    const duration = Number(output.trim());
    if (Number.isFinite(duration)) return duration;
  } catch {
    // Optional.
  }
  return null;
}

function mp3Duration(buffer) {
  const rates = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000],
  };
  const bitrates = {
    3: {
      3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
      2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
      1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    },
    2: {
      3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
      1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    },
  };
  bitrates[2][2] = bitrates[2][1];
  bitrates[0] = bitrates[2];
  let offset = 0;
  if (buffer.toString("ascii", 0, 3) === "ID3") {
    const size = ((buffer[6] & 127) << 21) | ((buffer[7] & 127) << 14) | ((buffer[8] & 127) << 7) | (buffer[9] & 127);
    offset = 10 + size;
  }
  const scanEnd = Math.min(buffer.length - 4, offset + 256000);
  for (let i = offset; i < scanEnd; i += 1) {
    if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (buffer[i + 1] >> 3) & 3;
    const layerBits = (buffer[i + 1] >> 1) & 3;
    const bitrateIndex = (buffer[i + 2] >> 4) & 15;
    const sampleIndex = (buffer[i + 2] >> 2) & 3;
    const version = versionBits === 3 ? 3 : versionBits === 2 ? 2 : versionBits === 0 ? 0 : null;
    const layer = layerBits === 3 ? 3 : layerBits === 2 ? 2 : layerBits === 1 ? 1 : null;
    if (!version || !layer || !bitrateIndex || bitrateIndex === 15 || sampleIndex === 3) continue;
    const bitrate = bitrates[version][layer][bitrateIndex] * 1000;
    const sampleRate = rates[version][sampleIndex];
    if (!bitrate || !sampleRate) continue;
    const padding = (buffer[i + 2] >> 1) & 1;
    const samplesPerFrame = layer === 3 ? 384 : version === 3 ? 1152 : 576;
    let audioBytes = buffer.length - i;
    if (buffer.length > 128 && buffer.toString("ascii", buffer.length - 128, buffer.length - 125) === "TAG") audioBytes -= 128;
    const frameLength = layer === 3
      ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
      : Math.floor((samplesPerFrame / 8 * bitrate) / sampleRate + padding);
    if (frameLength <= 0) continue;
    return (audioBytes / frameLength) * (samplesPerFrame / sampleRate);
  }
  return null;
}

function mp4Duration(buffer) {
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let header = 8;
    if (size === 1 && offset + 16 <= buffer.length) {
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    }
    if (!size) break;
    if (type === "mvhd" && offset + header + 20 <= buffer.length) {
      const version = buffer[offset + header];
      if (version === 0) {
        const timescale = buffer.readUInt32BE(offset + header + 12);
        const duration = buffer.readUInt32BE(offset + header + 16);
        if (timescale) return duration / timescale;
      } else if (version === 1 && offset + header + 32 <= buffer.length) {
        const timescale = buffer.readUInt32BE(offset + header + 20);
        const duration = Number(buffer.readBigUInt64BE(offset + header + 24));
        if (timescale) return duration / timescale;
      }
    }
    const container = type === "moov" || type === "trak" || type === "mdia" || type === "minf" || type === "stbl";
    if (container) {
      offset += header;
      continue;
    }
    if (size < header) break;
    offset += size;
  }
  return null;
}

function flacDuration(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "fLaC" || buffer.length < 42) return null;
  const block = buffer.subarray(8, 42);
  const sampleRate = (block[10] << 12) | (block[11] << 4) | (block[12] >> 4);
  const high = block[13] & 0x0f;
  let samples = 0;
  for (let i = 0; i < 4; i += 1) samples = (samples * 256) + block[14 + i];
  samples += high * 2 ** 32;
  if (!sampleRate) return null;
  return samples / sampleRate;
}

function writeWav(file, samples, sampleRate) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(clipped < 0 ? Math.round(clipped * 32768) : Math.round(clipped * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buffer);
}

function renderSpec(item) {
  const sampleRate = 22050;
  const length = Math.floor(item.seconds * sampleRate);
  const mix = new Float32Array(length);
  const random = mulberry32(hash(item.id));
  const scale = item.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const beat = 60 / item.bpm;
  const beats = Math.floor(item.seconds / beat);
  const melody = [0, 2, 4, 7, 4, 2, 5, 3];
  for (let index = 0; index < beats; index += 1) {
    const time = index * beat;
    if (item.drums > 0 && index % 4 === 0) addKick(mix, sampleRate, time, 0.9 * item.drums);
    if (item.drums > 0 && index % 4 === 2) addSnare(mix, sampleRate, time, random, 0.35 * item.drums);
    if (item.drums > 0.4 && index % 2 === 0) addHat(mix, sampleRate, time, random, 0.12 * item.drums);
    if (index % 4 === 0) addTone(mix, sampleRate, time, beat * 3.6, item.root / 2, 0.22, "sine");
    if (index % 4 === 0) {
      addTone(mix, sampleRate, time, beat * 3.8, midi(item.root, scale[0]), 0.12, "sine");
      addTone(mix, sampleRate, time, beat * 3.8, midi(item.root, scale[2]), 0.1, "sine");
      addTone(mix, sampleRate, time, beat * 3.8, midi(item.root, scale[4]), 0.08, "sine");
    }
    const degree = melody[index % melody.length];
    const note = midi(item.root, scale[((degree % scale.length) + scale.length) % scale.length]) * (degree > 4 ? 2 : 1);
    addTone(mix, sampleRate, time, beat * 0.92, note, item.drums > 0.8 ? 0.16 : 0.28, item.tags.includes("guitar") ? "pluck" : "sine");
    if (item.tags.includes("piano") && index % 2 === 0) {
      addTone(mix, sampleRate, time, beat * 1.8, note, 0.2, "pluck");
    }
    if (item.vocals && index % 2 === 0) addVowel(mix, sampleRate, time, beat * 1.5, note, 0.07);
  }
  let peak = 0;
  for (let i = 0; i < mix.length; i += 1) peak = Math.max(peak, Math.abs(mix[i]));
  const gain = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < mix.length; i += 1) mix[i] *= gain;
  return { samples: mix, sampleRate };
}

function midi(root, semitone) {
  return root * (2 ** (semitone / 12));
}

function addTone(mix, sampleRate, start, duration, frequency, amplitude, shape) {
  const from = Math.max(0, Math.floor(start * sampleRate));
  const to = Math.min(mix.length, from + Math.floor(duration * sampleRate));
  for (let i = from; i < to; i += 1) {
    const time = (i - from) / sampleRate;
    const attack = Math.min(1, time / 0.015);
    const release = Math.exp(-time / Math.max(0.08, duration * 0.7));
    const phase = (frequency * time) % 1;
    let sample = Math.sin(2 * Math.PI * frequency * time);
    if (shape === "pluck") sample = Math.sin(2 * Math.PI * phase) * Math.exp(-time * 4);
    mix[i] += sample * amplitude * attack * (shape === "pluck" ? 1 : release);
  }
}

function addKick(mix, sampleRate, start, amplitude) {
  const from = Math.floor(start * sampleRate);
  const to = Math.min(mix.length, from + Math.floor(0.25 * sampleRate));
  for (let i = from; i < to; i += 1) {
    const time = (i - from) / sampleRate;
    const frequency = 140 * Math.exp(-time * 22) + 48;
    mix[i] += Math.sin(2 * Math.PI * frequency * time) * Math.exp(-time * 7) * amplitude;
  }
}

function addSnare(mix, sampleRate, start, random, amplitude) {
  const from = Math.floor(start * sampleRate);
  const to = Math.min(mix.length, from + Math.floor(0.16 * sampleRate));
  for (let i = from; i < to; i += 1) {
    const time = (i - from) / sampleRate;
    const noise = (random() * 2 - 1) * Math.exp(-time * 18);
    const tone = Math.sin(2 * Math.PI * 180 * time) * Math.exp(-time * 20);
    mix[i] += (noise * 0.7 + tone * 0.3) * amplitude;
  }
}

function addHat(mix, sampleRate, start, random, amplitude) {
  const from = Math.floor(start * sampleRate);
  const to = Math.min(mix.length, from + Math.floor(0.04 * sampleRate));
  for (let i = from; i < to; i += 1) {
    const time = (i - from) / sampleRate;
    mix[i] += (random() * 2 - 1) * Math.exp(-time * 55) * amplitude;
  }
}

function addVowel(mix, sampleRate, start, duration, frequency, amplitude) {
  const from = Math.floor(start * sampleRate);
  const to = Math.min(mix.length, from + Math.floor(duration * sampleRate));
  for (let i = from; i < to; i += 1) {
    const time = (i - from) / sampleRate;
    const envelope = Math.sin(Math.min(Math.PI, (time / duration) * Math.PI)) ** 1.2;
    const sample = Math.sin(2 * Math.PI * 700 * time) * 0.6 + Math.sin(2 * Math.PI * 1200 * time) * 0.4;
    const vibrato = 0.7 + 0.3 * Math.sin(2 * Math.PI * frequency * time);
    mix[i] += sample * envelope * vibrato * amplitude;
  }
}

function generateDemo(folder) {
  fs.mkdirSync(folder, { recursive: true });
  const tracks = [];
  for (const item of DEMO_SPECS) {
    const rendered = renderSpec(item);
    const file = path.join(folder, item.file);
    writeWav(file, rendered.samples, rendered.sampleRate);
    const analyzed = analyzeWav(file);
    tracks.push({
      id: item.id,
      source: "demo",
      title: item.title,
      artist: item.artist,
      path: file,
      duration: analyzed ? round4(analyzed.duration) : item.seconds,
      bpm: item.bpm,
      key: item.key,
      genres: item.genres,
      moods: item.moods,
      tags: item.tags,
      vocals: item.vocals,
      energy: item.energy,
      description: item.description,
      license: DEMO_LICENSE,
      peaks: analyzed ? analyzed.peaks : flatPeaks(),
      features: analyzed ? analyzed.features : null,
      locked: false,
      createdAt: new Date().toISOString(),
    });
  }
  return tracks;
}

function trackFromFile(file, info) {
  const base = path.basename(file, path.extname(file));
  const sidecarPath = file.replace(/\.[^.]+$/, ".cuewell.json");
  let sidecar = {};
  if (fs.existsSync(sidecarPath)) {
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    } catch {
      sidecar = {};
    }
  }
  const title = cleanText(sidecar.title) || titleFromFile(base);
  return {
    id: null,
    source: "library",
    title,
    artist: cleanText(sidecar.artist) || "Unknown artist",
    path: file,
    duration: info.duration ? round4(info.duration) : 0,
    bpm: numberOrNull(sidecar.bpm) || info.bpm || null,
    key: cleanText(sidecar.key) || "",
    genres: stringList(sidecar.genres),
    moods: stringList(sidecar.moods),
    tags: stringList(sidecar.tags),
    vocals: Boolean(sidecar.vocals),
    energy: numberOrNull(sidecar.energy) ?? (info.features ? Math.max(0, Math.min(1, info.features.rms * 4)) : 0.4),
    description: cleanText(sidecar.description) || "",
    license: cleanText(sidecar.license) || USER_LICENSE,
    peaks: info.peaks || flatPeaks(),
    features: info.features || null,
    locked: false,
    createdAt: new Date().toISOString(),
  };
}

function titleFromFile(base) {
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 240);
}

function stringList(value) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return source.map((item) => String(item).trim().toLowerCase()).filter(Boolean).slice(0, 8);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

module.exports = {
  DEMO_LICENSE,
  DEMO_SPECS,
  analyzeWav,
  durationOf,
  estimateBpmFromSamples,
  flacDuration,
  generateDemo,
  inspectAudio,
  isAudioFile,
  mp3Duration,
  mp4Duration,
  trackFromFile,
  walkAudio,
  writeWav,
};
