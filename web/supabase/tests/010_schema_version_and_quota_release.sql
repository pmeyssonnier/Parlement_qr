-- Test of migration 010 on a THROWAWAY local PostgreSQL database with pgvector,
-- never on Supabase: it creates and activates fictitious versions and counters.
-- Run by supabase/tests/run.sh (and by the job « sql » of .github/workflows/check.yml)
-- after migrations 001 to 010. Each check prints « OK » or stops on « ÉCHEC ».

create function pg_temp.v() returns extensions.vector language sql as $$
  select array_fill(0.1::real, array[1536])::extensions.vector $$;
create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'ÉCHEC %', label; end if;
  raise notice 'OK  %', label;
end $$;
create function pg_temp.used(b text) returns integer language sql as $$
  select coalesce((select used from public.quotas where bucket = b), -1) $$;

-- 1. Schema version.
select pg_temp.check('1. schema_version() rend 10', public.schema_version() = 10);
select pg_temp.check('2. les migrations 1 à 10 sont inscrites',
  (select count(*) = 10 and min(version) = 1 and max(version) = 10 from public.schema_migrations));
select pg_temp.check('3. schema_version() et schema_migrations réservées à service_role',
  has_function_privilege('service_role', 'public.schema_version()', 'execute')
  and not has_function_privilege('anon', 'public.schema_version()', 'execute')
  and not has_function_privilege('authenticated', 'public.schema_version()', 'execute')
  and not has_table_privilege('anon', 'public.schema_migrations', 'select'));

-- 2. Date of the most recent document of the active version.
insert into corpus_versions(id, count, extracted_at, method, index_config)
  values ('00000000-0000-0000-0000-0000000010a0', 3, now(), 'test 010', 'passages-1;m;1536');
insert into question_documents values
  ('h10-1', 'Q10-1', jsonb_build_object('titre', 'Répondue', 'reponse', 'Texte',
     'date_reception', '2026-01-05', 'date_publication', '2026-01-20', 'date_reponse', '2026-02-10')),
  ('h10-2', 'Q10-2', jsonb_build_object('titre', 'Sans réponse', 'reponse', null,
     'date_reception', '2026-03-01', 'date_publication', '2026-03-15', 'date_reponse', null)),
  ('h10-3', 'Q10-3', jsonb_build_object('titre', 'Réponse vide', 'reponse', '',
     'date_reception', '2025-12-01', 'date_publication', null, 'date_reponse', null));
insert into document_passages(content_hash, id, section, position, content, search_text, embedding, embedding_model)
  select h, q || ':reponse:0', 'reponse', 0, 'texte', 'titre' || E'\n' || 'texte', pg_temp.v(), 'm'
  from (values ('h10-1', 'Q10-1'), ('h10-2', 'Q10-2'), ('h10-3', 'Q10-3')) t(h, q);
insert into version_questions
  select '00000000-0000-0000-0000-0000000010a0', q, h
  from (values ('h10-1', 'Q10-1'), ('h10-2', 'Q10-2'), ('h10-3', 'Q10-3')) t(h, q);
select activate_corpus('00000000-0000-0000-0000-0000000010a0', 3);

select pg_temp.check('4. active_corpus_info : fiches, réponses et date la plus récente',
  (select count = 3 and answer_count = 1 and latest_document = date '2026-03-15' from public.active_corpus_info()));

-- 3. Quota given back when a request fails without any answer.
select reserve_chat_quota('sess-a', 'ip-a', true, 100, 20, 10) as grant_a \gset
select pg_temp.check('5. réservation accordée avec l''IA', :'grant_a' = 'ia');
select to_char(now() at time zone 'UTC', 'YYYY-MM-DD-HH') as hour_stamp,
       to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as day_stamp \gset
select pg_temp.check('6. quatre compteurs réservés',
  pg_temp.used('s:sess-a:' || :'hour_stamp') = 1 and pg_temp.used('ip:ip-a:' || :'hour_stamp') = 1
  and pg_temp.used('ai-ip:ip-a:' || :'day_stamp') = 1 and pg_temp.used('ai:' || :'day_stamp') >= 1);
select pg_temp.used('ai:' || :'day_stamp') as ai_before \gset
select release_chat_quota('sess-a', 'ip-a', true, now());
select pg_temp.check('7. tout est rendu, synthèse IA comprise',
  pg_temp.used('s:sess-a:' || :'hour_stamp') = 0 and pg_temp.used('ip:ip-a:' || :'hour_stamp') = 0
  and pg_temp.used('ai-ip:ip-a:' || :'day_stamp') = 0 and pg_temp.used('ai:' || :'day_stamp') = :ai_before - 1);
select release_chat_quota('sess-a', 'ip-a', true, now());
select pg_temp.check('8. jamais sous zéro',
  pg_temp.used('s:sess-a:' || :'hour_stamp') = 0 and pg_temp.used('ai-ip:ip-a:' || :'day_stamp') = 0);

select reserve_chat_quota('sess-b', 'ip-b', false, 100, 20, 10) as grant_b \gset
select pg_temp.check('9. sans IA demandée : recherche seule', :'grant_b' = 'extraits');
select release_chat_quota('sess-b', 'ip-b', false, now());
select pg_temp.check('10. sans IA : les compteurs horaires sont rendus, pas de compteur IA créé',
  pg_temp.used('s:sess-b:' || :'hour_stamp') = 0 and pg_temp.used('ai-ip:ip-b:' || :'day_stamp') = -1);

select reserve_chat_quota('sess-c', 'ip-c', true, 100, 20, 10);
select release_chat_quota('sess-c', 'ip-c', true, now() - interval '20 minutes');
select release_chat_quota('sess-c', 'ip-c', true, now() + interval '5 minutes');
select release_chat_quota('sess-c', 'ip-c', true, null);
select pg_temp.check('11. une date hors de la fenêtre ou absente est ignorée',
  pg_temp.used('s:sess-c:' || :'hour_stamp') = 1 and pg_temp.used('ai-ip:ip-c:' || :'day_stamp') = 1);

select release_chat_quota('fantome', 'ip-fantome', true, now());
select pg_temp.check('12. aucun compteur n''est créé pour une réservation inconnue',
  (select count(*) = 0 from public.quotas where bucket like '%fantome%'));
select pg_temp.check('13. release_chat_quota réservée à service_role',
  has_function_privilege('service_role', 'public.release_chat_quota(text,text,boolean,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.release_chat_quota(text,text,boolean,timestamptz)', 'execute'));
