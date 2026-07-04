# Mục tiêu

Bổ sung dữ liệu ngữ cảnh trận đấu (phong độ, so sánh đội, dự đoán) vào prompt AI để cải thiện chất lượng phân tích, thay vì chỉ dựa vào odds.

# Bối cảnh / Phân tích

**Vấn đề hiện tại:**
- System prompt (`betting-gemini.ts:246`) nói: "Chỉ dựa vào dữ liệu odds/correct score được cung cấp"
- AI chỉ nhận odds data → phân tích thiếu ngữ cảnh thực tế về đội bóng
- Không có thông tin phong độ, lịch sử đối đầu, so sánh sức mạnh

**Giải pháp:** Gọi thêm endpoint `/predictions?fixture={id}` của API-Football cho mỗi trận. Endpoint này trả về:
- Phong độ gần đây (5 trận gần nhất: W/D/L)
- So sánh thống kê (tấn công, phòng ngự, goals scored/conceded)
- Tỉ lệ thắng/hòa/thua dự đoán
- Advice (gợi ý kết quả)

**Ưu điểm:** 1 API call = nhiều data, tiết kiệm rate limit. Dùng chung `fetchJson` và rate limiter đã có.

**Lưu ý Free plan:** Endpoint `/predictions` có thể bị giới hạn trên free plan. Code sẽ xử lý graceful fallback — nếu không lấy được predictions thì vẫn phân tích bình thường chỉ với odds.

# Các bước thực hiện

## 1. Thêm `fetchPredictions()` vào `betting-api.ts`
- Gọi `GET /predictions?fixture={fixtureId}`
- Parse response lấy các field: `predictions.winner`, `predictions.percent`, `comparison`, `teams.home.last_5`, `teams.away.last_5`
- Return type `MatchPrediction | null` (null khi free plan không hỗ trợ hoặc lỗi)

## 2. Thêm type `MatchPrediction` vào `betting-types.ts`
```typescript
export type MatchPrediction = {
  winner: { name: string; comment: string } | null;
  percent: { home: string; draw: string; away: string };
  homeForm: string; // "WWDLW"
  awayForm: string; // "LDWWL"
  homeGoalsAvg: number; // goals scored per game
  awayGoalsAvg: number;
  comparison: Record<string, { home: string; away: string }>; // att, def, etc.
};
```

## 3. Mở rộng `MatchOddsPayload` trong `betting-types.ts`
- Thêm field optional: `prediction?: MatchPrediction`

## 4. Cập nhật `buildOddsPayload()` trong `betting.ts`
- Sau khi fetch odds, gọi thêm `fetchPredictions(match.gameId)` cho mỗi trận
- Dùng `Promise.allSettled` để không fail cả batch nếu 1 trận lỗi
- Gắn prediction vào payload nếu có

## 5. Thêm hàm `formatPredictionInput()` vào `odds-text-format.ts`
- Format prediction data thành text compact cho AI:
```
CONTEXT: Form H=WWDLW A=LDWWL | Win% H=45% D=25% A=30% | GoalsAvg H=1.8 A=1.2
```

## 6. Cập nhật `formatOddsAnalysisInput()` trong `odds-text-format.ts`
- Nếu payload có prediction, append prediction context vào cuối odds text

## 7. Cập nhật `buildCombinedSystemPrompt()` trong `betting-gemini.ts`
- Bỏ dòng "Chỉ dựa vào dữ liệu odds/correct score được cung cấp"
- Thêm: "Kết hợp dữ liệu odds VÀ ngữ cảnh trận đấu (phong độ, so sánh đội) để phân tích. Nếu không có dữ liệu ngữ cảnh, chỉ dựa vào odds."

## 8. Cập nhật `buildCombinedUserPrompt()` trong `betting-gemini.ts`
- Gọi `formatOddsAnalysisInput()` đã bao gồm prediction context

# Rủi ro / Lưu ý

- **Free plan có thể chặn `/predictions`**: Code phải handle graceful — try/catch, return null, phân tích vẫn chạy chỉ với odds
- **Rate limit**: Thêm N API calls cho N trận (thường 3-8 trận/ngày). Với 100 RPM và rate limiter đã có, không ảnh hưởng
- **Token usage tăng**: Mỗi trận thêm ~50-80 tokens context. Với 3-8 trận, tăng ~150-640 tokens — chấp nhận được so với limit 5000 output tokens
- **Backward compatibility**: `prediction` là optional field → không break existing snapshots hoặc backtest

# Tiêu chí hoàn thành

1. `fetchPredictions()` hoạt động, trả về data hoặc null khi lỗi
2. AI prompt nhận được prediction context kèm odds
3. Nếu `/predictions` bị chặn (free plan), system vẫn chạy bình thường chỉ với odds
4. Build pass (`npx tsc --noEmit`)
5. Test existing pass (`npx vitest run`)
6. Chạy thử `runOddsCheck()` và xác nhận message Telegram có chất lượng phân tích tốt hơn
