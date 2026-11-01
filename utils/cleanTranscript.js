// Post-processing for whisper-1 output, after word/segment alignment:
//   1. drop segments that sit where the audio has no speech (speech regions
//      from utils/speechRegions.js), are silent by Whisper's own measure, or
//      are Whisper stuck repeating
//   2. convert any Simplified Chinese left in the text to Taiwan Traditional
//   3. turn half-width punctuation inside Chinese text into full-width
//   4. drop sentences that are known hallucinations, close each segment with
//      punctuation when Whisper left it bare
// The full text is rebuilt from the kept segments, so a dropped hallucination
// never reaches the transcript.

const OpenCC = require('opencc-js');
const { speechOverlap } = require('./speechRegions');

// Character conversion only ('tw'), not 'twp': 'twp' also swaps mainland
// vocabulary for Taiwan vocabulary, and since every character of 支持, 文件,
// 社區, 數據 or 項目 is the same in both scripts it rewrites them even in text
// Whisper already wrote in Traditional (支持 -> 支援, 文件 -> 檔案), so the
// transcript would no longer say what the candidate said. Whisper spells the
// words it hears, so converting the characters is enough.
const toTw = OpenCC.Converter({ from: 'cn', to: 'tw' });

// Even 'tw' changes some characters that are correct Traditional as written
// (台 -> 臺, 里 -> 裡). A segment is only converted when it has a Simplified
// character other than these, and 台 is always kept as the speaker's spelling.
const SHARED = new Set(['台', '里']);

function toTraditional(text) {
  const src = Array.from(text ?? '');
  const out = Array.from(toTw(text ?? ''));
  if (src.length !== out.length) return out.join('');
  const hasSimplified = src.some((c, i) => c !== out[i] && !SHARED.has(c));
  if (!hasSimplified) return src.join('');
  return out.map((c, i) => (src[i] === '台' ? '台' : c)).join('');
}

// Sent to whisper-1 as the prompt (see routes/interviewTranscribe.js). Whisper
// copies its style, so a Traditional prompt with full-width punctuation steers
// the output that way. In silence Whisper may write the prompt out as if it
// had been spoken, so its sentences are also filtered as hallucinations below.
const TRANSCRIBE_PROMPT = '以下是一段面試回答，使用繁體中文與全形標點。';

// Same thresholds open-source Whisper uses to decide a segment has no speech.
const isSilent = (s) => s.no_speech_prob > 0.6 && s.avg_logprob < -1;

// Also from open-source Whisper: text that compresses this well is a
// repetition loop (the same phrase over and over), a common failure in long
// silences that the no-speech check misses.
const isRepetitionLoop = (s) => s.compression_ratio > 2.4;

// Second line of defence: sentences that are a known Whisper hallucination
// (subtitle and broadcast boilerplate it learned from training data). Matched
// one whole sentence at a time, so a hallucination glued onto real speech in
// the same segment is removed too, while a sentence that only contains a
// similar phrase is kept. Add new lines here when they show up in the logs.
const HALLUCINATIONS = [
  '以上言論不代表本台立場',
  '字幕由Amara.org社區提供',
  '請不吝點贊訂閱轉發打賞支持明鏡與點點欄目',
  '優優獨播劇場YoYo Television Series Exclusive',
];

const bare = (t) => (t ?? '').replace(/[\s\p{P}\p{S}]/gu, '');
// A sentence is a run of text plus the punctuation that closes it.
const splitSentences = (text) => text.match(/[^。！？；，\n]+[。！？；，]*/gu) ?? [];

const knownHallucinations = new Set(
  [...HALLUCINATIONS, ...splitSentences(TRANSCRIBE_PROMPT)].map((h) => bare(toTraditional(h)))
);
const isKnownHallucination = (sentence) => knownHallucinations.has(bare(sentence));

// Closing lines from video subtitles. Whisper often writes one of these into
// the silence at the end of a recording (謝謝大家 with no_speech_prob 0.96 but
// avg_logprob only -0.73, so isSilent misses it). A candidate may really say
// them, so they are only dropped when Whisper itself thinks the stretch is
// probably silent, without also requiring the low avg_logprob.
const CLOSING_LINES = ['謝謝大家', '謝謝觀看', '謝謝收看', '謝謝觀賞', '感謝收看', '感謝觀看', '謝謝', '請訂閱'];
const closingLines = new Set(CLOSING_LINES.map((h) => bare(toTraditional(h))));
const isLikelySilent = (s) => s.no_speech_prob > 0.6;

