# Task 04: Test cho `ohlc-cache-repository.ts` + wiring trong `ohlc-provider.ts`

## Bối cảnh

Task 01-03 đã: tạo bảng `ohlc_candle_cache`, tạo `src/charts/ohlc-cache-repository.ts` (`saveOhlcCandleCache`, `loadOhlcCandleCache`), và wire 2 hàm đó vào `fetchOhlcHistory` trong `src/charts/ohlc-provider.ts` (đọc cache Supabase khi in-memory miss, ghi cache Supabase sau khi fetch TwelveData thành công — chỉ khi `isCacheEnabled(timeframe)`, tức KHÔNG áp dụng cho D1). Task này viết test.

## Việc cần làm — Phần A: `tests/charts/ohlc-cache-repository.test.ts` (file mới)

Mirror đúng pattern mock trong `tests/charts/chart-cache-repository.test.ts` (đọc file đó trước, dòng 1-30, để copy đúng cách mock `getDb`/`createLogger`). Viết test cover:

1. `saveOhlcCandleCache` gọi `upsert` với đúng `cache_key`, `candles`, `expires_at` (ISO string từ `expiresAtMs`), không throw khi `upsert` trả lỗi (mock trả `{ error: "boom" }` → hàm vẫn resolve bình thường, không throw).
2. `loadOhlcCandleCache` trả về `{ candles, expiresAtMs }` đúng khi mock `maybeSingle` trả `{ data: { cache_key, candles: [...], expires_at: "<ISO tương lai>" }, error: null }`.
3. `loadOhlcCandleCache` trả `null` khi `expires_at` là thời điểm **trong quá khứ** (đã hết hạn) — dùng `vi.setSystemTime`/`vi.useFakeTimers` hoặc chọn timestamp cố định trong quá khứ so với `Date.now()` thực.
4. `loadOhlcCandleCache` trả `null` khi `data` là `null` (cache miss) hoặc `error` khác `null`.
5. `loadOhlcCandleCache` trả `null` khi `candles` trong DB có shape sai (vd. thiếu field `close`, hoặc không phải mảng) — không throw.
6. `loadOhlcCandleCache`/`saveOhlcCandleCache` không throw khi `getDb()` throw (mock `../../src/shared/db.js` để `getDb` throw lỗi) — cả 2 hàm phải catch và xử lý fail-silent.

## Việc cần làm — Phần B: sửa `tests/charts/ohlc-provider.test.ts`

Đọc toàn bộ file hiện tại trước khi sửa — đặc biệt block `describe("fetchOhlcHistory", ...)` (dòng 25 trở đi) và `beforeEach` (dòng 26-37).

Thêm test mới (không xoá test cũ, không sửa test cũ trừ khi cần thiết để mock DB):

1. **Cache Supabase hit → bỏ qua TwelveData:** mock module `../../src/charts/ohlc-cache-repository.js` (dùng `vi.mock`) để `loadOhlcCandleCache` trả về `{ candles: [...2 candle hợp lệ...], expiresAtMs: Date.now() + 60_000 }` cho timeframe `H4`. Gọi `fetchOhlcHistory("OANDA:EURUSD", "H4", 100)`. Assert: kết quả đúng bằng candles từ mock, và `fetchSpy` (mock `globalThis.fetch`) **không được gọi** (`expect(fetchSpy).not.toHaveBeenCalled()`).

2. **Cache Supabase miss → fetch TwelveData rồi ghi cache:** mock `loadOhlcCandleCache` trả `null`, mock `saveOhlcCandleCache` là `vi.fn()`. Gọi `fetchOhlcHistory("OANDA:EURUSD", "H4", 100)` với `fetch` mock trả response hợp lệ (tương tự test có sẵn ở dòng 51-85). Assert: `fetchSpy` được gọi 1 lần, VÀ `saveOhlcCandleCache` được gọi 1 lần với `cacheKey` đúng (`"OANDA:EURUSD:H4"`) và mảng candles đúng.

3. **D1 không đụng tới cache Supabase:** mock `loadOhlcCandleCache`/`saveOhlcCandleCache` là `vi.fn()`. Gọi `fetchOhlcHistory("OANDA:EURUSD", "D1", 100)` với fetch mock hợp lệ. Assert: cả `loadOhlcCandleCache` và `saveOhlcCandleCache` **không được gọi** (đúng với `isCacheEnabled` trả `false` cho D1).

4. Test hiện có ở dòng 39-49 ("returns a clear config error when TWELVEDATA_API_KEY is missing") phải tiếp tục pass — không đổi logic đó (lỗi thiếu API key trả về trước khi chạm tới cache Supabase).

Dùng `vi.mock("../../src/charts/ohlc-cache-repository.js", () => ({ loadOhlcCandleCache: vi.fn(), saveOhlcCandleCache: vi.fn() }))` ở đầu file (ngoài `describe`), rồi trong từng test dùng `vi.mocked(...)` để set return value / assert calls. Nhớ `vi.clearAllMocks()` hoặc reset lại các mock này trong `beforeEach` để test không ảnh hưởng lẫn nhau (test hiện có đã có `vi.restoreAllMocks()` ở dòng 36 — kiểm tra xem có đủ reset cho mock module-level hay cần thêm `vi.mocked(loadOhlcCandleCache).mockReset()` v.v., vì `vi.restoreAllMocks()` không reset mock được tạo bằng factory trong `vi.mock`).

## Ràng buộc

- KHÔNG sửa `src/charts/ohlc-provider.ts`, `src/charts/ohlc-cache-repository.ts` ở task này — chỉ viết test. Nếu phát hiện bug trong code khi viết test (test không thể pass dù code đúng theo task 02/03 mô tả), ghi rõ vào `blocked.md`, không tự sửa code nguồn.
- Không xoá bất kỳ test nào đã có trong `ohlc-provider.test.ts`.
- Không thêm test cho tính năng ngoài scope (không test performance, không test load thật Supabase).

## Cách verify

- `npm run build && npm test` pass toàn bộ, bao gồm cả file test mới và test đã sửa.
- Chạy riêng để chắc chắn: `npx vitest run tests/charts/ohlc-cache-repository.test.ts tests/charts/ohlc-provider.test.ts`

## Output

Ghi kết quả vào `tasks/smc-ohlc-persistent-cache/04-tests/result.md`:
- Danh sách test mới đã thêm (tên test + file)
- Output đầy đủ của `npx vitest run tests/charts/ohlc-cache-repository.test.ts tests/charts/ohlc-provider.test.ts`
- Output `npm run build && npm test` (toàn bộ suite)

Nếu bị chặn → ghi `blocked.md` với chi tiết lỗi cụ thể, chỉ rõ nghi ngờ nằm ở task nào (02 hay 03).
