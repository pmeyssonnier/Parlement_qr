-- Run once after 005_deduplicate_documents.sql in the Supabase SQL editor.
-- Search quality on the full legislature (about 2 600 questions):
-- 1. Accents: the application sends accent-free terms ("frequentation"), while the
--    former index kept them ("fréquent"): such words never matched. The index is
--    now built on accent-free text.
-- 2. Ranking: ts_rank_cd counts occurrences, so passages repeating common words
--    ("STIB", "transports") outranked the only question about "tram 55", and
--    lexical * 3 swamped the semantic score. Questions are now ranked by rare-word
--    weight (IDF, as the local search does, title words counting triple) and, with a
--    query vector, the lexical and semantic rankings are fused by rank (RRF).
-- Same signature and result columns as before: no application change is needed.
-- Rollback, only if needed: supabase/rollback/006_search_ranking.sql.
begin;

create or replace function public.fold_accents(p text)
returns text language sql immutable parallel safe as $$
  select replace(replace(translate(lower(p),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), 'œ', 'oe'), 'æ', 'ae')
$$;

-- search_text starts with the question title (see scripts/import-data.ts): its words
-- carry weight A, so that "word in the title" is read from the index.
create or replace function public.passage_fts(p_search_text text)
returns tsvector language sql immutable parallel safe as $$
  select setweight(pg_catalog.to_tsvector('french', public.fold_accents(split_part(p_search_text, E'\n', 1))), 'A')
    || pg_catalog.to_tsvector('french', public.fold_accents(substr(p_search_text, strpos(p_search_text, E'\n') + 1)))
$$;

-- An index on the expression rather than a new column: adding a stored column
-- would rewrite the table and rebuild the vector index. Dropping the former column
-- only updates the catalog.
drop index if exists public.document_passages_fts;
alter table public.document_passages drop column if exists fts;
create index document_passages_fts on public.document_passages using gin (public.passage_fts(search_text));

create or replace function public.search_passages(p_query text, p_vector extensions.vector(1536) default null, p_limit integer default 6)
returns table(id text, question_id text, section text, content text, "position" integer, score double precision, document jsonb)
language sql stable security invoker set search_path = public,extensions as $$
 with docs as (
  -- Questions of the active corpus that have an answer.
  select vq.question_id, vq.content_hash, d.document
  from corpus_versions v
  join version_questions vq on vq.version_id = v.id
  join question_documents d on d.content_hash = vq.content_hash
  where v.active and exists (
    select 1 from document_passages r where r.content_hash = vq.content_hash and r.section = 'reponse')
 ), total as (
  select count(*)::double precision as n from docs
 ), terms as (
  -- Stemmed, accent-free query words; the application joins them with " OR ".
  select lexeme, quote_literal(lexeme)::tsquery as q, (quote_literal(lexeme) || ':A')::tsquery as in_title
  from unnest(tsvector_to_array(to_tsvector('french',
    public.fold_accents(replace(left(p_query, 2500), ' OR ', ' '))))) as lexeme
 ), matches as (
  -- Which query words each question contains (title, question or answer).
  select dc.question_id, t.lexeme, bool_or(public.passage_fts(p.search_text) @@ t.in_title) as in_title
  from docs dc
  join document_passages p on p.content_hash = dc.content_hash
  join terms t on public.passage_fts(p.search_text) @@ t.q
  group by dc.question_id, t.lexeme
 ), idf as (
  select lexeme, ln(1 + (select n from total) / (1 + count(*))) as weight
  from matches group by lexeme
 ), lexical as (
  select m.question_id,
    sum(i.weight * case when m.in_title then 3 else 1 end)
      / sqrt(greatest((select count(*) from terms), 1)) as score
  from matches m join idf i using (lexeme)
  group by m.question_id
 ), semantic as (
  select dc.question_id, max(1 - (p.embedding <=> p_vector)) as score
  from docs dc
  join document_passages p on p.content_hash = dc.content_hash
  where p_vector is not null and p.section = 'reponse' and p.embedding is not null
  group by dc.question_id
 ), fused as (
  -- Rank fusion: neither score scale can swamp the other.
  select question_id,
    coalesce(1.0 / (60 + l.lexical_rank), 0) + coalesce(1.0 / (60 + s.semantic_rank), 0) as score,
    -- The first question of either ranking is always kept.
    coalesce(l.lexical_rank = 1, false) or coalesce(s.semantic_rank = 1, false) as leader
  from (select question_id, rank() over (order by score desc) as lexical_rank from lexical) l
  full join (select question_id, rank() over (order by score desc) as semantic_rank
             from semantic where score >= 0.35) s using (question_id)
 ), selected as (
  select question_id, score from fused order by leader desc, score desc, question_id
  limit greatest(1, least(p_limit, 8))
 ), best as (
  select question_id, score, row_number() over (order by score desc, question_id) as document_rank from selected
 ), passages as (
  -- The best answer passages of each selected question: closest to the vector,
  -- or with the most query words.
  select p.id, b.question_id, p.section, p.content, p."position", b.score, dc.document, b.document_rank,
    row_number() over (partition by b.question_id order by
      case when p_vector is not null and p.embedding is not null then 1 - (p.embedding <=> p_vector) else 0 end desc,
      ts_rank_cd(public.passage_fts(p.search_text), (select string_agg(quote_literal(lexeme), ' | ')::tsquery from terms)) desc nulls last,
      p."position") as passage_rank
  from best b
  join docs dc on dc.question_id = b.question_id
  join document_passages p on p.content_hash = dc.content_hash and p.section = 'reponse'
 ) select id, question_id, section, content, "position", score::double precision, document
 from passages where passage_rank <= 2
 -- The best passage of every selected question first, then second passages.
 order by passage_rank, document_rank
 limit greatest(1, least(p_limit, 8));
$$;

commit;
