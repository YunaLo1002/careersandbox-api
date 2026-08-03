/**
 * Parse the legacy free-text `period` field into structured dates.
 *
 * The existing schema stores period as a single string ("2025.6"), which
 * cannot be sorted chronologically — lexicographically "2025.10" sorts
 * BEFORE "2025.6" because '1' < '6'. Resume sections would come out in the
 * wrong order.
 *
 * Users type dates in many shapes, so this parser is deliberately permissive
 * and reports failures instead of guessing.
 */

const PRESENT_TOKENS = [
  '至今', '迄今', '現在', '目前', 'present', 'now', 'current', 'ongoing', '今',
];

const SEPARATORS = /\s*(?:[-–—~～]|to|至|到)\s*/i;

/**
 * Parse one side of a range into { year, month }.
 * Accepts: 2025.6 / 2025/06 / 2025-6 / 2025年6月 / 202506 / 2025
 */
function parseOne(text) {
  if (!text) return null;
  const s = String(text).trim();
  if (!s) return null;

  const valid = (year, month) => {
    if (!year || year < 1900 || year > 2100) return null;
    if (month !== null && (month < 1 || month > 12)) return null;
    return { year, month };
  };

  // 2025年6月 or 2025年
  let m = s.match(/^(\d{4})\s*年\s*(?:(\d{1,2})\s*月?)?/);
  if (m) return valid(+m[1], m[2] ? +m[2] : null);

  // 2025.6 / 2025/06 / 2025-6 / 2025 6
  m = s.match(/^(\d{4})\s*[.\/\-\s]\s*(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2]);

  // 202506
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return valid(+m[1], +m[2]);

  // 6/2025
  m = s.match(/^(\d{1,2})\s*[.\/\-]\s*(\d{4})$/);
  if (m) return valid(+m[2], +m[1]);

  // bare year
  m = s.match(/^(\d{4})$/);
  if (m) return valid(+m[1], null);

  return null;
}

function isPresent(text) {
  if (!text) return false;
  const s = String(text).trim().toLowerCase();
  return PRESENT_TOKENS.some((t) => s.includes(t.toLowerCase()));
}

function toDate({ year, month }, { endOfMonth = false } = {}) {
  if (!year) return null;
  const mo = month ? month - 1 : 0;
  if (mo < 0 || mo > 11) return null;
  if (endOfMonth) {
    // last day of that month, UTC
    return new Date(Date.UTC(year, mo + 1, 0));
  }
  return new Date(Date.UTC(year, mo, 1));
}

/**
 * @param {string} raw
 * @returns {{
 *   startDate: Date|null,
 *   endDate: Date|null,
 *   isCurrent: boolean,
 *   precision: 'month'|'year'|null,
 *   ok: boolean,
 *   reason: string
 * }}
 */
function parsePeriod(raw) {
  const fail = (reason) => ({
    startDate: null,
    endDate: null,
    isCurrent: false,
    precision: null,
    ok: false,
    reason,
  });

  if (raw === null || raw === undefined) return fail('empty');
  const s = String(raw).trim();
  if (!s) return fail('empty');

  // Try the whole string as one date FIRST. Otherwise "2025-6" gets split on
  // the hyphen and misread as the range "2025" to "6".
  const whole = parseOne(s);
  if (whole) {
    return {
      startDate: toDate(whole),
      endDate: null,
      isCurrent: false,
      precision: whole.month ? 'month' : 'year',
      ok: true,
      reason: 'start-only',
    };
  }

  const parts = s.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);

  // Single value: treat as start only.
  if (parts.length === 1) {
    // "至今" alone carries no start date.
    if (isPresent(parts[0])) return fail('only-present-token');
    const one = parseOne(parts[0]);
    if (!one) return fail('unparseable');
    return {
      startDate: toDate(one),
      endDate: null,
      isCurrent: false,
      precision: one.month ? 'month' : 'year',
      ok: true,
      reason: 'start-only',
    };
  }

  // Range.
  const startRaw = parts[0];
  const endRaw = parts.slice(1).join(' ');

  const start = parseOne(startRaw);
  if (!start) return fail('unparseable-start');

  if (isPresent(endRaw)) {
    return {
      startDate: toDate(start),
      endDate: null,
      isCurrent: true,
      precision: start.month ? 'month' : 'year',
      ok: true,
      reason: 'range-present',
    };
  }

  const end = parseOne(endRaw);
  if (!end) {
    return {
      startDate: toDate(start),
      endDate: null,
      isCurrent: false,
      precision: start.month ? 'month' : 'year',
      ok: true,
      reason: 'unparseable-end',
    };
  }

  const startDate = toDate(start);
  const endDate = toDate(end, { endOfMonth: true });

  if (endDate && startDate && endDate < startDate) {
    return {
      startDate,
      endDate: null,
      isCurrent: false,
      precision: start.month ? 'month' : 'year',
      ok: false,
      reason: 'end-before-start',
    };
  }

  return {
    startDate,
    endDate,
    isCurrent: false,
    precision: start.month && end.month ? 'month' : 'year',
    ok: true,
    reason: 'range',
  };
}

/** Rebuild a display string from structured dates (for the reverse direction). */
function formatPeriod(startDate, endDate, isCurrent, precision = 'month') {
  if (!startDate) return '';
  const fmt = (d) =>
    precision === 'year'
      ? String(d.getUTCFullYear())
      : `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const start = fmt(startDate);
  if (isCurrent) return `${start} - 至今`;
  if (!endDate) return start;
  return `${start} - ${fmt(endDate)}`;
}

module.exports = { parsePeriod, formatPeriod, parseOne, isPresent };
