alter table public.lottery_predictions
  alter column freq drop not null,
  alter column weighted_freq drop not null,
  alter column gap drop not null,
  alter column overdue_ratio drop not null,
  alter column score drop not null;
