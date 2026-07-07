# Done - fix-cache-boundary-bugs

Hoan tat task `fix-cache-boundary-bugs`.

- Sua exact-boundary bug de cache luon neo toi moc nen ke tiep thuc su.
- Sua weekend expiry de cache het han dung luc market reopen (Chu nhat 21:00 UTC), khong con giu du lieu cu them nhieu gio sau khi thi truong mo lai.
- Gop logic staleness de expiry bam theo candle cuoi cung thuc nhan tu provider.
- Them regression tests cho `M15`, `H4`, `D1`, weekend reopen, va provider-lag.
- Test `D1` duoc neo o nhanh Twelve Data da xac minh duoc response daily dang date-only; khong khoa gia dinh chua xac minh cho MetaApi.
- Sua comment test cu de phan anh dung behavior boundary-aligned hien tai.

Verification:

```bash
npm run test -- --run
npm run build
```

Ca hai deu pass.
