-- ISA Finance Phase 3: Personal CFO conversation metadata and usage limits.

-- Assistant message metadata: answer mode, tools used, data status. Never raw tool
-- outputs (those contain financial data and are recomputed on demand).
alter table public.ai_messages
  add column metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) < 8192);

-- Daily AI usage per user, for request and token limits.
create table public.ai_usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  request_count integer not null default 0 check (request_count >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.ai_usage_daily enable row level security;
alter table public.ai_usage_daily force row level security;

revoke all on public.ai_usage_daily from anon, authenticated;
grant select on public.ai_usage_daily to authenticated;
create policy "owner can read" on public.ai_usage_daily for select to authenticated
  using (user_id = (select auth.uid()));

-- Users can only INCREASE their own counters, by bounded amounts. SECURITY DEFINER so
-- the table needs no insert/update grant (which would let a user reset their usage).
create function public.record_ai_usage(p_input_tokens integer, p_output_tokens integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_input_tokens < 0 or p_output_tokens < 0 or p_input_tokens > 1000000 or p_output_tokens > 1000000 then
    raise exception 'invalid token counts' using errcode = '22023';
  end if;
  insert into public.ai_usage_daily (user_id, day, request_count, input_tokens, output_tokens)
  values (auth.uid(), (now() at time zone 'utc')::date, 1, p_input_tokens, p_output_tokens)
  on conflict (user_id, day) do update
    set request_count = public.ai_usage_daily.request_count + 1,
        input_tokens = public.ai_usage_daily.input_tokens + excluded.input_tokens,
        output_tokens = public.ai_usage_daily.output_tokens + excluded.output_tokens,
        updated_at = now();
end;
$$;

revoke all on function public.record_ai_usage(integer, integer) from public, anon;
grant execute on function public.record_ai_usage(integer, integer) to authenticated;

-- Conversations are listed by recency; appending a message bumps updated_at.
create function public.touch_ai_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_conversations set updated_at = now()
  where id = new.conversation_id and user_id = new.user_id;
  return new;
end;
$$;

revoke all on function public.touch_ai_conversation() from public, anon, authenticated;

create trigger ai_messages_touch_conversation
  after insert on public.ai_messages
  for each row execute function public.touch_ai_conversation();
