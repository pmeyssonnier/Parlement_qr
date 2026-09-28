-- Test of migration 008 on a THROWAWAY local PostgreSQL database with pgvector,
-- never on Supabase: it creates and activates fictitious versions.
--   createdb t && psql -d t -c "create schema extensions; create role anon; create role authenticated; create role service_role;"
--   for f in supabase/migrations/00[1-7]*.sql; do psql -d t -v ON_ERROR_STOP=1 -q -f $f; done
--   psql -d t -v ON_ERROR_STOP=1 -q -f supabase/tests/008_index_config.sql
-- The first part builds a version imported before 008 and applies 008 (\ir);
-- each check prints « OK » or stops on « ÉCHEC ».

-- Production-like state before 008: one active version, model A.
create function pg_temp.v() returns extensions.vector language sql as $$ select array_fill(0.1::real, array[1536])::extensions.vector $$;
insert into corpus_versions(id, count, extracted_at, method) values ('00000000-0000-0000-0000-00000000000a', 2, now(), 'legacy');
insert into question_documents values ('h1','Q1','{"titre":"Tram 55","reponse":"x"}', now() - interval '2 hours'), ('h2','Q2','{"titre":"Bus 71","reponse":"y"}', now() - interval '2 hours');
insert into document_passages(content_hash,id,section,"position",content,search_text,embedding,embedding_model) values
 ('h1','Q1:reponse:0','reponse',0,'fréquentation du tram 55','Tram 55 fréquentation', pg_temp.v(),'m-A'),
 ('h2','Q2:reponse:0','reponse',0,'ligne de bus 71','Bus 71 ligne', pg_temp.v(),'m-A');
insert into version_questions values ('00000000-0000-0000-0000-00000000000a','Q1','h1'),('00000000-0000-0000-0000-00000000000a','Q2','h2');
select activate_corpus('00000000-0000-0000-0000-00000000000a', 2);
update corpus_versions set created_at = now() - interval '2 hours';

\ir ../migrations/008_index_config.sql

-- expect(sql, expected error or null)
create function pg_temp.expect(label text, sql text, err text) returns void language plpgsql as $$
declare got text;
begin
  begin execute sql; got := null; exception when others then got := sqlerrm; end;
  if got is distinct from err and not (err is not null and got like err || '%') then
    raise exception 'ÉCHEC % : attendu %, obtenu %', label, coalesce(err,'succès'), coalesce(got,'succès');
  end if;
  raise notice 'OK  %', label;
end $$;
create function pg_temp.version(id text, cnt int, config text) returns void language sql as $$
  insert into corpus_versions(id, count, extracted_at, method, index_config) values (id::uuid, cnt, now(), 't', config) $$;
create function pg_temp.doc(v text, q text, h text, n int, model text, with_vector boolean) returns void language plpgsql as $$
begin
  insert into question_documents values (h, q, jsonb_build_object('titre', q)) on conflict do nothing;
  for i in 0..n-1 loop
    insert into document_passages(content_hash,id,section,"position",content,search_text,embedding,embedding_model)
    values (h, q||':reponse:'||i, 'reponse', i, 'texte '||q, 'tram '||q, case when with_vector then pg_temp.v() end, model)
    on conflict do nothing;
  end loop;
  insert into version_questions values (v::uuid, q, h);
end $$;

select pg_temp.expect('1. une ligne stockée ne peut plus être modifiée (passage)',
  $$update document_passages set embedding_model = 'm-B' where content_hash = 'h1'$$, 'document_passages : ligne immuable%');
select pg_temp.expect('2. une ligne stockée ne peut plus être modifiée (fiche)',
  $$update question_documents set document = '{}' where content_hash = 'h1'$$, 'question_documents : ligne immuable%');
select pg_temp.expect('3. l''ancienne version reste active et ses vecteurs intacts',
  $q$do $x$ begin if (select count(*) from document_passages where embedding_model = 'm-A' and embedding is not null) <> 2
     or not (select active from corpus_versions where id = '00000000-0000-0000-0000-00000000000a') then raise exception 'altéré'; end if; end $x$ $q$, null);