// Text with no audio behind it gets word timestamps squeezed into a sliver of
// time: in a silent test recording Whisper wrote 16 characters into 0.16 s
// (100 per second). Mandarin is spoken at about 4-7 characters per second, so
// a probably-silent segment of 4 or more units faster than 10 per second is
// dropped whatever its text says, instead of chasing each new phrase with the
// lists above. Only used when segment times come from the words (aligned);
// Whisper's own segment times are too coarse for this. A unit is one Chinese
// character or one run of letters or digits (Python, 3.5).
const MAX_UNITS_PER_SECOND = 10;
const MIN_UNITS = 4;
const speechUnits = (t) => (t.match(/\p{Script=Han}|[A-Za-z0-9]+(?:[.,][0-9]+)*/gu) ?? []).length;
function isTooFast(s, text) {
  const units = speechUnits(text);
  const seconds = s.end - s.start;
  return units >= MIN_UNITS && (seconds <= 0 || units / seconds > MAX_UNITS_PER_SECOND);
}

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

// Whisper sometimes returns a segment with no punctuation at all, and the
// full text joins segments with nothing between them, so sentences would run
// together. Segments end at pauses, so a missing mark at the end of one is
// filled with ，, and the answer ends with 。. Punctuation missing inside a
// segment cannot be recovered without rewriting the text, so it is left alone.
const ENDS_WITH_PUNCTUATION = /\p{P}$/u;

function closeSegments(kept) {
  for (const s of kept) {
    s.text = s.text.trim();
    if (HAN.test(s.text) && !ENDS_WITH_PUNCTUATION.test(s.text)) s.text += '，';
  }
  const last = kept[kept.length - 1];
  if (last && last.text.endsWith('，')) last.text = last.text.slice(0, -1) + '。';
}

// Main hallucination check, using the speech regions found in the audio (see
// utils/speechRegions.js): a segment is dropped when less than half of it, or
// less than 0.3 s, lies where someone was speaking. Only applied when segment
// times come from the words; Whisper's own times are too coarse. The lists and
// rules above remain as a fallback for when speech detection is unavailable.
function hasSpeechUnder(s, speech) {
  const seconds = Math.max(0, s.end - s.start);
  return speechOverlap(s, speech) >= Math.min(0.3, seconds * 0.5);
}

function cleanTranscript(segments, { aligned = false, speech = null } = {}) {
  const kept = [];
  for (const s of segments ?? []) {
    if (isSilent(s)) {
      console.warn(
        `transcribe: dropped silent segment (no_speech_prob=${s.no_speech_prob}, ` +
          `avg_logprob=${s.avg_logprob}): ${JSON.stringify(s.text)}`
      );
      continue;
    }
    if (aligned && speech && !hasSpeechUnder(s, speech)) {
      console.warn(
        `transcribe: dropped segment with no speech under it (${s.start}-${s.end}s): ${JSON.stringify(s.text)}`
      );
      continue;
    }
    if (isRepetitionLoop(s)) {
      console.warn(
        `transcribe: dropped repetition loop (compression_ratio=${s.compression_ratio}): ` +
          JSON.stringify(s.text)
      );
      continue;
    }
    if (aligned && isLikelySilent(s) && isTooFast(s, s.text ?? '')) {
      const seconds = (s.end - s.start).toFixed(2);
      console.warn(
        `transcribe: dropped text with no audio behind it (${speechUnits(s.text)} units in ${seconds}s, ` +
          `no_speech_prob=${s.no_speech_prob}): ${JSON.stringify(s.text)}`
      );
      continue;
    }
    const sentences = splitSentences(toFullWidthPunctuation(toTraditional(s.text ?? '')));
    const isHallucination = (x) =>
      isKnownHallucination(x) || (isLikelySilent(s) && closingLines.has(bare(x)));
    const real = sentences.filter((x) => !isHallucination(x));
    if (real.length < sentences.length) {
      const dropped = sentences.filter(isHallucination).join('');
      console.warn(`transcribe: dropped known hallucination: ${JSON.stringify(dropped)}`);
    }
    // Segment times are kept as they are when only part of a segment is
    // removed; without the words there is nothing to re-bound them by.
    if (real.length === 0 || !bare(real.join(''))) continue;
    kept.push({ ...s, text: real.join('') });
  }
  closeSegments(kept);
  const text = kept.map((s) => s.text).join('');
  return { segments: kept, text };
}

module.exports = { cleanTranscript, toTraditional, toFullWidthPunctuation, TRANSCRIBE_PROMPT };
