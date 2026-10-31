// Post-processing for whisper-1 output, after word/segment alignment:
//   1. drop segments where nobody was speaking (Whisper hallucinations)
//   2. convert any Simplified Chinese left in the text to Taiwan Traditional
//   3. turn half-width punctuation inside Chinese text into full-width
// The full text is rebuilt from the kept segments, so a dropped hallucination
// never reaches the transcript.

const OpenCC = require('opencc-js');

const toTraditional = OpenCC.Converter({ from: 'cn', to: 'twp' });

// Same thresholds open-source Whisper uses to decide a segment has no speech.
const isSilent = (s) => s.no_speech_prob > 0.6 && s.avg_logprob < -1;

// Second line of defence: segments whose whole text is a known Whisper
// hallucination (TV subtitle boilerplate it learned from training data).
// Matched against the entire segment only, never removed from inside a
// sentence, so a speaker who really says something similar is kept.
// Add new lines here when they show up in the logs.
const HALLUCINATIONS = ['以上言論不代表本台立場'];

const bare = (t) => (t ?? '').replace(/[\s\p{P}\p{S}]/gu, '');
const knownHallucinations = new Set(HALLUCINATIONS.map((h) => bare(toTraditional(h))));
const isKnownHallucination = (s) => knownHallucinations.has(bare(toTraditional(s.text)));

// whisper-1 mixes punctuation widths even with a full-width prompt (it writes
// 。 and 、 but often , and !). Convert , ! ? ; : to full-width, except between
// two ASCII letters or digits, so 1,000 / 10:30 / a,b stay as they are.
// A period is converted only at the end of a segment right after a Chinese
// character, never inside text (3.5, Node.js).
const FULL_WIDTH = { ',': '，', '!': '！', '?': '？', ';': '；', ':': '：' };
const HAN = /\p{Script=Han}/u;
const ASCII_ALNUM = /[A-Za-z0-9]/;

function toFullWidthPunctuation(text) {
  if (!HAN.test(text)) return text;
  return text
    .replace(/[,!?;:]/g, (p, i, str) =>
      ASCII_ALNUM.test(str[i - 1] ?? '') && ASCII_ALNUM.test(str[i + 1] ?? '') ? p : FULL_WIDTH[p]
    )
    .replace(/([，！？；：])\s+/g, '$1')
    .replace(/(\p{Script=Han})\.(\s*)$/u, '$1。$2');
}

function cleanTranscript(segments) {
  const kept = [];
  for (const s of segments ?? []) {
    if (isSilent(s)) {
      console.warn(
        `transcribe: dropped silent segment (no_speech_prob=${s.no_speech_prob}, ` +
          `avg_logprob=${s.avg_logprob}): ${JSON.stringify(s.text)}`
      );
      continue;
    }
    if (isKnownHallucination(s)) {
      console.warn(`transcribe: dropped known hallucination: ${JSON.stringify(s.text)}`);
      continue;
    }
    kept.push({ ...s, text: toFullWidthPunctuation(toTraditional(s.text ?? '')) });
  }
  const text = kept.map((s) => s.text.trim()).join('');
  return { segments: kept, text };
}

module.exports = { cleanTranscript, toTraditional, toFullWidthPunctuation };
