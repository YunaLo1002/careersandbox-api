# 面試紀錄 API（interview-sessions）

後端：careersandbox-api（Node，port 8000）
狀態：已 merge 至 main，single / panel / group 三種模式皆已在 Atlas 實測

## 整體流程

1. 前端跟模型服務（FastAPI，port 8002）進行面試，取得 `sessionId`（格式 `itv_xxx`，由模型服務產生）
2. 面試結束，前端向模型服務要報告：`POST /interviews/{sessionId}/report`
3. 前端把報告連同面試過程送到後端存檔：`POST /interview-sessions`
4. 歷史紀錄頁用 `GET /interview-sessions` 列表，點進去用 `GET /interview-sessions/{sessionId}` 看完整報告

> 第 1、2 步前端是直接打 8002，還是經由 Node 轉發，尚待三組確認。不影響本文件的三支 API。

## 共通規則

- 三支 API 都要登入：Header 帶 `Authorization: Bearer <token>`
- 使用者身分一律從 token 取得，**body 不需要也不要帶 userId**
- 每個人只看得到、改得到自己的紀錄
- 錯誤格式統一：`{ "error": { "code": "...", "message": "..." } }`
- body 上限 1MB（群面逐字稿較長，已放寬）

---

## 1. 存檔 `POST /interview-sessions`

同一個 `sessionId` 再送一次會**更新**原本那筆，不會新增第二筆，`createdAt` 維持第一次存檔時間。

### Request body

| 欄位 | 型別 | 必填 | 說明 |
|---|---|---|---|
| `sessionId` | string | ✅ | 模型服務給的 `itv_xxx` |
| `report` | object | ✅ | 模型服務 report API 的回傳，**整份原樣放進來** |
| `mode` | string | | `single` / `panel` / `group`。沒給就用 `report.mode` |
| `config` | object | | 面試設定，至少放 `targetJobTitle`（列表頁會顯示） |
| `participants` | array | | 面試官或群面同儕，用模型服務開場回傳的 personas |
| `turns` | array | | 一對一、panel 的問答紀錄，格式同送給模型服務產報告的 turns |
| `groupSays` | array | | 群面逐則發言，格式見下方，僅 group 模式 |
| `jdSkills` | string[] | | 開場 `POST /interviews` 回傳的 `jdSkills`，**原樣送，不要排序或去重**（順序就是重要性） |
| `overallScore` | number \| null | | 模型算的總分 0–100，**浮點數，不要取整數**。`null` 代表這場沒有任何一項可評，不是 0 分。沒送就讀 `report.overallScore` |
| `scoreBasis` | int \| null | | 總分是用**幾項**細分算出來的（例如表達流暢度量不到時是 5）。沒送就讀 `report.scoreBasis` |
| `openingIntro` | string | | 開場 `POST /interviews` 回傳的面試官自我介紹，原樣送 |
| `resumeVersionId` | string | | 這場面試用的履歷版本 id（`resume_versions` 的 id）。必須是這個使用者自己的版本，否則會被忽略 |

> 以下**不用送來存**：`probeGap`、`probeDepth`（每輪傳輸用的暫態）、`experiences`（資料庫本來就有，存 `resumeVersionId` 即可）、`askedQuestions`（就是 `turns[].question`）、面試階段（由 `followUpIdx` 算出）。

`participants` 每一位：

```json
{ "id": "peer_logic", "displayName": "AI-邏輯", "role": "peer", "blurb": "質疑數據與推論的跳躍。" }
```

`turns` 每一題（模型組 schema 交接建議的欄位，之後重跑分析需要）：

```json
{
  "turnOrder": 1,
  "speaker": "HR 面試官",
  "question": "請簡單自我介紹",
  "answer": "……",
  "inputMode": "voice",
  "answerSegments": ["……", "……"],
  "segmentStartsMs": [0, 4200],
  "segmentEndsMs": [3900, 8100],
  "endedBy": "user"
}
```

`inputMode`：`voice` / `typed` / `unknown`；`endedBy`：`user` / `timeout` / `unknown`；`segmentEndsMs` 與 `answerSegments` 等長，是每段結束的時間（毫秒）

`groupSays` 每一則：

