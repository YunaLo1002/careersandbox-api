// Tighten Whisper segment boundaries using word-level timestamps.
//
// Whisper's segment times are coarse (often whole seconds) and segments are
// usually back-to-back, so the gap between them (how the model service
// measures pauses) comes out as 0. Word times are per word, so silence between
// words becomes visible once each segment is re-bounded by its own words.
//
// Words are assigned to segments by text order, never by time: a coarse
// boundary can cut through a word, and assigning by time would push the first
// word after a pause into the previous segment, hiding the pause again.
//
// If the words and segments do not spell the same text, the original Whisper
// times are returned unchanged; the model service then marks pauses for that
// answer as unavailable instead of reporting a wrong number.

const norm = (t) => (t ?? '').replace(/[\s\p{P}\p{S}]/gu, '');

function tightenSegments(segments = [], words = []) {
  const segs = segments ?? [];
  const ws = words ?? [];
  if (segs.length === 0 || ws.length === 0) {
    return { segments: segs, aligned: false };
  }

  let wi = 0;
  let carry = 0; // characters of the previous segment's last word that spill into this one
  const tightened = segs.map((s) => {
    let need = norm(s.text).length - carry;
    carry = 0;
    const mine = [];
    while (need > 0 && wi < ws.length) {
      const w = ws[wi++];
      mine.push(w);
      need -= norm(w.word).length;
    }
    if (need < 0) carry = -need;
    if (mine.length === 0) return s;
    return { ...s, start: mine[0].start, end: mine[mine.length - 1].end };
  });

  const total = (xs, f) => xs.reduce((n, x) => n + norm(f(x)).length, 0);
  const aligned =
    wi === ws.length && total(ws, (w) => w.word) === total(segs, (s) => s.text);

  return { segments: aligned ? tightened : segs, aligned };
}

module.exports = { tightenSegments };
