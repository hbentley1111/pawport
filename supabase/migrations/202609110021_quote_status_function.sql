begin;

create function public.set_service_quote_status(
  p_org uuid,
  p_request uuid,
  p_action text
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  r public.service_quote_requests;
begin
  select * into r
  from public.service_quote_requests
  where id=p_request and organization_id=p_org
  for update;

  if r.id is null then
    raise exception 'Request unavailable';
  end if;

  perform public.ec_authorize(p_org,r.location_id,true);

  if r.status not in ('requested','quoted') or p_action not in ('declined','withdrawn') then
    raise exception 'Invalid quote action';
  end if;

  update public.service_quote_requests
  set status=p_action,updated_at=now()
  where id=r.id;

  update public.service_quotes
  set status='withdrawn',updated_at=now()
  where request_id=r.id;

  perform public.bd_audit(
    p_org,
    case when p_action='declined' then 'quote_declined' else 'quote_withdrawn' end
  );

  if p_action='declined' then
    perform public.ec_notify(r.id,'declined','Quote request declined');
  end if;
end
$$;

revoke all on function public.set_service_quote_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_service_quote_status(uuid,uuid,text) to authenticated;

drop function if exists public.close_service_quote(uuid,uuid,text);

commit;
