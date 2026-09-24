-- Run once after 003_corpus_retention.sql in the Supabase SQL editor.
-- A full-legislature corpus has thousands of questions: copying the unchanged
-- ones (and their embeddings) row by row through the API made each import
-- take longer than the workflow allows. This copies them inside the database.

-- Copies from version p_from into version p_to every question whose id and
-- content hash match p_questions (a JSON array of {"id", "hash"}) and whose
-- passages all carry an embedding of model p_model. Returns the copied ids;
-- the caller imports every other question itself.
create or replace function public.clone_unchanged_questions(p_from uuid, p_to uuid, p_model text, p_questions jsonb)
returns setof text language plpgsql security invoker set search_path = public as $$
begin
  if p_from = p_to then raise exception 'Source and target versions must differ'; end if;
  return query
  with wanted as (
    select x->>'id' as id, x->>'hash' as hash from jsonb_array_elements(p_questions) x
  ), reusable as (
    select q.id from questions q join wanted w on w.id = q.id and w.hash = q.content_hash
    where q.version_id = p_from
      and not exists (
        select 1 from passages p
        where p.version_id = p_from and p.question_id = q.id
          and (p.embedding is null or p.embedding_model is distinct from p_model)
      )
  ), copied_questions as (
    insert into questions (version_id, id, document, content_hash)
    select p_to, q.id, q.document, q.content_hash
    from questions q join reusable r on r.id = q.id
    where q.version_id = p_from
    returning questions.id
  ), copied_passages as (
    insert into passages (version_id, id, question_id, section, "position", content, search_text, embedding, embedding_model)
    select p_to, p.id, p.question_id, p.section, p."position", p.content, p.search_text, p.embedding, p.embedding_model
    from passages p join reusable r on r.id = p.question_id
    where p.version_id = p_from
    returning 1
  )
  select copied_questions.id from copied_questions;
end $$;

revoke execute on function public.clone_unchanged_questions(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.clone_unchanged_questions(uuid, uuid, text, jsonb) to service_role;
