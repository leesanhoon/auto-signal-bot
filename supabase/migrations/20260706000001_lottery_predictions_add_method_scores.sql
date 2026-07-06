-- Add method_scores column to track breakdown of scores from each prediction method
ALTER TABLE public.lottery_predictions
ADD COLUMN IF NOT EXISTS method_scores jsonb;

-- Create index for faster queries if method_scores is used frequently
CREATE INDEX IF NOT EXISTS idx_lottery_predictions_method_scores
ON public.lottery_predictions USING gin (method_scores);

COMMENT ON COLUMN public.lottery_predictions.method_scores IS 'JSON breakdown of scores from each prediction method: {ai?, stats?, regression?}';
