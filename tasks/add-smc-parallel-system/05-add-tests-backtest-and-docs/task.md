# Task 05 - Them test, fixture, env docs va huong dan van hanh cho SMC parallel system

## Muc tieu

Hoan thien quality gate cho feature moi va cap nhat tai lieu de van hanh duoc.

## File du kien can sua

- `tests/charts/...`
- `.env.example`
- `README.md`
- co the them `docs/tasks/...` neu can

## Yeu cau

1. Tests
   - unit test cho primitive SMC chinh
   - integration test cho pipeline SMC
   - regression test cho runtime chay song song `volman,smc`
   - regression test cho strategy-aware dedupe
   - regression test cho Telegram formatting strategy-aware neu repo da co helper test phu hop

2. Fixture
   - neu can, them OHLC fixtures nho, de deterministic va de review

3. Env docs
   - cap nhat `.env.example` voi bien moi
   - giai thich default va recommendation production

4. README / docs
   - cach bat `smc` rieng
   - cach chay song song `volman,smc`
   - limitation cua SMC MVP

## Dau ra mong muon trong `result.md`

- test cases da them
- commands da chay
- env moi da document o dau
- limitation nao van con mo

## Verification

```bash
npm run test -- --run
npm run build
```
