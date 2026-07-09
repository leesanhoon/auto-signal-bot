-- Add 2-digit match tracking columns, alongside existing 3-digit `hit` column
ALTER TABLE public.lottery_predictions
ADD COLUMN IF NOT EXISTS hit2 boolean;

ALTER TABLE public.lottery_predictions
ADD COLUMN IF NOT EXISTS matched_province_2 text;

ALTER TABLE public.lottery_predictions
ADD COLUMN IF NOT EXISTS matched_prize_2 text;

COMMENT ON COLUMN public.lottery_predictions.hit2 IS 'True neu 2 chu so cuoi cua prediction khop voi 1 giai bat ky (bao gom giai tam)';
COMMENT ON COLUMN public.lottery_predictions.matched_province_2 IS 'Tinh/dai khop trung theo 2 chu so cuoi (neu hit2=true)';
COMMENT ON COLUMN public.lottery_predictions.matched_prize_2 IS 'Ten giai khop trung theo 2 chu so cuoi (neu hit2=true)';
