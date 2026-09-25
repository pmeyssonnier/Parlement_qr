-- Run once after 006_search_ranking.sql in the Supabase SQL editor.
-- 006 sent the model one passage per question (the six best questions). For the
-- first question, the passage closest to the query vector could miss the sentence
-- that actually answers: for "tram 55", the model received the passage on new trams
-- but not the one saying that the ridership figures cannot be provided. The first
-- question now contributes its two best passages. Only the final order changes.
-- Rollback, only if needed: run the search_passages definition of 006 again.
begin;

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
  select lexeme, quote_literal(lexeme)::tsquery as q
  from unnest(tsvector_to_array(to_tsvector('french',
    public.search_words(replace(left(p_query, 2500), ' OR ', ' '))))) as lexeme
 ), found as (
  -- Which query words each question contains (title, question or answer), read from the index.
  select distinct dc.question_id, t.lexeme
  from docs dc
  join document_passages p on p.content_hash = dc.content_hash
  join terms t on public.passage_fts(p.search_text) @@ t.q
 ), titles as (
  -- Title words, computed once per matching question.
  select dc.question_id, to_tsvector('french', public.search_words(dc.document->>'titre')) as words
  from docs dc where dc.question_id in (select question_id from found)
 ), matches as (
  select f.question_id, f.lexeme, ti.words @@ t.q as in_title
  from found f join terms t using (lexeme) join titles ti using (question_id)
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
 -- The two best passages of the first question, then the best passage of each
 -- following question, then their second passages.
 order by case when document_rank = 1 then 0 else passage_rank end, document_rank, passage_rank
 limit greatest(1, least(p_limit, 8));
$$;

commit;
