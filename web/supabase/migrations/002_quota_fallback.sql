-- Run once after 001_initial.sql in the Supabase SQL editor.
-- The quota now returns the granted mode instead of a boolean:
--   'ia'       : AI synthesis allowed and counted;
--   'extraits' : AI budget exhausted (global or per IP), free extractive search only;
--   'refuse'   : anti-abuse limit reached for any kind of request.
-- An exhausted AI budget no longer blocks the extractive search, and a per-IP daily
-- AI limit prevents a single client from consuming the global daily budget.
drop function if exists public.reserve_chat_quota(text,text,boolean,integer,integer);

create or replace function public.reserve_chat_quota(p_session text,p_ip text,p_paid boolean,p_daily_limit integer,p_hourly_limit integer,p_ai_ip_daily_limit integer)
returns text language plpgsql security invoker set search_path=public as $$
declare
  hour_stamp text := to_char(now() at time zone 'UTC','YYYY-MM-DD-HH');
  day_stamp text := to_char(now() at time zone 'UTC','YYYY-MM-DD');
  session_bucket text := 's:'||p_session||':'||hour_stamp;
  ip_bucket text := 'ip:'||p_ip||':'||hour_stamp;
  day_bucket text := 'ai:'||day_stamp;
  ai_ip_bucket text := 'ai-ip:'||p_ip||':'||day_stamp;
begin
  if p_daily_limit < 1 or p_hourly_limit < 1 or p_ai_ip_daily_limit < 1 then return 'refuse'; end if;
  perform pg_advisory_xact_lock(781302);
  delete from quotas where expires_at < now();
  if coalesce((select used from quotas where bucket=session_bucket),0)>=least(p_hourly_limit,100)
     or coalesce((select used from quotas where bucket=ip_bucket),0)>=100 then
    return 'refuse';
  end if;
  insert into quotas(bucket,used,expires_at) values(session_bucket,1,now()+interval '2 hours'),(ip_bucket,1,now()+interval '2 hours')
  on conflict(bucket) do update set used=quotas.used+1;
  if not p_paid
     or coalesce((select used from quotas where bucket=day_bucket),0)>=least(p_daily_limit,10000)
     or coalesce((select used from quotas where bucket=ai_ip_bucket),0)>=least(p_ai_ip_daily_limit,1000) then
    return 'extraits';
  end if;
  insert into quotas(bucket,used,expires_at) values(day_bucket,1,now()+interval '2 days'),(ai_ip_bucket,1,now()+interval '2 days')
  on conflict(bucket) do update set used=quotas.used+1;
  return 'ia';
end $$;

revoke execute on function public.reserve_chat_quota(text,text,boolean,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.reserve_chat_quota(text,text,boolean,integer,integer,integer) to service_role;
