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

-- Keep offer limits and audit behavior equivalent to the Phase 9D migration while
-- isolating those concerns in small private helpers.
create function public.ec_offer_limit(
  p_org uuid,
  p_offer uuid,
  p_target_status text
) returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  perform 1 from public.service_provider_organizations where id=p_org for update;
  if coalesce(p_target_status,'draft')<>'archived'
     and (p_offer is null or exists(
       select 1 from public.service_provider_offers
       where id=p_offer and organization_id=p_org and status='archived'
     ))
     and (select count(*) from public.service_provider_offers where organization_id=p_org and status<>'archived')>=100
  then
    raise exception 'Offer limit reached';
  end if;
end
$$;

create function public.ec_offer_audit(p_org uuid,p_status text) returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_status in ('published','paused','archived') then
    perform public.bd_audit(p_org,'offer_'||p_status);
  end if;
end
$$;

create or replace function public.save_service_provider_offer(
  p_org uuid,
  p_location uuid,
  p_offer uuid,
  p_data jsonb
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  target_status text;
begin
  perform public.ec_authorize(p_org,p_location,true);
  perform public.ins_object(
    p_data,
    array['title','description','offer_type','value_text','terms','starts_on','ends_on','status']
  );
  target_status:=coalesce(p_data->>'status','draft');
  perform public.ec_offer_limit(p_org,p_offer,target_status);

  if p_offer is null then
    insert into public.service_provider_offers(
      organization_id,location_id,created_by,title,description,offer_type
    ) values(
      p_org,p_location,auth.uid(),p_data->>'title',p_data->>'description',p_data->>'offer_type'
    ) returning id into v_id;
  else
    select id into v_id
    from public.service_provider_offers
    where id=p_offer and organization_id=p_org and location_id is not distinct from p_location
    for update;
    if v_id is null then
      raise exception 'Offer unavailable';
    end if;
  end if;

  update public.service_provider_offers
  set title=p_data->>'title',
      description=p_data->>'description',
      offer_type=p_data->>'offer_type',
      value_text=p_data->>'value_text',
      terms=p_data->>'terms',
      starts_on=public.ins_date(p_data->>'starts_on'),
      ends_on=public.ins_date(p_data->>'ends_on'),
      status=target_status,
      updated_at=now()
  where id=v_id;

  perform public.ec_offer_audit(p_org,target_status);
  return v_id;
end
$$;

revoke all on function public.set_service_quote_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_service_quote_status(uuid,uuid,text) to authenticated;
revoke all on function public.ec_offer_limit(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.ec_offer_audit(uuid,text) from public,anon,authenticated;

drop function if exists public.close_service_quote(uuid,uuid,text);

commit;
