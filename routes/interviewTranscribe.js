// routes/interviewTranscribe.js
const express = require('express');
const multer = require('multer');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// memoryStorage：檔案先暫存在記憶體裡，不寫進硬碟。
// 因為我們錄音上限只有 120 秒、檔案不大，這樣做完轉錄就丟掉，不用額外清理暫存檔。
// limits.fileSize：多留一點餘裕，避免正常錄音被誤擋（120 秒的音檔通常遠小於這個數字）。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
});

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

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
    // 模型組需要 segment 級別的時間戳記跟每段的信心指標，這兩個參數是關鍵：
    // verbose_json 讓 OpenAI 除了整段文字，額外回傳 segments 陣列；
    // timestamp_granularities[] 指定要 segment 級（不要 word 級，避免多餘延遲）
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');

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
    return res.status(200).json({
      text: data.text ?? '',
      duration: data.duration ?? null,
      segments: (data.segments ?? []).map((s) => ({
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