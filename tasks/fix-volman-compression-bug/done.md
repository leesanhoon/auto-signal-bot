# Done — Fix Volman compression bug

Tổng thể task đã hoàn tất:
- Root cause `detectCompression` off-by-one đã được sửa ở 5 setup files
- 4 test tautological đã được thay bằng assertion thật với fixture breakout rõ ràng
- `setup-backtest-runner.ts` đã hỗ trợ `BACKTEST_TIMEFRAME` và `BACKTEST_BARS`

Verification:
- `npm run build` ✅
- `npm run test -- --run` ✅
