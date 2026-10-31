// routes/interviewTranscribe.js
const express = require('express');
const multer = require('multer');
const requireAuth = require('../middleware/requireAuth');
const { tightenSegments } = require('../utils/tightenSegments');
const { cleanTranscript } = require('../utils/cleanTranscript');

const router = express.Router();

// memoryStorage：檔案先暫存在記憶體裡，不寫進硬碟。
// 因為我們錄音上限只有 120 秒、檔案不大，這樣做完轉錄就丟掉，不用額外清理暫存檔。
// limits.fileSize：多留一點餘裕，避免正常錄音被誤擋（120 秒的音檔通常遠小於這個數字）。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
});

// Keep whisper-1. gpt-4o-transcribe / gpt-4o-mini-transcribe only return plain
// json with no timestamps at all, which would make pauses unmeasurable.
// Check with the model team before overriding this.
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

// Whisper copies the style of the prompt, so a Traditional Chinese prompt with
// full-width punctuation steers the output that way. Keep it short: in silent
// stretches Whisper may write prompt words out as if they were spoken.
const TRANSCRIBE_PROMPT = '以下是一段面試回答，使用繁體中文與全形標點。';

// POST /interview/transcribe — 收一個音檔欄位叫 "audio"，回傳轉錄文字
// upload.single('audio')：告訴 multer「這個路由只收一份檔案，表單欄位名稱是 audio」，
// 這個 'audio' 要跟前端 Kotlin 那邊 MultipartBody.Part.createFormData("audio", ...) 的名字對上，已經對過了。
router.post('/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(422).json({ error: { code: 'validation_error', message: '沒有收到音檔' } });
    }
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not set — transcription cannot work');
      return res.status(503).json({
        error: { code: 'ai_not_configured', message: '語音轉文字功能尚未設定完成' },
      });
    }

    // Whisper 的轉錄端點跟 experienceChat.js 用的 chat completions 端點不一樣，
    // 它也是吃 multipart/form-data（跟前端傳給我們的方式一樣），所以這裡也要用 FormData 包一次再轉送出去。
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: 'audio/mp4' }), 'audio.m4a');
    form.append('model', TRANSCRIBE_MODEL);
    // 模型組需要 segment 級別的時間戳記跟每段的信心指標：
    // verbose_json 讓 OpenAI 除了整段文字，額外回傳 segments 陣列。
    // Word timestamps are requested too: segment times are coarse and
    // back-to-back, so pauses only show up once segments are re-bounded by
    // their own words (see utils/tightenSegments.js). Word granularity adds
    // some latency; the elapsed time is logged below so it can be measured.
    form.append('response_format', 'verbose_json');
    // Without a language Whisper guesses per request; 'zh' covers both scripts,
    // Traditional output comes from the prompt plus the conversion below.
    form.append('language', 'zh');
    form.append('prompt', TRANSCRIBE_PROMPT);
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');

    const startedAt = Date.now();

    const aiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      // 轉錄一段 2 分鐘音檔可能比一般聊天 API 慢一些，給多一點緩衝時間
      signal: AbortSignal.timeout(60000),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('OpenAI transcription error:', aiRes.status, errText);
      return res.status(502).json({ error: { code: 'ai_unavailable', message: '轉錄服務暫時無法回應，請稍後再試' } });
    }

    const data = await aiRes.json();
    const elapsedMs = Date.now() - startedAt;

    // Re-bound each segment by its first and last word. If words and segments
    // do not spell the same text, Whisper's own times are kept and the model
    // service treats pauses for this answer as unavailable.
    const { segments: alignedSegments, aligned } = tightenSegments(data.segments, data.words);
    // Order matters: align first (needs every segment), then drop silent or
    // hallucinated segments, then rebuild the text from what is left. data.text
    // is not used because it still contains the dropped sentences.
    const { segments, text } = cleanTranscript(alignedSegments);
    console.log(
      `transcribe: audio ${data.duration ?? '?'}s, took ${elapsedMs}ms, ` +
        `${(data.words ?? []).length} words, ${segments.length} segments, aligned=${aligned}`
    );
    if (!aligned && (data.segments ?? []).length > 0) {
      console.warn('transcribe: word/segment text mismatch, kept original segment times');
    }

    // Response shape is unchanged; times stay in seconds. Clients converting
    // to ms must use Math.round(sec * 1000), never truncate to whole seconds.
    return res.status(200).json({
      text,
      duration: data.duration ?? null,
      segments: segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        avgLogprob: s.avg_logprob,
        noSpeechProb: s.no_speech_prob,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: { code: 'internal_error', message: '服務暫時無法回應，請稍後再試' } });
  }
});

module.exports = router;