-- Run once in the Supabase SQL editor. Only service_role can access this schema.
create extension if not exists vector with schema extensions;

create table public.corpus_versions (
  id uuid primary key default gen_random_uuid(),
  active boolean not null default false,
  count integer not null check (count > 0),
  extracted_at timestamptz not null,
  method text not null,
  created_at timestamptz not null default now()
);
create unique index one_active_corpus on public.corpus_versions (active) where active;
create table public.questions (
  version_id uuid not null references public.corpus_versions(id) on delete cascade,
  id text not null,
  document jsonb not null,
  content_hash text not null,
  primary key (version_id,id)
);
create table public.passages (
  version_id uuid not null,
  id text not null,
  question_id text not null,
  section text not null check (section in ('question','reponse')),
  "position" integer not null,
  content text not null,
  search_text text not null,
  embedding extensions.vector(1536),
  embedding_model text,
  fts tsvector generated always as (to_tsvector('french', search_text)) stored,
  primary key (version_id,id),
  foreign key (version_id,question_id) references public.questions(version_id,id) on delete cascade
);
create index passage_fts on public.passages using gin(fts);
create index passage_vector on public.passages using hnsw(embedding extensions.vector_cosine_ops);
create table public.quotas (
  bucket text primary key,
  used integer not null default 0,
  expires_at timestamptz not null
);

alter table public.corpus_versions enable row level security;
alter table public.questions enable row level security;
alter table public.passages enable row level security;
alter table public.quotas enable row level security;
revoke all on public.corpus_versions,public.questions,public.passages,public.quotas from anon,authenticated;
grant all on public.corpus_versions,public.questions,public.passages,public.quotas to service_role;

-- Staging imports become active only once their counts match. Previous version is retained.
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
  update corpus_versions set active=true where id=p_id;
end $$;

create or replace function public.search_passages(p_query text, p_vector extensions.vector(1536) default null, p_limit integer default 6)
returns table(id text, question_id text, section text, content text, "position" integer, score double precision, document jsonb)
language sql stable security invoker set search_path=public,extensions as $$
 with candidates as (
  select p.*,q.document,
    ts_rank_cd(p.fts,websearch_to_tsquery('french',left(p_query,2500)))::double precision as lexical,
    case when p_vector is not null and p.embedding is not null then 1-(p.embedding <=> p_vector) else 0 end as semantic
  from passages p join corpus_versions v on v.id=p.version_id and v.active
  join questions q on q.version_id=p.version_id and q.id=p.question_id
  where p.section='reponse'
 ), ranked as (
  select *, (lexical*3 + semantic)::double precision as relevance,
    row_number() over(partition by question_id order by (lexical*3 + semantic) desc) as document_rank
  from candidates where lexical>0 or semantic>=0.35
 ) select id, question_id,section,content,"position",relevance,document
 from ranked where document_rank<=2 order by relevance desc limit greatest(1,least(p_limit,8));
$$;

-- One lock protects all quota checks/increments in the transaction.
-- A consumed slot is not refunded on upstream failure: conservative spending limit.
create or replace function public.reserve_chat_quota(p_session text,p_ip text,p_paid boolean,p_daily_limit integer,p_hourly_limit integer)
returns boolean language plpgsql security invoker set search_path=public as $$
declare
  hour_stamp text := to_char(now() at time zone 'UTC','YYYY-MM-DD-HH');
  day_stamp text := to_char(now() at time zone 'UTC','YYYY-MM-DD');
  session_bucket text := 's:'||p_session||':'||hour_stamp;
  ip_bucket text := 'ip:'||p_ip||':'||hour_stamp;
  day_bucket text := 'ai:'||day_stamp;
begin
  if p_daily_limit < 1 or p_hourly_limit < 1 then return false; end if;
  perform pg_advisory_xact_lock(781302);
  delete from quotas where expires_at < now();
  if coalesce((select used from quotas where bucket=session_bucket),0)>=least(p_hourly_limit,100)
     or coalesce((select used from quotas where bucket=ip_bucket),0)>=100
     or (p_paid and coalesce((select used from quotas where bucket=day_bucket),0)>=least(p_daily_limit,10000)) then
    return false;
  end if;
  insert into quotas(bucket,used,expires_at) values(session_bucket,1,now()+interval '2 hours'),(ip_bucket,1,now()+interval '2 hours')
  on conflict(bucket) do update set used=quotas.used+1;
  if p_paid then
    insert into quotas(bucket,used,expires_at) values(day_bucket,1,now()+interval '2 days')
    on conflict(bucket) do update set used=quotas.used+1;
  end if;
  return true;
end $$;

revoke execute on function public.activate_corpus(uuid,integer) from public,anon,authenticated;
revoke execute on function public.search_passages(text,extensions.vector,integer) from public,anon,authenticated;
revoke execute on function public.reserve_chat_quota(text,text,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.activate_corpus(uuid,integer) to service_role;
grant execute on function public.search_passages(text,extensions.vector,integer) to service_role;
grant execute on function public.reserve_chat_quota(text,text,boolean,integer,integer) to service_role;
