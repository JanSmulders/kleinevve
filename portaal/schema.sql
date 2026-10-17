-- Database voor het VvE-portaal (Supabase-project "vvekit", testomgeving).
-- Iedereen ziet alleen de VvE('s) waar zijn e-mailadres als lid bij staat.
-- Alleen het bestuur van een VvE mag gegevens wijzigen. Geen rekeningnummers opslaan.

-- Wie een nieuwe VvE mag aanmaken (beheerders van Lumensquared).
create table public.beheerders (email text primary key);
alter table public.beheerders enable row level security; -- geen policies: alleen via functies

create table public.vves (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  boekjaar int not null default extract(year from now())::int,
  herbouwwaarde numeric,
  startsaldo_betaal numeric not null default 0,  -- op 1 januari van het boekjaar
  startsaldo_reserve numeric not null default 0,
  aangemaakt timestamptz not null default now()
);

create table public.leden (
  id uuid primary key default gen_random_uuid(),
  vve_id uuid not null references public.vves on delete cascade,
  appartement text not null,
  breukdeel numeric not null check (breukdeel > 0),
  naam text,
  email text,
  user_id uuid references auth.users on delete set null,
  rol text not null default 'eigenaar' check (rol in ('bestuur', 'eigenaar')),
  unique (vve_id, appartement)
);
create index on public.leden (user_id);
create index on public.leden (lower(email));

create table public.begroting (
  id uuid primary key default gen_random_uuid(),
  vve_id uuid not null references public.vves on delete cascade,
  jaar int not null,
  post text not null,
  bedrag numeric not null default 0
);

create table public.mutaties (
  id uuid primary key default gen_random_uuid(),
  vve_id uuid not null references public.vves on delete cascade,
  datum date not null,
  omschrijving text not null default '',
  bedrag numeric not null,           -- positief = bij, negatief = af
  post text not null default 'Overig',
  appartement text                    -- bij voorschotten: van welk appartement
);
create index on public.mutaties (vve_id, datum);

create table public.mjop (
  id uuid primary key default gen_random_uuid(),
  vve_id uuid not null references public.vves on delete cascade,
  onderdeel text not null,
  laatst int not null,
  levensduur int not null check (levensduur > 0),
  kosten numeric not null default 0
);

create table public.vergaderingen (
  id uuid primary key default gen_random_uuid(),
  vve_id uuid not null references public.vves on delete cascade,
  datum date not null,
  agenda text[] not null default '{}',
  notities text not null default ''
);

create table public.stemmingen (
  id uuid primary key default gen_random_uuid(),
  vergadering_id uuid not null references public.vergaderingen on delete cascade,
  vve_id uuid not null references public.vves on delete cascade,
  voorstel text not null,
  stemmen jsonb not null default '{}'  -- {"<appartement>": "voor" | "tegen" | "blanco" | "afwezig"}
);

create table public.akkoorden (
  id uuid primary key default gen_random_uuid(),
  vve_id uuid not null references public.vves on delete cascade,
  titel text not null,
  uitleg text not null default '',
  status text not null default 'open' check (status in ('open', 'goedgekeurd', 'afgewezen')),
  besloten_door uuid references auth.users on delete set null,
  besloten_op timestamptz,
  aangemaakt timestamptz not null default now()
);

-- Hulpfuncties (security definer, zodat de policies niet in een lus raken)
create or replace function public.is_lid(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leden where vve_id = v and user_id = auth.uid());
$$;

create or replace function public.is_bestuur(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leden where vve_id = v and user_id = auth.uid() and rol = 'bestuur');
$$;

-- Na inloggen: koppel de ingelogde gebruiker aan leden-regels met hetzelfde e-mailadres.
create or replace function public.koppel_mij() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  update leden set user_id = auth.uid()
   where user_id is null and email is not null and lower(email) = lower(auth.email());
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.ben_beheerder() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from beheerders where lower(email) = lower(auth.email()));
$$;

