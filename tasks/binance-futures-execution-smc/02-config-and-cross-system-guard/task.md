# Task 02: Kill-switch riêng cho SMC + guard đối xứng chống xung đột SL cross-system

## Bối cảnh

Đọc `tasks/binance-futures-execution-smc/plan.md` mục "Kiến trúc quyết định #1" và "#5" trước khi làm — task này implement đúng 2 quyết định đó.

**Vấn đề:** SL đặt là `STOP_MARKET closePosition=true` — đóng TOÀN BỘ net position của symbol trên sàn (one-way mode), không phân biệt lệnh đó do hệ Volman hay hệ SMC đặt. Nếu cả 2 hệ cùng mở vị thế trên cùng symbol (vd BTCUSDT), SL/TP của hệ này khi trigger sẽ đóng nhầm phần vị thế mà hệ kia đang track trong DB riêng.

**Giải pháp:** guard "1 symbol chỉ 1 vị thế tại 1 thời điểm, hệ nào mở trước thì giữ" — trước khi đặt entry, gọi `getPositionAmount(binanceSymbol)` (đã có sẵn, `src/charts/binance-futures-client.ts`); nếu khác 0 → bỏ qua entry (không đặt lệnh thật), báo Telegram, giữ signal ở dạng track-only. Guard phải đối xứng: cả 2 hệ đều check trước khi mở.

Task này làm phần **guard cho Volman** (vì file `binance-execution-volman.ts` đã tồn tại — task 03 của plan này sẽ làm phần entry cho SMC, bao gồm guard tương ứng, dùng đúng helper được tạo ở đây) + **kill-switch riêng SMC**.

## Việc cần làm

### File 1: `src/charts/binance-futures-config-env.ts` (sửa — CHỈ thêm hàm mới, không sửa hàm đã có)

Thêm hàm mới vào cuối file:

```ts
export function isBinanceLiveTradingEnabledSmc(): boolean {
  return readBooleanEnv("BINANCE_LIVE_TRADING_ENABLED_SMC", false);
}
```

Lưu ý: `readBooleanEnv` đã được định nghĩa ở đầu file (dùng bởi `isBinanceLiveTradingEnabled()`) — dùng lại nguyên, không viết lại.

### File 2: `src/charts/binance-execution-volman.ts` (sửa — CHỈ thêm guard, không đổi logic khác)

Import `getPositionAmount` đã có sẵn trong import block từ `./binance-futures-client.js` (dòng 2-14) — không cần thêm import mới.

Trong hàm `openBinanceFuturesPosition`, ngay sau đoạn:
```ts
    const hedgeMode = await isHedgeModeEnabled();
    if (hedgeMode instanceof Error) throw hedgeMode;
    if (hedgeMode) {
      throw new Error(
        "Tai khoan Binance Futures dang o Hedge mode — bot chi ho tro One-way mode. Doi Position Mode ve One-way trong Binance truoc khi bat live trading.",
      );
    }
```
Thêm ngay sau khối `if (hedgeMode) { ... }` (trước dòng `const filters = await getExchangeInfoFilters(binanceSymbol);`):

```ts
    // Guard cross-system: 1 symbol chi 1 vi the tai 1 thoi diem, he nao mo truoc
    // thi giu. SL/TP dat closePosition=true se dong toan bo net position cua symbol
    // tren san — neu he khac (SMC) da co vi the mo tren cung symbol, KHONG duoc mo
    // them de tranh 2 he giam dap len nhau (xem plan.md muc "Kien truc quyet dinh #1"
    // cua tasks/binance-futures-execution-smc).
    const existingPositionAmt = await getPositionAmount(binanceSymbol);
    if (!(existingPositionAmt instanceof Error) && existingPositionAmt !== 0) {
      logger.warn("Bo qua entry Binance — symbol da co vi the mo (co the do he khac)", {
        pair: setup.pair,
        binanceSymbol,
        existingPositionAmt,
      });
      await sendMessage(
        `⚠️ *Binance Futures (Volman)* — Bỏ qua mở vị thế thật ${binanceSymbol}: symbol này đã có vị thế đang mở trên sàn (có thể do hệ khác đặt). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn.`,
      );
      return;
    }

```

