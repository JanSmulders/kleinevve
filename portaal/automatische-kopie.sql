-- 2026-10-17 automatische weekkopie: elke zondagnacht een kopie per VvE, de laatste 8 blijven bewaard.
-- Alleen beheerders van Lumensquared kunnen een weekkopie terugzetten. Het bestuur ziet ze niet.
-- Een kopie verdwijnt met de VvE. Wie om wissen vroeg, wordt bij terugzetten niet teruggezet.
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.auto_kopieen (
  id uuid primary key default gen_random_uuid(),
  vve_id uuid not null references public.vves on delete cascade,
  gemaakt timestamptz not null default now(),
  data jsonb not null
);
create index if not exists auto_kopieen_vve on public.auto_kopieen (vve_id, gemaakt desc);
alter table public.auto_kopieen enable row level security; -- geen policies: alleen via functies
revoke all on public.auto_kopieen from public, anon, authenticated;

-- De inhoud van een kopie, zonder controle; alleen voor de functies hieronder.
create or replace function public.vve_kopie_gegevens(v uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('soort', 'vvekit-kopie', 'versie', 1, 'gemaakt', now(),
    'vve', (select to_jsonb(x) from vves x where x.id = v),
    'leden', coalesce((select jsonb_agg(to_jsonb(x) order by x.appartement) from leden x where x.vve_id = v), '[]'),
    'begroting', coalesce((select jsonb_agg(to_jsonb(x) order by x.jaar, x.post) from begroting x where x.vve_id = v), '[]'),
    'mutaties', coalesce((select jsonb_agg(to_jsonb(x) order by x.datum, x.id) from mutaties x where x.vve_id = v), '[]'),
    'mjop', coalesce((select jsonb_agg(to_jsonb(x) order by x.onderdeel) from mjop x where x.vve_id = v), '[]'),
    'vergaderingen', coalesce((select jsonb_agg(to_jsonb(x) order by x.datum) from vergaderingen x where x.vve_id = v), '[]'),
    'stemmingen', coalesce((select jsonb_agg(to_jsonb(x)) from stemmingen x where x.vve_id = v), '[]'),
    'akkoorden', coalesce((select jsonb_agg(to_jsonb(x) order by x.aangemaakt) from akkoorden x where x.vve_id = v), '[]'),
    'berichten', coalesce((select jsonb_agg(to_jsonb(x) order by x.aangemaakt) from berichten x where x.vve_id = v), '[]'),
    'wisverzoeken', coalesce((select jsonb_agg(to_jsonb(x) order by x.aangemaakt) from wisverzoeken x where x.vve_id = v), '[]'),
    'stukken', coalesce((select jsonb_agg(jsonb_build_object('naam', substr(o.name, 38), 'grootte', o.metadata->>'size', 'datum', o.created_at) order by o.name)
                         from storage.objects o where o.bucket_id = 'stukken' and o.name like v::text || '/%'), '[]'));
$$;
revoke all on function public.vve_kopie_gegevens(uuid) from public, anon, authenticated;

create or replace function public.vve_kopie(v uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_bestuur(v) then raise exception 'Alleen het bestuur kan een veiligheidskopie maken'; end if;
  return vve_kopie_gegevens(v);
end $$;
revoke all on function public.vve_kopie(uuid) from public, anon;
grant execute on function public.vve_kopie(uuid) to authenticated;

-- Draait elke week via pg_cron: een kopie per VvE, oudere dan de laatste 8 verdwijnen.
create or replace function public.maak_auto_kopieen() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into auto_kopieen (vve_id, data) select id, vve_kopie_gegevens(id) from vves;
  get diagnostics n = row_count;
  delete from auto_kopieen where id in (select id from (
    select id, row_number() over (partition by vve_id order by gemaakt desc) nr from auto_kopieen) s where nr > 8);
  return n;
end $$;
revoke all on function public.maak_auto_kopieen() from public, anon, authenticated;

create or replace function public.auto_kopieen_lijst(v uuid) returns table (id uuid, gemaakt timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ben_beheerder() or not is_bestuur(v) then raise exception 'Alleen een beheerder kan de weekkopieën zien'; end if;
  return query select a.id, a.gemaakt from auto_kopieen a where a.vve_id = v order by a.gemaakt desc;
end $$;
revoke all on function public.auto_kopieen_lijst(uuid) from public, anon;
grant execute on function public.auto_kopieen_lijst(uuid) to authenticated;

create or replace function public.auto_kopie_ophalen(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select * into r from auto_kopieen where id = p_id;
  if r is null or not ben_beheerder() or not is_bestuur(r.vve_id) then raise exception 'Alleen een beheerder kan een weekkopie terugzetten'; end if;
  return r.data;
end $$;
revoke all on function public.auto_kopie_ophalen(uuid) from public, anon;
grant execute on function public.auto_kopie_ophalen(uuid) to authenticated;

-- Terugzetten (zelfde als in veiligheidskopie.sql), nu ook met het doorwerken van wisverzoeken.
create or replace function public.vve_terugzetten(v uuid, k jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare leeg constant jsonb := '[]';
begin
  if not is_bestuur(v) then raise exception 'Alleen het bestuur kan een kopie terugzetten'; end if;
  if k->>'soort' is distinct from 'vvekit-kopie' or k->>'versie' is distinct from '1' then
    raise exception 'Dit bestand is geen veiligheidskopie van het VvE-portaal'; end if;
  if k->'vve'->>'id' is distinct from v::text then
    raise exception 'Deze kopie hoort bij een andere VvE (%)', coalesce(k->'vve'->>'naam', 'onbekend'); end if;

  update vves x set naam = r.naam, boekjaar = r.boekjaar, herbouwwaarde = r.herbouwwaarde,
    startsaldo_betaal = r.startsaldo_betaal, startsaldo_reserve = r.startsaldo_reserve, eenheid = r.eenheid
  from jsonb_populate_record(null::vves, k->'vve') r where x.id = v;

  -- Eenheden: wat niet in de kopie staat verdwijnt, de rest krijgt de gegevens uit de kopie.
  delete from leden where vve_id = v and id not in (
    select (e->>'id')::uuid from jsonb_array_elements(coalesce(k->'leden', leeg)) e where e->>'id' is not null);
  update leden set appartement = '~' || id::text where vve_id = v;
  insert into leden (id, vve_id, appartement, breukdeel, naam, email, user_id, rol)
  select coalesce(r.id, gen_random_uuid()), v, r.appartement, r.breukdeel, r.naam, r.email,
    (select u.id from auth.users u where u.id = r.user_id and lower(u.email) = lower(trim(r.email))), r.rol
  from jsonb_populate_recordset(null::leden, coalesce(k->'leden', leeg)) r
  on conflict (id) do update set appartement = excluded.appartement, breukdeel = excluded.breukdeel, naam = excluded.naam,
    email = excluded.email, rol = excluded.rol, user_id = coalesce(leden.user_id, excluded.user_id)
  where leden.vve_id = v;
  if exists (select 1 from leden where vve_id = v and appartement like '~%') then
    raise exception 'De eenheden in de kopie passen niet bij deze VvE'; end if;

  delete from begroting where vve_id = v;
  insert into begroting (id, vve_id, jaar, post, bedrag)
  select coalesce(r.id, gen_random_uuid()), v, r.jaar, r.post, r.bedrag from jsonb_populate_recordset(null::begroting, coalesce(k->'begroting', leeg)) r;

  delete from mutaties where vve_id = v;
  insert into mutaties (id, vve_id, datum, omschrijving, bedrag, post, appartement)
  select coalesce(r.id, gen_random_uuid()), v, r.datum, r.omschrijving, r.bedrag, r.post, r.appartement from jsonb_populate_recordset(null::mutaties, coalesce(k->'mutaties', leeg)) r;

  delete from mjop where vve_id = v;
  insert into mjop (id, vve_id, onderdeel, laatst, levensduur, kosten)
  select coalesce(r.id, gen_random_uuid()), v, r.onderdeel, r.laatst, r.levensduur, r.kosten from jsonb_populate_recordset(null::mjop, coalesce(k->'mjop', leeg)) r;

  delete from vergaderingen where vve_id = v; -- stemmingen gaan mee
  insert into vergaderingen (id, vve_id, datum, agenda, notities)
  select coalesce(r.id, gen_random_uuid()), v, r.datum, r.agenda, r.notities from jsonb_populate_recordset(null::vergaderingen, coalesce(k->'vergaderingen', leeg)) r;
  insert into stemmingen (id, vergadering_id, vve_id, voorstel, stemmen)
  select coalesce(r.id, gen_random_uuid()), r.vergadering_id, v, r.voorstel, coalesce(r.stemmen, '{}')
  from jsonb_populate_recordset(null::stemmingen, coalesce(k->'stemmingen', leeg)) r
  where r.vergadering_id in (select id from vergaderingen where vve_id = v);

  delete from akkoorden where vve_id = v;
  insert into akkoorden (id, vve_id, titel, uitleg, status, besloten_door, besloten_op, aangemaakt)
  select coalesce(r.id, gen_random_uuid()), v, r.titel, coalesce(r.uitleg, ''), r.status,
    (select u.id from auth.users u where u.id = r.besloten_door), r.besloten_op, coalesce(r.aangemaakt, now())
  from jsonb_populate_recordset(null::akkoorden, coalesce(k->'akkoorden', leeg)) r;

  insert into berichten (id, vve_id, user_id, afzender, onderwerp, tekst, status, antwoord, aangemaakt, beantwoord_op, gemeld, vera_antwoord, bron, mail_id, mail_van)
  select r.id, v, (select u.id from auth.users u where u.id = r.user_id), r.afzender, r.onderwerp, r.tekst, r.status, coalesce(r.antwoord, ''),
    r.aangemaakt, r.beantwoord_op, r.gemeld, r.vera_antwoord, r.bron, r.mail_id, r.mail_van
  from jsonb_populate_recordset(null::berichten, coalesce(k->'berichten', leeg)) r where r.id is not null
  on conflict do nothing;

  insert into wisverzoeken (id, vve_id, lid_id, user_id, appartement, reden, status, notitie, aangemaakt, besloten_op)
  select r.id, v, (select l.id from leden l where l.id = r.lid_id and l.vve_id = v), (select u.id from auth.users u where u.id = r.user_id),
    r.appartement, r.reden, r.status, r.notitie, r.aangemaakt, r.besloten_op
  from jsonb_populate_recordset(null::wisverzoeken, coalesce(k->'wisverzoeken', leeg)) r where r.id is not null
  on conflict do nothing;

  -- Wie na het maken van de kopie om wissen vroeg en is gewist, blijft gewist.
  update leden l set naam = null, email = null, user_id = null, rol = 'eigenaar'
  from wisverzoeken w where w.vve_id = v and w.status = 'afgehandeld' and w.lid_id = l.id and l.vve_id = v
    and w.besloten_op > coalesce((k->>'gemaakt')::timestamptz, '-infinity');

  return jsonb_build_object('leden', (select count(*) from leden where vve_id = v), 'mutaties', (select count(*) from mutaties where vve_id = v),
    'vergaderingen', (select count(*) from vergaderingen where vve_id = v));
end $$;
revoke all on function public.vve_terugzetten(uuid, jsonb) from public, anon;
grant execute on function public.vve_terugzetten(uuid, jsonb) to authenticated;

select cron.schedule('vvekit-weekkopie', '0 2 * * 0', 'select public.maak_auto_kopieen()');
select public.maak_auto_kopieen() as eerste_kopieen;
