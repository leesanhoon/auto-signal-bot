# Task 01: fetch-last-price

## Mục tiêu
Implement hàm `fetchLastPrice(symbol: string): Promise<number | Error>` trong `src/charts/ohlc-provider.ts` để fetch giá hiện tại (tươi) từ API, không phải từ klines cache.

## Yêu cầu

### Chức năng
1. **Nhận vào**: `symbol` (chuỗi như "OANDA:EURUSD" hoặc "BINANCE:BTCUSDT")
2. **Trả về**: Promise<number | Error>
   - Success: số giá (float)
   - Error: Error object với mô tả lỗi

### Cách chọn API
- **Nếu là Binance symbol** (`toBinanceSymbol(symbol)` không null):
  - Dùng `GET https://api.binance.com/api/v3/ticker/price?symbol=<BTCUSDT>`
  - Parse trường `price` từ response JSON
  
- **Nếu là Twelve Data symbol** (OANDA):
  - Dùng Twelve Data `/price` endpoint: `GET https://api.twelvedata.com/price?symbol=<EUR/USD>&apikey=...`
  - Parse trường `price` từ response JSON
  - Sử dụng `TWELVEDATA_API_KEY` env var (giống như `fetchFromTwelveData` hiện tại)

### Xử lý lỗi
1. **Lỗi format symbol**: Trả Error("Symbol khong dung dinh dang ...")
2. **Lỗi fetch/network**: Dùng `fetchWithRetry()` như cách của `fetchFromBinance` / `fetchFromTwelveData`
   - Max 3 lần retry
   - Delay 1000ms
3. **Lỗi parse**: Trả Error("Khong the parse price tu ...")
4. **NOT_FOUND hoặc missing field**: Trả Error("API khong tra ve price cho ...")

### Rate limit
- Binance: dùng `BINANCE_RATE_LIMIT_RPM` (default 300)
- Twelve Data: dùng `TWELVEDATA_RATE_LIMIT_RPM` (default 7) — tôn trọng rate limit vì free tier chỉ có 7 request/phút

### Không thay đổi
- Không sửa `fetchFromBinance()`, `fetchFromTwelveData()`, hay hàm khác hiện tại
- Không thêm cache cho `fetchLastPrice` (mục đích là fetch tươi = không cache)

## Tests

Tạo tests tại `tests/charts/fetch-last-price.test.ts`:

1. **Test case 1**: Fetch Binance symbol thành công
   - Mock fetch trả `{ "symbol": "BTCUSDT", "price": "42500.00" }`
   - Expect kết quả = 42500

2. **Test case 2**: Fetch Twelve Data symbol thành công
   - Mock fetch trả `{ "status": "ok", "price": 1.3456 }`
   - Expect kết quả = 1.3456

3. **Test case 3**: Binance API lỗi (500)
   - Mock fetch trả 500
   - Expect Error("Binance API tra ve 500...")

4. **Test case 4**: Invalid symbol format
   - Gọi `fetchLastPrice("INVALID:XYZ")`
   - Expect Error("Symbol khong dung dinh dang...")

5. **Test case 5**: Parse error (response không có trường price)
   - Mock fetch trả `{ "status": "ok" }` (thiếu price)
   - Expect Error("Khong the parse price...")

## Acceptance criteria
- `npm run build` pass (TypeScript strict)
- `npm run test` pass (tests cover 5 case trên)
- Code tuân theo pattern hiện tại trong ohlc-provider.ts
- Hàm được export từ ohlc-provider.ts
