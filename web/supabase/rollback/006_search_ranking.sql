-- Rollback of 006_search_ranking.sql, only if needed: restores the search of
-- 005_deduplicate_documents.sql. Run in the Supabase SQL editor. Like 006, it uses an
-- index on an expression, so that the table and its vector index are not rewritten.
begin;

drop index if exists public.document_passages_fts;
create index document_passages_fts on public.document_passages using gin (to_tsvector('french', search_text));

create or replace function public.search_passages(p_query text, p_vector extensions.vector(1536) default null, p_limit integer default 6)
returns table(id text, question_id text, section text, content text, "position" integer, score double precision, document jsonb)
language sql stable security invoker set search_path = public,extensions as $$
 with candidates as (
  select p.id, vq.question_id, p.section, p.content, p."position", d.document,
    ts_rank_cd(to_tsvector('french', p.search_text), websearch_to_tsquery('french', left(p_query, 2500)))::double precision as lexical,
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

drop function if exists public.passage_fts(text);
drop function if exists public.search_words(text);
drop function if exists public.fold_accents(text);

commit;
