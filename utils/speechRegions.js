// Find where someone is actually speaking in a recording, before Whisper.
//
// whisper-1 writes text into silence: subtitle credits, "thanks for watching",
// news sign-offs, a different line on every request. Filtering that text
// afterwards means chasing phrases, so instead the audio itself is checked
// with Silero VAD, a small speech detector (the same approach faster-whisper
// uses). Taps, clicks and room noise are not speech, so a recording with no
// speech skips Whisper entirely, and any Whisper segment that sits where
// nobody spoke can be dropped whatever it says.
//
// Pipeline: ffmpeg (bundled by ffmpeg-static, nothing to install) decodes the
// upload to 16 kHz mono float samples, Silero scores every 96 ms frame, and
// frames are merged into speech regions.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ort = require('onnxruntime-node');

const SAMPLE_RATE = 16000;
const FRAME = 1536; // samples per frame, 96 ms at 16 kHz
const FRAME_SEC = FRAME / SAMPLE_RATE;

// Silero's usual thresholds: speech starts above 0.5, ends below 0.35.
const START_PROB = 0.5;
const END_PROB = 0.35;
// A region ends after this much quiet, so short gaps between words stay inside it.
const END_SILENCE_SEC = 0.3;
// Shorter bursts (a tap on the desk, a cough) are not counted as speech.
const MIN_SPEECH_SEC = 0.25;

// The model file ships inside @ricky0123/vad-node (pinned in package.json);
// only the file is used, its wrapper code is not.
const MODEL_PATH = require.resolve('@ricky0123/vad-node/dist/silero_vad.onnx');

let sessionPromise;
const getSession = () => (sessionPromise ??= ort.InferenceSession.create(fs.readFileSync(MODEL_PATH)));

// The upload is written to a temp file first: phone recordings (.m4a) keep
// their index at the end of the file, which ffmpeg cannot reach through a pipe,
// and it then returns zero samples without failing.
async function decode(buffer) {
  const file = path.join(os.tmpdir(), `transcribe-${crypto.randomUUID()}`);
  await fs.promises.writeFile(file, buffer);
  try {
    const samples = await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-i', file,
        '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1',
      ]);
      const chunks = [];
      let stderr = '';
      ff.stdout.on('data', (c) => chunks.push(c));
      ff.stderr.on('data', (c) => (stderr += c));
      ff.on('error', reject);
      ff.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`));
        const bytes = Buffer.concat(chunks);
        // Copy into a fresh ArrayBuffer: Float32Array needs a 4-byte aligned offset.
        const end = bytes.byteOffset + bytes.length - (bytes.length % 4);
        resolve(new Float32Array(bytes.buffer.slice(bytes.byteOffset, end)));
      });
    });
    // No samples means the file could not be read, not that it is silent.
    if (samples.length === 0) throw new Error('ffmpeg decoded no audio');
    return samples;
  } finally {
    fs.promises.unlink(file).catch(() => {});
  }
}

async function frameProbabilities(samples) {
  const session = await getSession();
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]));
  let h = new ort.Tensor('float32', new Float32Array(128), [2, 1, 64]);
  let c = new ort.Tensor('float32', new Float32Array(128), [2, 1, 64]);
  const probs = [];
  for (let i = 0; i + FRAME <= samples.length; i += FRAME) {
    const input = new ort.Tensor('float32', samples.slice(i, i + FRAME), [1, FRAME]);
    const out = await session.run({ input, sr, h, c });
    h = out.hn;
    c = out.cn;
    probs.push(out.output.data[0]);
  }
  return probs;
}

function toRegions(probs) {
  const regions = [];
  const endFrames = Math.ceil(END_SILENCE_SEC / FRAME_SEC);
  let start = -1;
  let lastSpeech = -1;
  probs.forEach((p, i) => {
    if (start < 0) {
      if (p >= START_PROB) start = lastSpeech = i;
      return;
    }
    if (p >= END_PROB) lastSpeech = i;
    else if (i - lastSpeech >= endFrames) {
      regions.push([start, lastSpeech]);
      start = -1;
    }
  });
  if (start >= 0) regions.push([start, lastSpeech]);
  return regions
    .map(([a, b]) => ({ start: a * FRAME_SEC, end: (b + 1) * FRAME_SEC }))
    .filter((r) => r.end - r.start >= MIN_SPEECH_SEC);
}

// Returns { duration, regions: [{ start, end }] } in seconds.
async function speechRegions(buffer) {
  const samples = await decode(buffer);
  const regions = toRegions(await frameProbabilities(samples));
  return { duration: samples.length / SAMPLE_RATE, regions };
}

// Seconds of a segment that fall inside speech, with regions padded a little
// because Whisper's word times and the 96 ms frames are both approximate.
const PAD_SEC = 0.3;
function speechOverlap(segment, regions) {
  return regions.reduce((sum, r) => {
    const a = Math.max(segment.start, r.start - PAD_SEC);
    const b = Math.min(segment.end, r.end + PAD_SEC);
    return sum + Math.max(0, b - a);
  }, 0);
}

module.exports = { speechRegions, speechOverlap };
