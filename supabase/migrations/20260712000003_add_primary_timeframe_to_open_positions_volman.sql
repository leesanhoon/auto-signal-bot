-- Add primary_timeframe column to open_positions_volman
alter table open_positions_volman
  add column if not exists primary_timeframe text;

-- Backfill existing positions with M15 (the timeframe they were opened under)
update open_positions_volman
set primary_timeframe = 'M15'
where id in (7, 8);
