# Task 01 - Fix ARB edge-test semantics

## Boi canh

Review summary:
`reviews/investigate-arb-edge-test-scope/review-summary.md`

Finding chinh:

- `src/charts/setups/arb.ts` hien dang dem edge test sai phia.
- Test moi trong `tests/charts/setups.test.ts` cung dang xac nhan sai hanh vi.

Do do patch vua merge cho `testLookback` chua duoc xem la dung cho toi khi
semantics "same breakout edge" duoc sua va regression duoc viet lai dung y.

## Muc tieu

Sua `detectArb` de edge-test chi duoc dem tren **cung bien voi huong breakout**:

- `LONG`: chi dem failed tests cua **upper boundary** (`range.high`)
- `SHORT`: chi dem failed tests cua **lower boundary** (`range.low`)

Sau do cap nhat regression test de chung minh duoc case:

- edge tests xay ra **truoc `range.startIndex` nhung van trong `testLookback`**
- edge tests do la **cung phia breakout**
- truoc khi sua thi detector se khong nhan ra, sau khi sua thi detector nhan ra

## Yeu cau cu the

1. Doc lai:
   - `src/charts/setups/arb.ts`
   - `tests/charts/setups.test.ts`
   - `reviews/investigate-arb-edge-test-scope/review-summary.md`

2. Sua logic dem edge test trong `detectArb`:
   - Khong doi `testLookback`
   - Khong doi `windowSizes`, `kBlockArb`, nguong `edgeTestCount`
   - Chi sua dieu kien dem sao cho dung same-edge semantics

3. Cap nhat test ARB:
   - Sua hoac thay the test moi vua them, vi no dang dung opposite-edge fixture
   - Fixture `LONG` phai tao failed tests o **bien tren** cua range:
     gia vuot len tren `range.high` roi dong tro lai ben trong/duoi bien tren
   - Nen assert ro rang signal van la `ARB`, `LONG`, va `ruleTrace` co `Edge test #1`
     + `Edge test #2`

4. Neu can, bo sung them 1 test nho cho `SHORT` neu thay giup khoa semantics
   tot hon, nhung chi lam neu can thiet. Uu tien giu patch gon.

## Khong lam

- Khong thay doi cac setup khac (`rb.ts`, `irb.ts`, ...)
- Khong doi false-break helper dung chung (`isFalseBreak`) neu khong bat buoc
- Khong retune threshold hay confidence scoring
- Khong chay backtest rong; Lead se quyet dinh sau review

## Verification

Chay dung 2 lenh:

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts
```

Neu test fail, sua den khi pass.

## Ghi ket qua

Ghi vao `tasks/fix-arb-edge-semantics/01-fix-arb-edge-semantics/result.md`:

- Da sua logic edge-test nhu the nao
- Test nao da doi / them moi
- Ket qua `npm run build`
- Ket qua `npm run test -- --run tests/charts/setups.test.ts`

Neu bi chan va khong the ket luan/sua an toan, ghi `blocked.md` thay vi doan.
