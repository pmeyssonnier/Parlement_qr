-- Run once after 002_quota_fallback.sql in the Supabase SQL editor.
-- Each weekly import adds a full corpus version (questions, passages and
-- 1536-dimension embeddings). Without pruning, inactive versions and failed
-- staging imports accumulate indefinitely.

-- activated_at distinguishes former production versions (worth keeping for a
-- rollback) from staging imports that never went live. It is only known from
-- now on: activate_corpus records it below.
alter table public.corpus_versions add column if not exists activated_at timestamptz;
-- Whether an inactive version that predates this migration was ever live
-- cannot be told from the data: a question count equal to the version count
-- does not prove it, since an import can fail after inserting its last
-- question but before that question's passages. Such versions are marked
-- activation_unknown and are never removed automatically.
-- The marking only runs when the column is created, so re-running this file
-- never flags versions created since.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'corpus_versions' and column_name = 'activation_unknown'
  ) then
    alter table public.corpus_versions add column activation_unknown boolean not null default false;
    update public.corpus_versions set activation_unknown = true where not active;
    -- The live version was activated at some point; its creation time is the
    -- best available approximation, used only to order rollback versions.
    update public.corpus_versions set activated_at = coalesce(activated_at, created_at) where active;
  end if;
end $$;

-- Same checks as 001_initial.sql; also records the activation time.
create or replace function public.activate_corpus(p_id uuid, p_passage_count integer)
returns void language plpgsql security invoker set search_path = public,extensions as $$
declare expected integer;
begin
  perform pg_advisory_xact_lock(781301);
  select count into expected from corpus_versions where id=p_id;
  if expected is null or expected <> (select count(*) from questions where version_id=p_id)
     or p_passage_count <> (select count(*) from passages where version_id=p_id) or p_passage_count < expected then
    raise exception 'Incomplete corpus';
  end if;
  update corpus_versions set active=false where active;
  update corpus_versions set active=true, activated_at=now() where id=p_id;
end $$;

-- Keeps the active version and the p_keep most recently activated former
-- versions (for a manual rollback). Staging imports that never went live are
-- removed. Never removed: versions whose activation is unknown (created before
-- this migration), and anything created less than an hour ago (it may be an
-- import still in progress). Questions and passages go with their version
-- (on delete cascade).
create or replace function public.prune_corpus_versions(p_keep integer)
returns integer language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  if p_keep is null or p_keep < 1 then raise exception 'p_keep must be at least 1'; end if;
  -- Same lock as activate_corpus: never prune while a version is being activated.
  perform pg_advisory_xact_lock(781301);
  with kept as (
    select id from corpus_versions where not active and not activation_unknown and activated_at is not null
    order by activated_at desc limit p_keep
  )
  delete from corpus_versions v
  where not v.active and not v.activation_unknown and v.created_at < now() - interval '1 hour'
    and v.id not in (select id from kept);
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke execute on function public.activate_corpus(uuid,integer) from public,anon,authenticated;
grant execute on function public.activate_corpus(uuid,integer) to service_role;
revoke execute on function public.prune_corpus_versions(integer) from public,anon,authenticated;
grant execute on function public.prune_corpus_versions(integer) to service_role;
