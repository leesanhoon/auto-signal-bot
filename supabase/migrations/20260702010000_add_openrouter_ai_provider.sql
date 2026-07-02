alter table public.ai_usage
  drop constraint if exists ai_usage_provider_check;

alter table public.ai_usage
  add constraint ai_usage_provider_check
  check (provider in ('gemini', 'claude', 'openrouter'));
