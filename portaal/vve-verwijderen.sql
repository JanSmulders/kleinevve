-- 2026-10-17 VvE verwijderen: een beheerder verwijdert een VvE die is gestopt, met alle gegevens.
-- De PDF-stukken verwijdert het portaal eerst via de opslag (SQL mag dat niet); staan er nog stukken, dan stopt de functie.
-- Accounts van eigenaren die alleen bij deze VvE hoorden worden ook verwijderd; beheerders en de aanroeper blijven.
create or replace function public.verwijder_vve(v uuid, p_naam text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare naam text; wie uuid[]; n_leden int; n_accounts int;
begin
  if not ben_beheerder() or not is_bestuur(v) then raise exception 'Alleen een beheerder van deze VvE kan haar verwijderen'; end if;
  select x.naam into naam from vves x where x.id = v;
  if naam is null then raise exception 'Deze VvE bestaat niet (meer)'; end if;
  if trim(coalesce(p_naam, '')) is distinct from naam then raise exception 'Typ de naam precies zoals hij er staat: %', naam; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'stukken' and o.name like v::text || '/%') then
    raise exception 'Er staan nog stukken bij deze VvE. Probeer het opnieuw.'; end if;

  select count(*) into n_leden from leden where vve_id = v;
  select coalesce(array_agg(distinct u), '{}') into wie from (
    select user_id u from leden where vve_id = v and user_id is not null
    union select user_id from vve_beheer where vve_id = v) s
  where u <> auth.uid();

  delete from vves where id = v; -- alle tabellen gaan mee (on delete cascade)

  delete from auth.users u where u.id = any(wie)
    and not exists (select 1 from leden l where l.user_id = u.id)
    and not exists (select 1 from vve_beheer b where b.user_id = u.id)
    and not exists (select 1 from beheerders h where lower(h.email) = lower(u.email));
  get diagnostics n_accounts = row_count;
  return jsonb_build_object('naam', naam, 'leden', n_leden, 'accounts', n_accounts);
end $$;
revoke all on function public.verwijder_vve(uuid, text) from public, anon;
grant execute on function public.verwijder_vve(uuid, text) to authenticated;
