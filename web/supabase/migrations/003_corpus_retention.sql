-- Run once after 002_quota_fallback.sql in the Supabase SQL editor.
-- Each weekly import adds a full corpus version (questions, passages and
-- 1536-dimension embeddings). Without pruning, inactive versions and failed
-- staging imports accumulate indefinitely.

-- Distinguishes former production versions (worth keeping for a rollback)
-- from staging imports that never went live.
alter table public.corpus_versions add column if not exists activated_at timestamptz;
-- Backfill: the active version, and any complete version, was activated
-- (activate_corpus refuses incomplete ones).
update public.corpus_versions v set activated_at = v.created_at
where v.activated_at is null
  and (v.active or v.count = (select count(*) from public.questions q where q.version_id = v.id));

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
-- removed. Nothing created less than an hour ago is removed: it may be an
-- import still in progress. Questions and passages go with their version
-- (on delete cascade).
create or replace function public.prune_corpus_versions(p_keep integer)
returns integer language plpgsql security invoker set search_path=public as $$
declare removed integer;
begin
  if p_keep is null or p_keep < 1 then raise exception 'p_keep must be at least 1'; end if;
  -- Same lock as activate_corpus: never prune while a version is being activated.
  perform pg_advisory_xact_lock(781301);
  with kept as (
    select id from corpus_versions where not active and activated_at is not null
    order by activated_at desc limit p_keep
  )
  delete from corpus_versions v
  where not v.active and v.created_at < now() - interval '1 hour'
    and v.id not in (select id from kept);
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke execute on function public.activate_corpus(uuid,integer) from public,anon,authenticated;
grant execute on function public.activate_corpus(uuid,integer) to service_role;
revoke execute on function public.prune_corpus_versions(integer) from public,anon,authenticated;
grant execute on function public.prune_corpus_versions(integer) to service_role;
