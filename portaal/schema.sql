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