Kết quả đoạn code sau khi sửa (thứ tự: hedge mode check → guard mới → filters):
```ts
    const hedgeMode = await isHedgeModeEnabled();
    if (hedgeMode instanceof Error) throw hedgeMode;
    if (hedgeMode) {
      throw new Error(
        "Tai khoan Binance Futures dang o Hedge mode — bot chi ho tro One-way mode. Doi Position Mode ve One-way trong Binance truoc khi bat live trading.",
      );
    }

    const existingPositionAmt = await getPositionAmount(binanceSymbol);
    if (!(existingPositionAmt instanceof Error) && existingPositionAmt !== 0) {
      logger.warn("Bo qua entry Binance — symbol da co vi the mo (co the do he khac)", {
        pair: setup.pair,
        binanceSymbol,
        existingPositionAmt,
      });
      await sendMessage(
        `⚠️ *Binance Futures (Volman)* — Bỏ qua mở vị thế thật ${binanceSymbol}: symbol này đã có vị thế đang mở trên sàn (có thể do hệ khác đặt). Signal vẫn được track trong hệ thống, không có lệnh thật trên sàn.`,
      );
      return;
    }

    const filters = await getExchangeInfoFilters(binanceSymbol);
    if (filters instanceof Error) throw filters;
```

## Ràng buộc

- KHÔNG sửa bất kỳ logic nào khác trong `binance-execution-volman.ts` ngoài việc chèn đúng đoạn guard trên vào đúng vị trí (sau hedge mode check, trước filters). KHÔNG sửa `reconcileBinancePosition` (nếu đã tồn tại trong file — chỉ thêm, không xoá/sửa).
- KHÔNG sửa bất kỳ hàm nào khác trong `binance-futures-config-env.ts` ngoài thêm hàm mới `isBinanceLiveTradingEnabledSmc()` vào cuối file.
- KHÔNG tạo file mới trong task này (chỉ sửa 2 file đã có).
- KHÔNG đụng `src/charts/*-smc.ts` (task 03/04 của plan này sẽ dùng `isBinanceLiveTradingEnabledSmc()` và pattern guard tương tự, nhưng việc viết file `binance-execution-smc.ts` không thuộc task này).
- Guard chỉ bỏ qua entry khi `existingPositionAmt !== 0` — nếu `getPositionAmount` trả về `Error` (lỗi mạng/API), KHÔNG coi là "có vị thế", để luồng tiếp tục như bình thường (giữ nguyên hành vi lỗi mạng hiện có của code, không thêm rẽ nhánh mới cho trường hợp lỗi).

## Cách verify

```bash
npm run build
npm run test
```
`tests/charts/binance-execution-volman.test.ts` (nếu có) không được fail — nếu test mock `getPositionAmount` trả về `0` mặc định thì guard mới không ảnh hưởng hành vi test hiện có; nếu test không mock hàm này, cần thêm mock trả về `0` để giữ test pass (đây là điều chỉnh tối thiểu được phép nếu cần).

## Output

Ghi vào `tasks/binance-futures-execution-smc/02-config-and-cross-system-guard/result.md`:
- Đoạn code đã thêm vào `binance-futures-config-env.ts`
- Diff đã sửa trong `binance-execution-volman.ts`
- Kết quả `npm run build && npm run test`

Nếu bị chặn (ví dụ vị trí `hedgeMode` check trong file thực tế khác dòng số đã mô tả, hoặc test cũ fail vì thiếu mock `getPositionAmount` mà không rõ cách mock đúng convention repo) → ghi `blocked.md`, không tự đoán.
