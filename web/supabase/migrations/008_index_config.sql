-- Run once after 007_first_question_passages.sql in the Supabase SQL editor,
-- BEFORE deploying the code that uses it (the import writes index_config).
--
-- A stored content was keyed by the hash of the question alone: an import with
-- another embedding model, or another passage split, rewrote the passages the
-- active version still used (mixed vectors before activation, or a version left
-- without its former vectors after a failed import). The import now keys
-- contents by the question AND its index configuration (passage format, model,
-- dimensions), recorded on each version; stored rows can no longer be updated.
--
-- Existing rows are kept: the version active today stays usable. The next
-- import stores and embeds every question once under the new keys (see
-- web/ACTUALISATION.md, « Réindexation »); the former contents are removed by
-- the retention once no kept version references them.
begin;

-- 1. Index configuration of each version (null: imported before 008).
alter table public.corpus_versions add column if not exists index_config text;

-- 2. Immutable contents: an import adds rows under a new hash, never rewrites
-- them. Deletion (retention) stays allowed.
create or replace function public.forbid_update()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception '% : ligne immuable, importez-la sous une nouvelle empreinte', tg_table_name;
end $$;
revoke execute on function public.forbid_update() from public, anon, authenticated;

drop trigger if exists question_documents_immutable on public.question_documents;
create trigger question_documents_immutable before update on public.question_documents
  for each row execute function public.forbid_update();
drop trigger if exists document_passages_immutable on public.document_passages;
create trigger document_passages_immutable before update on public.document_passages
  for each row execute function public.forbid_update();

-- 3. Activation: same signature and checks as 005, plus every question has a
-- passage and every passage carries an embedding of the version's model.
create or replace function public.activate_corpus(p_id uuid, p_passage_count integer)
returns void language plpgsql security invoker set search_path = public,extensions as $$
declare
  expected integer;
  config text;
  model text;
begin
  perform pg_advisory_xact_lock(781301);
  select count, index_config into expected, config from corpus_versions where id = p_id;
  if expected is null or expected <> (select count(*) from version_questions where version_id = p_id)
     or p_passage_count <> (select count(*) from version_questions vq join document_passages p on p.content_hash = vq.content_hash where vq.version_id = p_id)
     or p_passage_count < expected then
    raise exception 'Incomplete corpus';
  end if;
  if exists (
    select 1 from version_questions vq
    where vq.version_id = p_id
      and not exists (select 1 from document_passages p where p.content_hash = vq.content_hash)
  ) then
    raise exception 'Question without passage';
  end if;
  if config is null then
    -- Imported before 008: at least one model for the whole version.
    if (select count(distinct coalesce(p.embedding_model, ''))
        from version_questions vq join document_passages p on p.content_hash = vq.content_hash
        where vq.version_id = p_id) > 1 then
      raise exception 'Mixed embedding models';
    end if;
  else
    model := nullif(split_part(config, ';', 2), 'sans-embeddings');
    if exists (
      select 1 from version_questions vq join document_passages p on p.content_hash = vq.content_hash
      where vq.version_id = p_id
        and (p.embedding_model is distinct from model or (model is not null and p.embedding is null))
    ) then
      raise exception 'Embedding model mismatch';
    end if;
  end if;
  update corpus_versions set active = false where active;
  update corpus_versions set active = true, activated_at = now() where id = p_id;
end $$;

commit;

-- Make the new column visible to the API right away.
notify pgrst, 'reload schema';
