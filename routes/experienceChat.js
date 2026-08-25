// routes/experienceChat.js
const express = require('express');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SYSTEM_PROMPT = `你是「經歷精靈」，透過對話引導使用者描述一段個人經歷（求職履歷用）。
你的目標是挖出以下欄位的內容：
- role：使用者在這段經歷中扮演的角色
- action：使用者實際做了什麼行動
- result：這段經歷產生了什麼結果或成效
- learning：使用者從中學到了什麼（非必要，但盡量問）

規則：
1. 每次只問「一個」追問，語氣口語、友善、繁體中文，像朋友聊天一樣。
2. 根據使用者目前為止的回答，判斷哪些欄位還不夠清楚，針對性追問。
3. 最多問 4 輪，不要無止盡地問下去。
4. 當 role、action、result 都已經有足夠具體的內容時，將 done 設為 true，
   並在 extractedFields.title 填入一個 15 字以內的簡短標題建議，nextQuestion 設為 null。
5. 你必須只輸出一個 JSON 物件，不要有任何其他文字、不要用 markdown 程式碼區塊包住，格式固定如下：
{
  "nextQuestion": string 或 null,
  "extractedFields": { "role": string, "action": string, "result": string, "learning": string, "title": string },
  "done": boolean
}
extractedFields 裡，還不確定的欄位就留空字串，不要瞎猜。`;

// POST /experience-chat/turn — one turn of the guided chat, no DB writes here
router.post('/turn', requireAuth, async (req, res) => {
  try {
    const { history, answer } = req.body ?? {};
    if (typeof answer !== 'string' || !answer.trim()) {
      return res.status(400).json({ detail: 'Missing answer' });
    }

    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    if (Array.isArray(history)) {
      for (const turn of history) {
        if (!turn || typeof turn.text !== 'string') continue;
        messages.push({
          role: turn.speaker === 'user' ? 'user' : 'assistant',
          content: turn.text,
        });
      }
    }
    messages.push({ role: 'user', content: answer });

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('OpenAI API error:', aiRes.status, errText);
      return res.status(502).json({ detail: 'AI service unavailable' });
    }

    const data = await aiRes.json();
    const raw = data?.choices?.[0]?.message?.content;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error('Failed to parse AI JSON:', raw);
      // Don't crash the flow — ask the user to rephrase instead
      return res.status(200).json({
        nextQuestion: '不好意思，我剛剛沒聽懂，可以換個方式再說一次嗎？',
        extractedFields: {},
        done: false,
      });
    }

    return res.status(200).json({
      nextQuestion: parsed.nextQuestion ?? null,
      extractedFields: parsed.extractedFields ?? {},
      done: Boolean(parsed.done),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;