-- Run once after 004_clone_unchanged.sql in the Supabase SQL editor.
-- Each corpus version used to hold a full copy of every question and passage,
-- embeddings included: about 135 MB per version for the whole legislature.
-- Contents are now stored once, keyed by their hash; a version is only a list
-- of (question id, content hash) references. Existing data is carried over,
-- then the former questions and passages tables are dropped.
begin;

create table public.question_documents (
  content_hash text primary key,
  question_id text not null,
  document jsonb not null,
  created_at timestamptz not null default now()
);
create table public.document_passages (
  content_hash text not null references public.question_documents(content_hash) on delete cascade,
  id text not null,
  section text not null check (section in ('question','reponse')),
  "position" integer not null,
  content text not null,
  search_text text not null,
  embedding extensions.vector(1536),
  embedding_model text,
  fts tsvector generated always as (to_tsvector('french', search_text)) stored,
  primary key (content_hash, id)
);
create table public.version_questions (
  version_id uuid not null references public.corpus_versions(id) on delete cascade,
  question_id text not null,
  content_hash text not null references public.question_documents(content_hash),
  primary key (version_id, question_id)
);

-- Carry over existing versions. Identical contents collapse into one row;
-- for passages, a copy with an embedding is preferred.
insert into public.question_documents (content_hash, question_id, document)
select distinct on (content_hash) content_hash, id, document
from public.questions order by content_hash;
insert into public.document_passages (content_hash, id, section, "position", content, search_text, embedding, embedding_model)
select distinct on (q.content_hash, p.id) q.content_hash, p.id, p.section, p."position", p.content, p.search_text, p.embedding, p.embedding_model
from public.passages p join public.questions q on q.version_id = p.version_id and q.id = p.question_id
order by q.content_hash, p.id, p.embedding is null;
insert into public.version_questions (version_id, question_id, content_hash)
select version_id, id, content_hash from public.questions;

drop function if exists public.clone_unchanged_questions(uuid, uuid, text, jsonb);
drop table public.passages;
drop table public.questions;

create index version_questions_hash on public.version_questions (content_hash);
create index document_passages_fts on public.document_passages using gin (fts);
create index document_passages_vector on public.document_passages using hnsw (embedding extensions.vector_cosine_ops);

alter table public.question_documents enable row level security;
alter table public.document_passages enable row level security;
alter table public.version_questions enable row level security;
revoke all on public.question_documents, public.document_passages, public.version_questions from anon, authenticated;
grant all on public.question_documents, public.document_passages, public.version_questions to service_role;

-- Same checks as before, on the new tables.
create or replace function public.activate_corpus(p_id uuid, p_passage_count integer)
returns void language plpgsql security invoker set search_path = public,extensions as $$
declare expected integer;
begin
  perform pg_advisory_xact_lock(781301);
  select count into expected from corpus_versions where id = p_id;
  if expected is null or expected <> (select count(*) from version_questions where version_id = p_id)
     or p_passage_count <> (select count(*) from version_questions vq join document_passages p on p.content_hash = vq.content_hash where vq.version_id = p_id)
     or p_passage_count < expected then
    raise exception 'Incomplete corpus';
  end if;
  update corpus_versions set active = false where active;
  update corpus_versions set active = true, activated_at = now() where id = p_id;
end $$;

-- Same signature and results as before.
create or replace function public.search_passages(p_query text, p_vector extensions.vector(1536) default null, p_limit integer default 6)
returns table(id text, question_id text, section text, content text, "position" integer, score double precision, document jsonb)
language sql stable security invoker set search_path = public,extensions as $$
 with candidates as (
  select p.id, vq.question_id, p.section, p.content, p."position", d.document,
    ts_rank_cd(p.fts, websearch_to_tsquery('french', left(p_query, 2500)))::double precision as lexical,
    case when p_vector is not null and p.embedding is not null then 1 - (p.embedding <=> p_vector) else 0 end as semantic
  from corpus_versions v
  join version_questions vq on vq.version_id = v.id
  join question_documents d on d.content_hash = vq.content_hash
  join document_passages p on p.content_hash = vq.content_hash
  where v.active and p.section = 'reponse'
 ), ranked as (
  select *, (lexical * 3 + semantic)::double precision as relevance,
    row_number() over (partition by question_id order by (lexical * 3 + semantic) desc) as document_rank
  from candidates where lexical > 0 or semantic >= 0.35
 ) select id, question_id, section, content, "position", relevance, document
 from ranked where document_rank <= 2 order by relevance desc limit greatest(1, least(p_limit, 8));
