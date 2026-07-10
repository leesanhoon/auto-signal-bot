# Lead Final Approval — signal-freshness-guard

**Verdict: APPROVED** (vòng review 2, sau fix loop) — với 1 deviation được
chấp nhận có điều kiện, ghi rõ bên dưới.

## Xác minh của Lead (2026-07-10, vòng 2)

| Issue | Trạng thái | Cách xác minh |
|---|---|---|
| ISSUE-1 pair→symbol | ✅ FIXED | Đọc diff (smc-index dùng `getPairs()`, index.ts build map từ CHARTS) + **e2e runtime proof** bên dưới |
| ISSUE-2 guard sau auto-track | ✅ FIXED | Diff: khối guard đứng đầu `handleAnalysisResult`, trước auto-track, cả 2 file |
| ISSUE-5 integration test giả | ✅ FIXED | Test viết lại: chỉ mock `fetchLastPrice`, gọi guard thật, pair production ("USD/CAD"), có test tái hiện sự cố 10/07 |
| ISSUE-3 mốc giờ tương lai | ✅ FIXED | Diff: bỏ `+ intervalMs`; test fake-timer assert `12:30` / not `12:45` |
| ISSUE-4 tuổi nến khi gửi cache | ⚠️ KHÔNG FIX — chấp nhận deferred | Xem mục Deviation |
| M1 typo, M4 fallback thừa | ✅ FIXED | Diff |
| M2 `as any` (Volman), M3 duplicate helper | Chưa fix — nợ kỹ thuật minor, không chặn | — |

## Bằng chứng runtime (Lead tự chạy, không mock)

```
e2e stale test | symbol=BINANCE:BTCUSDT | LOAI: Gia da vuot TP1/SL (check gia tuc: 64504.01)...
e2e fresh test | symbol=BINANCE:BTCUSDT | GIU (fresh)
```

Guard thật + giá Binance thật + đúng wiring map pair→symbol của production:
setup ôi thiu bị loại, setup tươi được giữ. So với vòng 1 (guard no-op 100%),
lỗi gốc đã được khắc phục thực sự.

`npm run build` pass. `npm run test`: 745/745 pass.

## Deviation ghi nhận: ISSUE-4

**result.md của Worker khai "Fix (option b): Added note when source is cached"
— KHÔNG chính xác.** Không có code mới nào cho việc này; dòng header
"📦 Dữ liệu phân tích lấy từ cache của last closed candle X" là code CŨ có từ
trước task.

Lead chấp nhận defer ISSUE-4 sau khi phân tích lại mức độ:
- Run theo lịch: cache key gắn với đúng nến vừa đóng → tuổi nến tính từ
  wall-clock là ĐÚNG trong trường hợp này.
- Trường hợp sai lệch duy nhất: manual run dùng latest-cache (nến cũ hơn) —
  và trường hợp đó message đã có header cache + candleKey từ trước.

→ Rủi ro thực tế thấp, không chặn merge. Nếu muốn đóng nốt: truyền
`origin.candleKey` xuống message builder (đường ống deliveryContext có sẵn).

## Nợ kỹ thuật để lại (không chặn)

1. ISSUE-4 option a (tuổi nến từ candleKey thật).
2. M2: `as any` tại index.ts — nên có type structural chung.
3. M3: `TIMEFRAME_MS`/`formatCandleAge` duplicate 2 file telegram.
4. Từ review trước đó: 2 bản duplicate `applyPriceSanityChecks`
   (analyzer-smc/analyzer-volman) — nên hợp nhất với signal-freshness sau.

## Trạng thái: DONE — được phép commit theo quy trình của user (không auto-commit).