-- Réindexation avec le modèle B sous de nouvelles empreintes.
select pg_temp.version('00000000-0000-0000-0000-0000000000b0', 2, 'passages-1;m-B;1536');
select pg_temp.doc('00000000-0000-0000-0000-0000000000b0','Q1','h1-B',2,'m-B',true);
select pg_temp.doc('00000000-0000-0000-0000-0000000000b0','Q2','h2-B',1,'m-B',true);
select pg_temp.expect('4. version modèle B complète : activée',
  $$select activate_corpus('00000000-0000-0000-0000-0000000000b0', 3)$$, null);
select pg_temp.expect('5. l''ancienne version est désactivée, ses passages m-A intacts',
  $q$do $x$ begin if (select active from corpus_versions where id = '00000000-0000-0000-0000-00000000000a')
     or (select count(*) from document_passages where embedding_model = 'm-A') <> 2 then raise exception 'x'; end if; end $x$ $q$, null);

select pg_temp.version('00000000-0000-0000-0000-0000000000c0', 2, 'passages-1;m-B;1536');
select pg_temp.doc('00000000-0000-0000-0000-0000000000c0','Q1','h1-B',2,'m-B',true);
select pg_temp.doc('00000000-0000-0000-0000-0000000000c0','Q2','h2',1,'m-A',true);
select pg_temp.expect('6. version B qui reprend un contenu du modèle A : refusée',
  $$select activate_corpus('00000000-0000-0000-0000-0000000000c0', 3)$$, 'Embedding model mismatch');

select pg_temp.version('00000000-0000-0000-0000-0000000000d0', 1, 'passages-1;m-B;1536');
select pg_temp.doc('00000000-0000-0000-0000-0000000000d0','Q3','h3-B',1,'m-B',false);
select pg_temp.expect('7. passage sans vecteur alors qu''un modèle est attendu : refusée',
  $$select activate_corpus('00000000-0000-0000-0000-0000000000d0', 1)$$, 'Embedding model mismatch');

select pg_temp.version('00000000-0000-0000-0000-0000000000e0', 2, 'passages-1;m-B;1536');
select pg_temp.doc('00000000-0000-0000-0000-0000000000e0','Q4','h4-B',2,'m-B',true);
select pg_temp.doc('00000000-0000-0000-0000-0000000000e0','Q5','h5-B',0,'m-B',true);
select pg_temp.expect('8. fiche sans passage : refusée',
  $$select activate_corpus('00000000-0000-0000-0000-0000000000e0', 2)$$, 'Question without passage');
select pg_temp.expect('9. nombre de passages différent : refusée',
  $$select activate_corpus('00000000-0000-0000-0000-0000000000b0', 4)$$, 'Incomplete corpus');

select pg_temp.version('00000000-0000-0000-0000-0000000000f0', 1, 'passages-1;sans-embeddings;1536');
select pg_temp.doc('00000000-0000-0000-0000-0000000000f0','Q6','h6-0',1,null,false);
select pg_temp.expect('10. import sans embeddings : activé',
  $$select activate_corpus('00000000-0000-0000-0000-0000000000f0', 1)$$, null);

select pg_temp.version('00000000-0000-0000-0000-0000000000a1', 2, null);
select pg_temp.doc('00000000-0000-0000-0000-0000000000a1','Q1','h1',1,'m-A',true);
select pg_temp.doc('00000000-0000-0000-0000-0000000000a1','Q2','h7-B',2,'m-B',true);
select pg_temp.expect('11. version sans configuration (avant 008) mêlant deux modèles : refusée',
  $$select activate_corpus('00000000-0000-0000-0000-0000000000a1', 3)$$, 'Mixed embedding models');

-- Retour sur la version B, puis recherche et rétention.
select pg_temp.expect('12. réactivation de la version B', $$select activate_corpus('00000000-0000-0000-0000-0000000000b0', 3)$$, null);
select pg_temp.expect('13. la recherche fonctionne sur la version active',
  $q$do $x$ begin if (select count(*) from search_passages('tram', pg_temp.v(), 6)) = 0 then raise exception 'aucun résultat'; end if; end $x$ $q$, null);
update corpus_versions set created_at = now() - interval '2 hours', activated_at = coalesce(activated_at, now() - interval '2 hours');
update question_documents set created_at = now() - interval '2 hours' where false;
select pg_temp.expect('14. la rétention peut toujours supprimer (suppression autorisée)',
  $q$do $x$ begin perform prune_corpus_versions(1); end $x$ $q$, null);