$$;

-- As in 003, plus: contents no longer referenced by any version are removed.
-- A content created less than an hour ago is kept: an import may be about to
-- reference it.
create or replace function public.prune_corpus_versions(p_keep integer)
returns integer language plpgsql security invoker set search_path = public as $$
declare removed integer;
begin
  if p_keep is null or p_keep < 1 then raise exception 'p_keep must be at least 1'; end if;
  perform pg_advisory_xact_lock(781301);
  with kept as (
    select id from corpus_versions where not active and not activation_unknown and activated_at is not null
    order by activated_at desc limit p_keep
  )
  delete from corpus_versions v
  where not v.active and not v.activation_unknown and v.created_at < now() - interval '1 hour'
    and v.id not in (select id from kept);
  get diagnostics removed = row_count;
  delete from question_documents d
  where d.created_at < now() - interval '1 hour'
    and not exists (select 1 from version_questions vq where vq.content_hash = d.content_hash);
  return removed;
end $$;

-- Figures of the active corpus shown on the home page.
create or replace function public.active_corpus_info()
returns table(id uuid, count integer, extracted_at timestamptz, method text, answer_count bigint)
language sql stable security invoker set search_path = public as $$
  select v.id, v.count, v.extracted_at, v.method,
    (select count(*) from version_questions vq join question_documents d on d.content_hash = vq.content_hash
     where vq.version_id = v.id and d.document->>'reponse' is not null and d.document->>'reponse' <> '')
  from corpus_versions v where v.active;
$$;

-- For each requested hash already stored: how many of its passages are ready,
-- i.e. carry an embedding of p_model (any passage counts when p_model is null).
create or replace function public.ready_documents(p_hashes text[], p_model text)
returns table(content_hash text, ready_passages bigint)
language sql stable security invoker set search_path = public as $$
  select d.content_hash,
    count(p.id) filter (where p_model is null or (p.embedding is not null and p.embedding_model = p_model))
  from question_documents d left join document_passages p on p.content_hash = d.content_hash
  where d.content_hash = any(p_hashes)
  group by d.content_hash;
$$;

-- Documents of one version, for the export.
create or replace function public.version_documents(p_version uuid)
returns setof jsonb language sql stable security invoker set search_path = public as $$
  select d.document from version_questions vq join question_documents d on d.content_hash = vq.content_hash
  where vq.version_id = p_version order by vq.question_id;
$$;

-- Read-only view with the former questions table shape, so that the version of
-- the site deployed before this migration keeps working until it is replaced.
-- Nothing in the current code uses it; it can be dropped once deployed.
create view public.questions with (security_invoker = true) as
  select vq.version_id, vq.question_id as id, d.document, d.content_hash
  from public.version_questions vq join public.question_documents d on d.content_hash = vq.content_hash;
revoke all on public.questions from anon, authenticated;
grant select on public.questions to service_role;

revoke execute on function public.active_corpus_info() from public, anon, authenticated;
revoke execute on function public.ready_documents(text[], text) from public, anon, authenticated;
revoke execute on function public.version_documents(uuid) from public, anon, authenticated;
grant execute on function public.active_corpus_info() to service_role;
grant execute on function public.ready_documents(text[], text) to service_role;
grant execute on function public.version_documents(uuid) to service_role;

commit;

-- Make the new functions visible to the API right away.
notify pgrst, 'reload schema';
