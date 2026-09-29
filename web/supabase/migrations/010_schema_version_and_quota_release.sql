-- Run once after 009_drop_unused_vector_index.sql in the Supabase SQL editor.
-- Replayable. No corpus data is modified.
--
-- 1. Schema version. Migrations are applied by hand: nothing said which ones
--    were in production. schema_migrations keeps their numbers; schema_version()
--    returns the highest, which /api/health compares with the number the code
--    expects (SCHEMA_VERSION in src/lib/schema-version.ts). This migration
--    records 1 to 10 and refuses to apply if 008 or 009 are missing. Each later
--    migration records its own number (tests/project.test.ts checks it).
-- 2. active_corpus_info() also returns latest_document, the most recent date
--    among the questions of the active version: the date of the collection does
--    not say how far its documents go.
-- 3. release_chat_quota(): a request that fails without any answer (503) gives
--    its question back; see src/app/api/chat/route.ts.
--
-- Rollback: drop function public.release_chat_quota(text, text, boolean, timestamptz);
-- drop function public.schema_version(); drop table public.schema_migrations;
-- then run the active_corpus_info definition of 005 again.
begin;

do $$
begin
  if not exists (
       select from information_schema.columns
       where table_schema = 'public' and table_name = 'corpus_versions' and column_name = 'index_config')
     or exists (select from pg_indexes where schemaname = 'public' and indexname = 'document_passages_vector') then
    raise exception 'Appliquer d''abord les migrations 001 à 009.';
  end if;
end $$;

create table if not exists public.schema_migrations (
  version integer primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
grant all on public.schema_migrations to service_role;

insert into public.schema_migrations (version)
  select generate_series(1, 10)
  on conflict (version) do nothing;

create or replace function public.schema_version()
returns integer language sql stable security invoker set search_path = public as $$
  select max(version) from schema_migrations;
$$;

-- A new column changes the return type, which create or replace cannot do.
drop function if exists public.active_corpus_info();
create or replace function public.active_corpus_info()
returns table(id uuid, count integer, extracted_at timestamptz, method text, answer_count bigint, latest_document date)
language sql stable security invoker set search_path = public as $$
  select v.id, v.count, v.extracted_at, v.method,
    (select count(*) from version_questions vq join question_documents d on d.content_hash = vq.content_hash
     where vq.version_id = v.id and d.document->>'reponse' is not null and d.document->>'reponse' <> ''),
    -- greatest() ignores the null dates of an unanswered or unpublished question.
    (select max(greatest(
        (d.document->>'date_reception')::date,
        (d.document->>'date_publication')::date,
        (d.document->>'date_reponse')::date))
     from version_questions vq join question_documents d on d.content_hash = vq.content_hash
     where vq.version_id = v.id)
  from corpus_versions v where v.active;
$$;

-- Gives back the question reserved at p_reserved_at by reserve_chat_quota: the
-- hourly session and address counters, and the daily AI counters when the
-- reservation was granted the AI. Never creates a counter nor goes below zero;
-- a date outside [-10 minutes, +1 minute] is ignored (a request lasts at most a
-- minute). Same lock as reserve_chat_quota.
create or replace function public.release_chat_quota(
  p_session text,
  p_ip text,
  p_ai boolean,
  p_reserved_at timestamptz
)
returns void language plpgsql security invoker set search_path = public as $$
declare
  -- Counters of the reservation, even if the hour or the day changed since.
  hour_stamp text := to_char(p_reserved_at at time zone 'UTC', 'YYYY-MM-DD-HH');
  day_stamp text := to_char(p_reserved_at at time zone 'UTC', 'YYYY-MM-DD');
  released text[];
begin
  if p_reserved_at is null
     or p_reserved_at < now() - interval '10 minutes'
     or p_reserved_at > now() + interval '1 minute' then
    return;
  end if;
  released := array['s:' || p_session || ':' || hour_stamp, 'ip:' || p_ip || ':' || hour_stamp];
  if p_ai then
    released := released || array['ai:' || day_stamp, 'ai-ip:' || p_ip || ':' || day_stamp];
  end if;
  perform pg_advisory_xact_lock(781302);
  update quotas set used = used - 1 where bucket = any(released) and used > 0;
end $$;

revoke execute on function public.schema_version() from public, anon, authenticated;
revoke execute on function public.active_corpus_info() from public, anon, authenticated;
revoke execute on function public.release_chat_quota(text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
grant execute on function public.active_corpus_info() to service_role;
grant execute on function public.release_chat_quota(text, text, boolean, timestamptz) to service_role;

commit;

-- Make the new functions visible to the API right away.
notify pgrst, 'reload schema';