-- Nieuwe VvE: alleen voor beheerders. De maker wordt bestuurder van het opgegeven appartement.
create or replace function public.maak_vve(p_naam text, p_appartement text, p_breukdeel numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not ben_beheerder() then raise exception 'Alleen beheerders kunnen een VvE aanmaken'; end if;
  insert into vves (naam) values (p_naam) returning id into v;
  insert into leden (vve_id, appartement, breukdeel, email, user_id, rol)
  values (v, p_appartement, p_breukdeel, auth.email(), auth.uid(), 'bestuur');
  return v;
end $$;

revoke all on function public.maak_vve(text, text, numeric) from public, anon;
revoke all on function public.koppel_mij() from public, anon;
grant execute on function public.maak_vve(text, text, numeric) to authenticated;
grant execute on function public.koppel_mij() to authenticated;
revoke all on function public.is_lid(uuid) from public, anon;
revoke all on function public.is_bestuur(uuid) from public, anon;
revoke all on function public.ben_beheerder() from public, anon;
grant execute on function public.is_lid(uuid) to authenticated;
grant execute on function public.is_bestuur(uuid) to authenticated;
grant execute on function public.ben_beheerder() to authenticated;

-- Row level security
alter table public.vves enable row level security;
alter table public.leden enable row level security;
alter table public.begroting enable row level security;
alter table public.mutaties enable row level security;
alter table public.mjop enable row level security;
alter table public.vergaderingen enable row level security;
alter table public.stemmingen enable row level security;
alter table public.akkoorden enable row level security;

create policy "leden lezen vve" on public.vves for select to authenticated using (is_lid(id));
create policy "bestuur wijzigt vve" on public.vves for update to authenticated using (is_bestuur(id)) with check (is_bestuur(id));

do $$
declare t text;
begin
  foreach t in array array['leden', 'begroting', 'mutaties', 'mjop', 'vergaderingen', 'stemmingen', 'akkoorden'] loop
    execute format('create policy "leden lezen" on public.%I for select to authenticated using (is_lid(vve_id))', t);
    execute format('create policy "bestuur voegt toe" on public.%I for insert to authenticated with check (is_bestuur(vve_id))', t);
    execute format('create policy "bestuur wijzigt" on public.%I for update to authenticated using (is_bestuur(vve_id)) with check (is_bestuur(vve_id))', t);
    execute format('create policy "bestuur verwijdert" on public.%I for delete to authenticated using (is_bestuur(vve_id))', t);
  end loop;
end $$;

-- Eén stem vastleggen zonder andere stemmen te overschrijven. security invoker: RLS blijft gelden.
create or replace function public.stem(p_id uuid, p_app text, p_keus text) returns void
language sql security invoker set search_path = public as $$
  update stemmingen set stemmen = stemmen || jsonb_build_object(p_app, p_keus)
   where id = p_id and p_keus in ('voor', 'tegen', 'blanco', 'afwezig');
$$;
revoke all on function public.stem(uuid, text, text) from public, anon;
grant execute on function public.stem(uuid, text, text) to authenticated;

-- Daarna (eenmalig, niet in git als echte data): insert into public.beheerders (email) values ('<e-mailadres beheerder>');

-- Bestuur maakt een account (e-mail + startwachtwoord) voor een eigenaar uit de ledenlijst (akkoord Jan 2026-10-12).
-- Geen inlogmail nodig. Alleen het bestuur van dezelfde VvE; bestaande accounts worden nooit aangepast.
create or replace function public.maak_account(p_lid uuid, p_wachtwoord text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare l record; e text; nieuw uuid := gen_random_uuid();
begin
  select * into l from leden where id = p_lid;
  if l is null then raise exception 'Appartement niet gevonden'; end if;
  if not is_bestuur(l.vve_id) then raise exception 'Alleen het bestuur kan accounts maken'; end if;
  if l.user_id is not null then raise exception 'Dit appartement heeft al een account'; end if;
  e := lower(trim(coalesce(l.email, '')));
  if e = '' then raise exception 'Zet eerst een e-mailadres bij dit appartement'; end if;
  if length(coalesce(p_wachtwoord, '')) < 8 then raise exception 'Kies een wachtwoord van minstens 8 tekens'; end if;
  if exists (select 1 from auth.users where lower(email) = e) then
    raise exception 'Dit e-mailadres heeft al een account. De eigenaar kan inloggen met zijn eigen wachtwoord of via een e-maillink.';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', nieuw, 'authenticated', 'authenticated', e,
    crypt(p_wachtwoord, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), nieuw, nieuw::text, 'email',
    jsonb_build_object('sub', nieuw::text, 'email', e, 'email_verified', true, 'phone_verified', false), now(), now(), now());
  update leden set user_id = nieuw where id = p_lid;
  return l.appartement;
end $$;
revoke all on function public.maak_account(uuid, text) from public, anon;
grant execute on function public.maak_account(uuid, text) to authenticated;

-- AVG: een eigenaar vraagt om wissen van zijn persoonsgegevens; het bestuur handelt af (zoals in portaal JdeS).
create table public.wisverzoeken (
  id uuid primary key default gen_random_uuid(),
  vve_id uuid not null references public.vves on delete cascade,
  lid_id uuid references public.leden on delete set null,
  user_id uuid references auth.users on delete set null,
  appartement text not null,
  reden text not null default '',
  status text not null default 'open' check (status in ('open', 'afgehandeld', 'afgewezen')),
  notitie text not null default '',
  aangemaakt timestamptz not null default now(),
  besloten_op timestamptz
);
alter table public.wisverzoeken enable row level security;
create policy "eigen verzoek of bestuur leest" on public.wisverzoeken for select to authenticated
  using (user_id = auth.uid() or is_bestuur(vve_id));
create policy "eigenaar dient eigen verzoek in" on public.wisverzoeken for insert to authenticated
  with check (user_id = auth.uid() and status = 'open'
    and exists (select 1 from public.leden l where l.id = lid_id and l.user_id = auth.uid() and l.vve_id = wisverzoeken.vve_id));
create policy "eigenaar trekt open verzoek in" on public.wisverzoeken for delete to authenticated
  using (user_id = auth.uid() and status = 'open');
create policy "bestuur wijst af" on public.wisverzoeken for update to authenticated
  using (is_bestuur(vve_id)) with check (is_bestuur(vve_id));

-- Bestuur voert een verzoek uit: naam en e-mail leeg, koppeling los, account weg als het nergens anders bij hoort.
-- Appartement (breukdeel) en boekhouding blijven: een VvE moet haar administratie 7 jaar bewaren.
create or replace function public.voer_wisverzoek_uit(p_verzoek uuid, p_notitie text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v record; l record;
begin
  select * into v from wisverzoeken where id = p_verzoek;
  if v is null or v.status <> 'open' then raise exception 'Verzoek niet gevonden of al afgehandeld'; end if;
  if not is_bestuur(v.vve_id) then raise exception 'Alleen het bestuur kan verzoeken afhandelen'; end if;
  select * into l from leden where id = v.lid_id;
  if l.rol = 'bestuur' and not exists (select 1 from leden where vve_id = v.vve_id and rol = 'bestuur' and user_id is not null and id <> l.id) then
    raise exception 'Dit is het enige bestuurslid. Wijs eerst een ander bestuurslid aan.';
  end if;
  update leden set naam = null, email = null, user_id = null, rol = 'eigenaar' where id = v.lid_id;
  update wisverzoeken set status = 'afgehandeld', notitie = coalesce(p_notitie, ''), besloten_op = now(), reden = '' where id = p_verzoek;
  if v.user_id is not null and not exists (select 1 from leden where user_id = v.user_id) then
    delete from auth.users where id = v.user_id;
  end if;
end $$;
revoke all on function public.voer_wisverzoek_uit(uuid, text) from public, anon;
grant execute on function public.voer_wisverzoek_uit(uuid, text) to authenticated;

-- Soort eenheid per VvE (appartementen, parkeerplaatsen, ...), alleen voor de teksten in het portaal.
alter table public.vves add column eenheid text not null default 'appartement'
  check (eenheid in ('appartement', 'parkeerplaats', 'bedrijfsruimte', 'berging', 'eenheid'));

-- Migratie stukken_opslag: privé-bucket voor stukken (pdf, max 20 MB). Map = vve_id; leden lezen, bestuur uploadt en verwijdert.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
  values ('stukken','stukken',false,20971520,array['application/pdf']) on conflict (id) do nothing;
create or replace function public.vve_uit_pad(pad text) returns uuid language plpgsql immutable as $$
  begin return split_part(pad,'/',1)::uuid; exception when others then return null; end $$;
create policy "leden lezen stukken" on storage.objects for select to authenticated
  using (bucket_id='stukken' and public.is_lid(public.vve_uit_pad(name)));
create policy "bestuur uploadt stukken" on storage.objects for insert to authenticated
  with check (bucket_id='stukken' and public.is_bestuur(public.vve_uit_pad(name)));
create policy "bestuur verwijdert stukken" on storage.objects for delete to authenticated
  using (bucket_id='stukken' and public.is_bestuur(public.vve_uit_pad(name)));

-- Migratie vve_beheer: een beheerder kan een VvE beheren zonder zelf eigenaar te zijn.
-- Hij telt dan als bestuur (alle rechten), maar heeft geen eenheid, geen breukdeel en geen stem.
create table public.vve_beheer (
  vve_id uuid not null references public.vves on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (vve_id, user_id)
);
alter table public.vve_beheer enable row level security;
create policy "eigen beheer lezen" on public.vve_beheer for select to authenticated using (user_id = auth.uid());
grant select on public.vve_beheer to authenticated;

create or replace function public.is_lid(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leden where vve_id = v and user_id = auth.uid())
      or exists (select 1 from vve_beheer where vve_id = v and user_id = auth.uid());
$$;

create or replace function public.is_bestuur(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leden where vve_id = v and user_id = auth.uid() and rol = 'bestuur')
      or exists (select 1 from vve_beheer where vve_id = v and user_id = auth.uid());
$$;

-- Nieuwe VvE: alleen voor beheerders. Met een eenheid wordt de maker daar bestuurder van;
-- zonder eenheid (leeg) wordt hij alleen beheerder van de VvE.
create or replace function public.maak_vve(p_naam text, p_appartement text, p_breukdeel numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not ben_beheerder() then raise exception 'Alleen beheerders kunnen een VvE aanmaken'; end if;
  if coalesce(trim(p_naam), '') = '' then raise exception 'Geef de VvE een naam'; end if;
  insert into vves (naam) values (trim(p_naam)) returning id into v;
  if coalesce(trim(p_appartement), '') = '' then
    insert into vve_beheer (vve_id, user_id) values (v, auth.uid());
  else
    insert into leden (vve_id, appartement, breukdeel, email, user_id, rol)
    values (v, trim(p_appartement), coalesce(p_breukdeel, 1), auth.email(), auth.uid(), 'bestuur');
  end if;
  return v;
end $$;

-- Migratie berichten: leden sturen het bestuur een bericht via het portaal.
create table public.berichten (
  id uuid primary key default gen_random_uuid(),
  vve_id uuid not null references public.vves on delete cascade,
  user_id uuid references auth.users on delete set null,
  afzender text not null default '',          -- eenheidsnummer of 'beheer', geen naam
  onderwerp text not null check (length(onderwerp) between 1 and 120),
  tekst text not null check (length(tekst) between 1 and 4000),
  status text not null default 'open' check (status in ('open', 'afgehandeld')),
  antwoord text not null default '' check (length(antwoord) <= 4000),
  aangemaakt timestamptz not null default now(),
  beantwoord_op timestamptz
);
create index on public.berichten (vve_id, aangemaakt desc);
alter table public.berichten enable row level security;
create policy "eigen bericht of bestuur leest" on public.berichten for select to authenticated
  using (user_id = auth.uid() or is_bestuur(vve_id));
create policy "lid stuurt bericht" on public.berichten for insert to authenticated
  with check (user_id = auth.uid() and is_lid(vve_id) and status = 'open' and antwoord = '');
create policy "bestuur antwoordt" on public.berichten for update to authenticated
  using (is_bestuur(vve_id)) with check (is_bestuur(vve_id));
create policy "bestuur verwijdert bericht" on public.berichten for delete to authenticated
  using (is_bestuur(vve_id));
grant select, insert, update, delete on public.berichten to authenticated;

-- Migratie vve_contact_email: mailadres waarop leden het bestuur van deze VvE kunnen mailen.
alter table public.vves add column contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- ---------- Mailadres per VvE doorsturen naar het bestuur (migratie mail_doorsturen) ----------
-- Elk adres hoort bij één VvE; de Worker (/mailadres) vraagt de bestuursadressen op en zet ze in ImprovMX.
create unique index vves_contact_email_uniek on public.vves (lower(contact_email)) where contact_email is not null;
create or replace function public.bestuur_mails(v uuid) returns text[] language plpgsql stable security definer set search_path = public as $$
begin
  if not is_bestuur(v) then raise exception 'Alleen het bestuur'; end if;
  return array(select distinct lower(e) from (
    select email as e from leden where vve_id = v and rol = 'bestuur' and email is not null and email <> ''
    union select u.email from vve_beheer b join auth.users u on u.id = b.user_id where b.vve_id = v and u.email is not null) x order by 1);
end $$;
revoke all on function public.bestuur_mails(uuid) from public, anon;
grant execute on function public.bestuur_mails(uuid) to authenticated;

-- Migratie bericht_melding (toegepast, nog niet in gebruik): voor een latere meldingsmail aan het bestuur bij een nieuw bericht.
alter table public.berichten add column gemeld timestamptz;
create or replace function public.bericht_melding(b uuid) returns json language plpgsql security definer set search_path = public as $$
declare r public.berichten; ontv text[]; van text;
begin
  update berichten set gemeld = now()
   where id = b and user_id = auth.uid() and gemeld is null and aangemaakt > now() - interval '15 minutes'
   returning * into r;
  if not found then raise exception 'Geen nieuw bericht om te melden'; end if;
  select email into van from auth.users where id = auth.uid();
  ontv := array(select distinct lower(e) from (
    select email as e from leden where vve_id = r.vve_id and rol = 'bestuur' and email is not null and email <> ''
    union select u.email from vve_beheer vb join auth.users u on u.id = vb.user_id where vb.vve_id = r.vve_id and u.email is not null) x
    where lower(e) <> lower(coalesce(van, '')) order by 1);
  return json_build_object('vve', (select naam from vves where id = r.vve_id), 'afzender', r.afzender, 'onderwerp', r.onderwerp,
    'tekst', r.tekst, 'van', van, 'naar', ontv);
end $$;
revoke all on function public.bericht_melding(uuid) from public, anon;
grant execute on function public.bericht_melding(uuid) to authenticated;

-- Migratie bericht_vera_antwoord: Vera geeft het lid direct een eerste antwoord uit de stukken (AI, gemarkeerd).
-- De schrijver van het bericht slaat dat antwoord één keer op, binnen 15 minuten na versturen.
alter table public.berichten add column vera_antwoord text;
create or replace function public.vera_antwoord(b uuid, tekst text) returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
begin
  update berichten set vera_antwoord = left(tekst, 4000)
   where id = b and user_id = auth.uid() and vera_antwoord is null and aangemaakt > now() - interval '15 minutes';
  if not found then raise exception 'Dit bericht heeft al een antwoord van Vera'; end if;
end $$;
revoke all on function public.vera_antwoord(uuid, text) from public, anon;
grant execute on function public.vera_antwoord(uuid, text) to authenticated;

-- 2026-10-14 vera_mail (toegepast): Vera beantwoordt mail aan het VvE-adres (Worker /inbound, alleen service_role)
alter table public.berichten add column if not exists bron text not null default 'portaal' check (bron in ('portaal', 'mail'));
alter table public.berichten add column if not exists mail_id text unique;
alter table public.berichten add column if not exists mail_van text;

create or replace function public.vera_mail_in(p_mail_id text, p_aan text[], p_van text, p_onderwerp text, p_tekst text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v vves%rowtype;
  l leden%rowtype;
  b uuid;
begin
  select * into v from vves where lower(contact_email) = any (select lower(x) from unnest(p_aan) x) limit 1;
  if not found then return jsonb_build_object('reden', 'onbekend VvE-adres'); end if;
  select * into l from leden where vve_id = v.id and lower(email) = lower(p_van) limit 1;
  if not found then return jsonb_build_object('reden', 'afzender is geen lid'); end if;
  if (select count(*) from berichten where vve_id = v.id and bron = 'mail' and aangemaakt > now() - interval '1 day') >= 30
     or (select count(*) from berichten where mail_van = lower(p_van) and aangemaakt > now() - interval '1 day') >= 5 then
    return jsonb_build_object('reden', 'te veel mails vandaag');
  end if;
  insert into berichten (vve_id, user_id, afzender, onderwerp, tekst, bron, mail_id, mail_van)
  values (v.id, l.user_id, left(coalesce(nullif(l.naam, ''), l.email) || ' (per mail)', 200),
          left(coalesce(nullif(trim(p_onderwerp), ''), '(geen onderwerp)'), 120), left(coalesce(nullif(trim(p_tekst), ''), '(lege mail)'), 4000), 'mail', p_mail_id, lower(p_van))
  on conflict (mail_id) do nothing
  returning id into b;
  if b is null then return jsonb_build_object('reden', 'al verwerkt'); end if;
  return jsonb_build_object('bericht', b, 'vve', v.id, 'vve_naam', v.naam, 'eenheid', v.eenheid, 'adres', v.contact_email,
    'naam', coalesce(nullif(l.naam, ''), ''), 'appartement', l.appartement, 'breukdeel', l.breukdeel,
    'paden', coalesce((select jsonb_agg(name) from (select name from storage.objects where bucket_id = 'stukken'
      and name like v.id::text || '/%' and name not like '%/.emptyFolderPlaceholder' order by created_at desc limit 25) s), '[]'::jsonb));
end $$;

create or replace function public.vera_mail_antwoord(p_bericht uuid, p_tekst text)
returns void language sql security definer set search_path = public as $$
  update berichten set vera_antwoord = left(p_tekst, 4000) where id = p_bericht and bron = 'mail' and vera_antwoord is null;
$$;

revoke all on function public.vera_mail_in(text, text[], text, text, text) from public, anon, authenticated;
revoke all on function public.vera_mail_antwoord(uuid, text) from public, anon, authenticated;
grant execute on function public.vera_mail_in(text, text[], text, text, text) to service_role;
grant execute on function public.vera_mail_antwoord(uuid, text) to service_role;

-- 2026-10-14 vera_mail_stukken_versie (toegepast): vera_mail_in geeft stukken met versie (eTag) en grootte terug, zodat de Worker niet hoeft te downloaden.

-- 2026-10-15 portaal_beveiliging (toegepast): privacy en beveiliging vóór live (herkeuring 14 oktober).

-- 1. Betalingen: een lid leest alleen de mutaties van zijn eigen eenheid en algemene uitgaven; het bestuur alles.
create or replace function public.mijn_eenheden(v uuid) returns setof text
language sql stable security definer set search_path = public as $$
  select appartement from leden where vve_id = v and user_id = auth.uid();
$$;
revoke all on function public.mijn_eenheden(uuid) from public, anon;
grant execute on function public.mijn_eenheden(uuid) to authenticated;

alter policy "leden lezen" on public.mutaties rename to "bestuur leest alles, lid eigen eenheid";
alter policy "bestuur leest alles, lid eigen eenheid" on public.mutaties
  using (is_bestuur(vve_id) or (is_lid(vve_id) and (
    appartement in (select mijn_eenheden(vve_id))
    or (appartement is null and bedrag < 0 and post <> 'Voorschot'))));

-- Totalen voor leden: saldo, uitgaven per post en hoeveel eenheden deze maand hun voorschot betaalden.
create or replace function public.geld_totalen(v uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j int; t numeric; n numeric; mnd text := to_char(now() at time zone 'Europe/Amsterdam', 'YYYY-MM');
begin
  if not is_lid(v) then raise exception 'Geen lid van deze VvE'; end if;
  select boekjaar into j from vves where id = v;
  t := coalesce((select sum(b.bedrag) from begroting b where b.vve_id = v and b.jaar = j), 0)
     + coalesce((select sum(m.kosten / m.levensduur) from mjop m where m.vve_id = v), 0);
  n := coalesce(nullif((select sum(l.breukdeel) from leden l where l.vve_id = v), 0), 1);
  return jsonb_build_object(
    'jaar', j,
    'aantal', (select count(*) from mutaties m where m.vve_id = v and extract(year from m.datum) = j),
    'som', coalesce((select sum(m.bedrag) from mutaties m where m.vve_id = v and extract(year from m.datum) = j), 0),
    'per_post', coalesce((select jsonb_object_agg(x.post, x.s) from (select m.post, sum(m.bedrag) s from mutaties m
                 where m.vve_id = v and extract(year from m.datum) = j group by m.post) x), '{}'::jsonb),
    'betaald_maand', (select count(*) from leden l where l.vve_id = v and t * l.breukdeel / n / 12 > 0
       and coalesce((select sum(m.bedrag) from mutaties m where m.vve_id = v and m.post = 'Voorschot'
                      and m.appartement = l.appartement and to_char(m.datum, 'YYYY-MM') = mnd), 0) >= t * l.breukdeel / n / 12 - 0.01));
end $$;
revoke all on function public.geld_totalen(uuid) from public, anon;
grant execute on function public.geld_totalen(uuid) to authenticated;

-- 2. E-mailadressen van leden: alleen voor het bestuur (via leden_emails); leden lezen de andere kolommen.
revoke select on public.leden from anon, authenticated;
grant select (id, vve_id, appartement, breukdeel, naam, user_id, rol) on public.leden to authenticated;
create or replace function public.leden_emails(v uuid) returns table (id uuid, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_bestuur(v) then raise exception 'Alleen het bestuur'; end if;
  return query select l.id, l.email from leden l where l.vve_id = v;
end $$;
revoke all on function public.leden_emails(uuid) from public, anon;
grant execute on function public.leden_emails(uuid) to authenticated;

-- 3. Berichten: een lid kan alleen een gewoon portaalbericht onder zijn eigen eenheid insturen.
alter policy "lid stuurt bericht" on public.berichten
  with check (user_id = auth.uid() and is_lid(vve_id) and status = 'open' and antwoord = '' and bron = 'portaal'
    and mail_id is null and mail_van is null and vera_antwoord is null and gemeld is null and beantwoord_op is null
    and aangemaakt between now() - interval '1 minute' and now() + interval '1 minute'
    and (afzender in (select mijn_eenheden(vve_id))
         or (afzender = 'beheer' and exists (select 1 from vve_beheer b where b.vve_id = berichten.vve_id and b.user_id = auth.uid()))));

create or replace function public.vera_antwoord(b uuid, tekst text) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
begin
  update berichten set vera_antwoord = left(tekst, 4000)
   where id = b and user_id = auth.uid() and bron = 'portaal' and vera_antwoord is null and aangemaakt > now() - interval '15 minutes';
  if not found then raise exception 'Dit bericht heeft al een antwoord van Vera'; end if;
end $$;

-- 4. Advisors: ongebruikte meldingsfunctie dicht, vaste search_path.
revoke all on function public.bericht_melding(uuid) from public, anon, authenticated;
alter function public.vve_uit_pad(text) set search_path = '';

-- 5. Startwachtwoord: accounts van het bestuur krijgen een vlag; het portaal laat de eigenaar eerst een eigen wachtwoord kiezen.
create or replace function public.maak_account(p_lid uuid, p_wachtwoord text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare l record; e text; nieuw uuid := gen_random_uuid();
begin
  select * into l from leden where id = p_lid;
  if l is null then raise exception 'Appartement niet gevonden'; end if;
  if not is_bestuur(l.vve_id) then raise exception 'Alleen het bestuur kan accounts maken'; end if;
  if l.user_id is not null then raise exception 'Dit appartement heeft al een account'; end if;
  e := lower(trim(coalesce(l.email, '')));
  if e = '' then raise exception 'Zet eerst een e-mailadres bij dit appartement'; end if;
  if length(coalesce(p_wachtwoord, '')) < 8 then raise exception 'Kies een wachtwoord van minstens 8 tekens'; end if;
  if exists (select 1 from auth.users where lower(email) = e) then
    raise exception 'Dit e-mailadres heeft al een account. De eigenaar kan inloggen met zijn eigen wachtwoord of via een e-maillink.';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', nieuw, 'authenticated', 'authenticated', e,
    crypt(p_wachtwoord, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"startwachtwoord":true}', now(), now(), '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), nieuw, nieuw::text, 'email',
    jsonb_build_object('sub', nieuw::text, 'email', e, 'email_verified', true, 'phone_verified', false), now(), now(), now());
  update leden set user_id = nieuw where id = p_lid;
  return l.appartement;
end $$;

-- 6. Nieuwe accounts (maillink) alleen voor adressen die bij een VvE staan of beheerder zijn.
-- Aanzetten in Supabase: Authentication > Hooks > Before User Created > Postgres > public.voor_nieuwe_gebruiker.
create or replace function public.voor_nieuwe_gebruiker(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := lower(trim(coalesce(event->'user'->>'email', '')));
begin
  if e <> '' and (exists (select 1 from leden where lower(email) = e) or exists (select 1 from beheerders where lower(email) = e)) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'Dit e-mailadres staat bij geen enkele VvE. Vraag het bestuur om het bij uw eenheid te zetten.'));
end $$;
revoke all on function public.voor_nieuwe_gebruiker(jsonb) from public, anon, authenticated;
grant execute on function public.voor_nieuwe_gebruiker(jsonb) to supabase_auth_admin;

-- 2026-10-16 veiligheidskopie: het bestuur downloadt alle gegevens van een VvE als bestand en kan die later terugzetten.

create or replace function public.vve_kopie(v uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_bestuur(v) then raise exception 'Alleen het bestuur kan een veiligheidskopie maken'; end if;
  return jsonb_build_object(
    'soort', 'vvekit-kopie', 'versie', 1, 'gemaakt', now(),
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
end $$;
revoke all on function public.vve_kopie(uuid) from public, anon;
grant execute on function public.vve_kopie(uuid) to authenticated;

-- Terugzetten: alles in één transactie; lukt één regel niet, dan verandert er niets.
-- Geld, begroting, onderhoud, vergaderingen en akkoorden worden vervangen door de kopie.
-- Berichten en wisverzoeken die er nu zijn blijven staan; ontbrekende uit de kopie komen terug.
-- Accounts blijven gekoppeld; een account komt alleen terug bij een eenheid met hetzelfde e-mailadres.
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

  return jsonb_build_object('leden', (select count(*) from leden where vve_id = v), 'mutaties', (select count(*) from mutaties where vve_id = v),
    'vergaderingen', (select count(*) from vergaderingen where vve_id = v));
end $$;
revoke all on function public.vve_terugzetten(uuid, jsonb) from public, anon;
grant execute on function public.vve_terugzetten(uuid, jsonb) to authenticated;

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