```json
{
  "speaker": "你",
  "content": "我同意先看客群，不過預算只有五十萬……",
  "isUser": true,
  "segments": ["我同意先看客群，", "不過預算只有五十萬……"],
  "segmentStartsMs": [3200, 5800],
  "inputMode": "voice"
}
```

### Response `201`

回傳內容與「3. 單筆」相同。

### 範例

```json
{
  "sessionId": "itv_d3e0a549a608",
  "mode": "group",
  "config": { "targetJobTitle": "行銷企劃" },
  "participants": [ { "id": "moderator", "displayName": "主考官", "role": "moderator", "blurb": "主持討論,不評論。" } ],
  "turns": [],
  "groupSays": [ { "speaker": "AI-邏輯", "content": "……", "isUser": false, "segments": ["……"], "segmentStartsMs": [0], "inputMode": "voice" } ],
  "report": { "mode": "group", "faceDimensions": [ … ], "subScores": [ … ], "notices": [ … ] }
}
```

---

## 2. 列表 `GET /interview-sessions`

自己的所有面試紀錄，新的在前。只回摘要，不含報告內容。

### Response `200`

```json
[
  { "id": "itv_panel_test01", "mode": "panel", "jobTitle": "測試職缺", "score": null, "createdAt": "2026-10-14T03:32:05.161Z" },
  { "id": "itv_d3e0a549a608", "mode": "group", "jobTitle": "群面測試", "score": null, "createdAt": "2026-10-14T03:18:38.599Z" }
]
```

- `jobTitle` 來自 `config.targetJobTitle`，沒填會是空字串
- `score` 目前恆為 `null`，總分怎麼算尚待三組決定，前端先顯示「—」或不顯示

---

## 3. 單筆 `GET /interview-sessions/{sessionId}`

### Response `200`

```json
{
  "id": "itv_d3e0a549a608",
  "mode": "group",
  "score": null,
  "scoreBasis": null,
  "config": { "targetJobTitle": "群面測試" },
  "participants": [ … ],
  "turns": [],
  "groupSays": [ … ],
  "jdSkills": ["SQL", "Python"],
  "openingIntro": "你好，我是聯發科資料分析實習生的面試官……",
  "resumeVersion": { "id": "6acf…", "label": "版本 B" },
  "report": { … 模型服務的報告原樣 … },
  "createdAt": "2026-10-14T03:18:38.599Z"
}
```

報告畫面直接讀 `report`，欄位與模型服務回傳完全一致。

`resumeVersion` 沒有對應版本時是 `null`。報告頁可以顯示「本次以 版本 B（`createdAt` 當天）為準」，因為履歷版本之後可能被編輯過，報告的「還缺什麼」可能和現在的履歷對不上。

---

## 錯誤碼

| 狀態碼 | code | 什麼時候 |
|---|---|---|
| 422 | `validation_error` | 缺 `sessionId` 或 `report`，或 `mode` 不是三種之一 |
| 401 | `unauthorized` | 沒帶 token 或 token 失效 |
| 404 | `not_found` | 查的紀錄不存在，或不是自己的 |
| 409 | `conflict` | 這個 `sessionId` 已被其他帳號存過 |

---

## 前端需要配合的地方

1. **`groupSays` 型別改成物件**：原本是 `List<String>`，要改成上面的物件格式
2. **群面要記錄所有發言者**：目前 `submitGroup` 只記使用者自己的話，AI 同儕的發言要一起記。`messages` 已有 `speaker` 欄位可直接轉
3. **身分用 `isUser` 判斷**：使用者的 `speaker` 維持送「你」，不要改成 `"user"`；AI 同儕是 persona 的 `displayName`
4. **同一份 `groupSays` 產報告和存檔都要帶**：產報告時放在 request 最外層（和 `mode`、`turns` 同層），模型才看得到發言內容
5. **`report` 不要改動**，整份原樣存，後端不解析報告內部欄位
6. **`participants` 用開場（`POST /interviews`）回傳的 `personas`**，報告裡沒有這份資料，要在開場時先存起來

## 待決事項

- `score`（總分）：已決定由模型計算（不是單純平均），模型組上線後後端會自動從報告讀取，目前恆為 `null`；顯示時要寫成摘要數字，不要寫成「你的面試得分」
- 面試與產報告是否經由 Node 轉發：三組確認
- 群面協作評分（`report.collabDims`）目前為空，會出現「協作評分尚未啟用」提示，屬預期行為，待模型組啟用
