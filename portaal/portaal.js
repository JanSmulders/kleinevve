// VvE-portaal (testomgeving). Inloggen per e-mail via Supabase; de database bepaalt met
// row level security wie wat mag zien en wijzigen. Deze code berekent alleen en toont.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";

const SUPABASE_URL = "https://nevkccqxidibpthxowyh.supabase.co";
const SUPABASE_KEY = "sb_publishable_vP7uUh1wM9WoTkShwNsEWg_8ikU4UlC"; // publishable key: mag openbaar, de database-regels beschermen de gegevens

const VERA_API = "https://kleinevve.jansmulders1966.workers.dev"; // dezelfde Worker als Vera op de website
const app = document.getElementById("app");
const wie = document.getElementById("wie");
const sb = SUPABASE_URL ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ---------- hulpjes ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => "€ " + Number(n || 0).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = (n) => "€ " + Math.round(Number(n || 0)).toLocaleString("nl-NL");
// Breukdeel: "1", "1/32" of "12/1000" -> alleen de teller telt; het portaal deelt zelf door het totaal.
const deel = (s) => { const t = String(s ?? "").trim(); return t === "" ? 1 : getal(t.split("/")[0]); };
const nl = (n) => Number(n).toLocaleString("nl-NL", { maximumFractionDigits: 4 });
const EENHEDEN = { appartement: ["appartement", "appartementen", "App."], parkeerplaats: ["parkeerplaats", "parkeerplaatsen", "Pl."], bedrijfsruimte: ["bedrijfsruimte", "bedrijfsruimten", "Ruimte"], berging: ["berging", "bergingen", "Berging"], eenheid: ["eenheid", "eenheden", "Nr."] };
const eh = () => EENHEDEN[S.vve?.eenheid] || EENHEDEN.appartement;
const e1 = () => eh()[0], eN = () => eh()[1], eK = () => eh()[2];
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const noemer = () => S.leden.reduce((t, l) => t + Number(l.breukdeel), 0);
const getal = (s) => {
  let t = String(s ?? "").trim().replace(/\s|€/g, "");
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "");
  return Number(t.replace(",", "."));
};
const datumNL = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
const vandaag = () => new Date().toISOString().slice(0, 10);
const STANDAARD_AGENDA = ["Opening en vaststellen agenda", "Notulen vorige vergadering", "Jaarrekening en decharge bestuur", "Begroting en voorschotten", "Reservefonds en MJOP", "Besluiten over onderhoud", "Benoeming bestuur en kascommissie", "Rondvraag en sluiting"];

// ---------- toestand ----------
const S = { sessie: null, vves: [], vve: null, leden: [], begroting: [], mutaties: [], mjop: [], vergaderingen: [], stemmingen: [], akkoorden: [], wisverzoeken: [], berichten: [], stukken: [], vera: {}, concepten: {}, conceptBezig: null, veraBericht: null, tab: "overzicht", melding: "", fout: "", import: null, inlogModus: "wachtwoord" };
const ik = () => S.leden.find((l) => l.user_id === S.sessie?.user?.id);
const beheert = () => (S.beheer || []).includes(S.vve?.id); // beheerder zonder eigen eenheid
const bestuur = () => ik()?.rol === "bestuur" || beheert();
const startwachtwoord = () => !!S.sessie?.user?.user_metadata?.startwachtwoord; // account gemaakt door het bestuur

function meld(tekst, fout = false, zichtbaar = fout) {
  S.melding = fout ? "" : tekst; S.fout = fout ? tekst : ""; teken();
  if (zichtbaar && tekst) app.querySelector(".melding")?.scrollIntoView({ behavior: "smooth", block: "center" }); // anders mist u een fout onderaan een lange pagina
}

// ---------- berekeningen ----------
function cijfers() {
  const v = S.vve, jaar = v.boekjaar;
  const mjop = S.mjop.map((m) => ({ ...m, volgende: m.laatst + m.levensduur, perJaar: Number(m.kosten) / m.levensduur }));
  const reservering = mjop.reduce((s, m) => s + m.perJaar, 0);
  const minimum = v.herbouwwaarde ? 0.005 * Number(v.herbouwwaarde) : 0;
  const posten = S.begroting.filter((b) => b.jaar === jaar);
  const vast = posten.reduce((s, b) => s + Number(b.bedrag), 0);
  const totaal = vast + reservering;
  const noemer = S.leden.reduce((s, l) => s + Number(l.breukdeel), 0) || 1;
  const muts = S.mutaties.filter((m) => m.datum.startsWith(String(jaar)));
  const saldo = Number(v.startsaldo_betaal) + muts.reduce((s, m) => s + Number(m.bedrag), 0);
  const reserve = Number(v.startsaldo_reserve) + muts.filter((m) => m.post === "Reservefonds").reduce((s, m) => s - Number(m.bedrag), 0);
  const nu = new Date();
  const maanden = nu.getFullYear() > jaar ? 12 : nu.getFullYear() < jaar ? 0 : nu.getMonth() + 1;
  const maand = nu.toISOString().slice(0, 7);
  const perLid = S.leden.map((l) => {
    const pm = (totaal * Number(l.breukdeel)) / noemer / 12;
    const ontvangen = muts.filter((m) => m.post === "Voorschot" && m.appartement === l.appartement).reduce((s, m) => s + Number(m.bedrag), 0);
    const dezeMaand = S.mutaties.filter((m) => m.post === "Voorschot" && m.appartement === l.appartement && m.datum.startsWith(maand)).reduce((s, m) => s + Number(m.bedrag), 0);
    return { ...l, pm, verwacht: pm * maanden, ontvangen, verschil: ontvangen - pm * maanden, dezeMaand };
  });
  const werkelijk = (post) => -muts.filter((m) => m.post === post).reduce((s, m) => s + Number(m.bedrag), 0);
  const t = S.totalen;
  if (t) { // lid: saldi en uitgaven over alle mutaties, berekend door de database
    const post = (p) => Number(t.per_post[p] || 0);
    return { jaar, mjop, reservering, minimum, posten, vast, totaal, noemer, muts, aantal: t.aantal, betaald: t.betaald_maand, perLid, maanden,
      saldo: Number(v.startsaldo_betaal) + Number(t.som), reserve: Number(v.startsaldo_reserve) - post("Reservefonds"), werkelijk: (p) => -post(p) };
  }
  return { jaar, mjop, reservering, minimum, posten, vast, totaal, noemer, muts, aantal: muts.length, saldo, reserve, maanden, perLid, werkelijk };
}

function aandachtspunten(c) {
  const p = [];
  // Betalingen van anderen ziet alleen het bestuur (privacy); een lid ziet alleen zijn eigen achterstand.
  for (const l of c.perLid) if (c.maanden && l.verschil < -1 && (bestuur() || l.appartement === ik()?.appartement))
    p.push(["let", bestuur() ? `${eK()} ${esc(l.appartement)} loopt ${eur(-l.verschil)} achter met voorschotten.` : `U loopt ${eur(-l.verschil)} achter met uw voorschotten.`]);
  for (const m of c.mjop) if (m.volgende - new Date().getFullYear() <= 2) p.push(["let", `${esc(m.onderdeel)} is aan de beurt in ${m.volgende} (${eur0(m.kosten)}).`]);
  if (!S.mjop.length && c.minimum) p.push(["let", `Er is nog geen MJOP. Dan is het wettelijk minimum voor het reservefonds 0,5% van de herbouwwaarde: ${eur0(c.minimum)} per jaar.`]);
  if (!S.mjop.length && !c.minimum) p.push(["let", "Vul de herbouwwaarde in (Instellingen) of maak een MJOP (Onderhoud), dan reken ik de reservering uit."]);
  for (const b of c.posten) { const w = c.werkelijk(b.post); if (w > Number(b.bedrag) && Number(b.bedrag) > 0) p.push(["let", `${esc(b.post)}: ${eur0(w)} uitgegeven, begroot ${eur0(b.bedrag)}.`]); }
  const ditJaar = S.vergaderingen.some((v) => v.datum.startsWith(String(c.jaar)) || v.datum.startsWith(String(c.jaar + 1)));
  if (!ditJaar) p.push(["let", "Er staat nog geen ledenvergadering gepland. Een VvE moet minstens één keer per jaar vergaderen."]);
  for (const w of S.wisverzoeken) if (w.status === "open" && bestuur()) p.push(["let", `${eK()} ${esc(w.appartement)} vraagt om wissen van persoonsgegevens (zie Leden). Handel dit binnen een maand af.`]);
  const nieuw = S.berichten.filter((b) => b.status === "open").length;
  if (nieuw && bestuur()) p.push(["let", `${nieuw} ${nieuw === 1 ? "bericht" : "berichten"} van leden ${nieuw === 1 ? "wacht" : "wachten"} op antwoord (zie Berichten).`]);
  if (bestuur() && !S.leden.some((l) => l.email)) p.push(["let", `Nog geen e-mailadressen bij de ${eN()}: eigenaren kunnen dan nog niet inloggen.`]);
  if (!p.length) p.push(["ok", "Alles op orde: geen achterstanden, geen onderhoud binnen 2 jaar, vergadering gepland."]);
  return p;
}

// ---------- gegevens ----------
async function laadVves() {
  await sb.rpc("koppel_mij");
  const { data, error } = await sb.from("vves").select("*").order("naam");
  if (error) throw error;
  S.vves = data;
  const beheer = await sb.from("vve_beheer").select("vve_id"); // ontbreekt de tabel nog, dan geen beheer
  S.beheer = beheer.error ? [] : beheer.data.map((r) => r.vve_id);
  let vorige = S.voorkeur; try { vorige ||= localStorage.getItem("portaal-vve"); } catch {}
  if (!S.vve && data.length) await kiesVve((data.find((v) => v.id === vorige) || data[0]).id);
}
// E-mailadressen van leden ziet alleen het bestuur; leden zien de totalen van de VvE, niet de betalingen van buren.
const LEDEN_KOLOMMEN = "id,vve_id,appartement,breukdeel,naam,user_id,rol";
async function laadExtra(id) {
  S.totalen = null;
  if (bestuur()) {
    let r = await sb.rpc("leden_emails", { v: id });
    if (r.error) r = await sb.from("leden").select("id,email").eq("vve_id", id); // database nog zonder leden_emails
    const mail = new Map((r.data || []).map((x) => [x.id, x.email]));
    for (const l of S.leden) l.email = mail.get(l.id) || null;
  } else {
    const r = await sb.rpc("geld_totalen", { v: id });
    if (!r.error && r.data && r.data.jaar === S.vve.boekjaar) S.totalen = r.data;
  }
}
async function kiesVve(id) {
  try { localStorage.setItem("portaal-vve", id); } catch {}
  const q = (t) => sb.from(t).select("*").eq("vve_id", id);
  const [vve, leden, begroting, mutaties, mjop, vergaderingen, stemmingen, akkoorden, wisverzoeken, berichten] = await Promise.all([
    sb.from("vves").select("*").eq("id", id).single(), sb.from("leden").select(LEDEN_KOLOMMEN).eq("vve_id", id).order("appartement"), q("begroting").order("post"),
    q("mutaties").order("datum", { ascending: false }), q("mjop").order("laatst"), q("vergaderingen").order("datum", { ascending: false }),
    q("stemmingen"), q("akkoorden").order("aangemaakt", { ascending: false }), q("wisverzoeken").order("aangemaakt", { ascending: false }),
    q("berichten").order("aangemaakt", { ascending: false }),
  ]);
  for (const r of [vve, leden, begroting, mutaties, mjop, vergaderingen, stemmingen, akkoorden, wisverzoeken]) if (r.error) throw r.error;
  S.berichten = berichten.error ? [] : berichten.data; // tabel kan nog ontbreken
  Object.assign(S, { vve: vve.data, leden: leden.data, begroting: begroting.data, mutaties: mutaties.data, mjop: mjop.data, vergaderingen: vergaderingen.data, stemmingen: stemmingen.data, akkoorden: akkoorden.data, wisverzoeken: wisverzoeken.data });
  S.leden.sort((a, b) => a.appartement.localeCompare(b.appartement, "nl", { numeric: true }));
  await Promise.all([laadExtra(id), laadStukken()]);
}
async function laadStukken() {
  const { data } = await sb.storage.from("stukken").list(S.vve.id, { sortBy: { column: "created_at", order: "desc" } });
  const lijst = (data || []).filter((f) => f.name && !f.name.startsWith("."));
  const { data: urls } = lijst.length ? await sb.storage.from("stukken").createSignedUrls(lijst.map((f) => `${S.vve.id}/${f.name}`), 3600) : { data: [] };
  S.stukken = lijst.map((f, i) => ({ naam: f.name, pad: `${S.vve.id}/${f.name}`, grootte: f.metadata?.size || 0, datum: f.created_at, url: urls?.[i]?.signedUrl }));
}
// Veiligheidskopie: alle gegevens van de VvE als JSON-bestand (rpc vve_kopie, alleen bestuur).
async function kopieDownloaden(extra = "") {
  const { data, error } = await sb.rpc("vve_kopie", { v: S.vve.id });
  if (error) throw error;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  a.download = `kopie-${S.vve.naam.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-${new Date().toLocaleString("sv-SE").slice(0, 16).replace(" ", "-").replace(":", "u")}${extra}.json`; // lokale tijd, bijv. 2026-10-16-23u08
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return data;
}
async function kopieKiezen(bestand) {
  meld(`Bestand "${bestand.name}" wordt gelezen…`);
  let k;
  try { k = JSON.parse(await new Response(bestand).text()); } catch { k = null; }
  if (k?.soort !== "vvekit-kopie") return meld("Dit bestand is geen veiligheidskopie van het portaal.", true);
  if (k.vve?.id !== S.vve.id) return meld(`Deze kopie is van ${k.vve?.naam || "een andere VvE"}, niet van ${S.vve.naam}.`, true);
  S.terugzet = { k, wanneer: new Date(k.gemaakt).toLocaleString("nl-NL", { dateStyle: "long", timeStyle: "short" }), veilig: false };
  meld("Kopie gekozen. Download eerst een kopie van de huidige stand en zet daarna terug.", false, true);
}
// Downloaden en terugzetten zijn aparte tikken: Safari op iPhone/iPad breekt een verzoek af als er tegelijk een download start.
async function kopieTerugzetten() {
  const { k, wanneer } = S.terugzet;
  if (k.vve.id !== S.vve.id) { S.terugzet = null; return meld(`Deze kopie is van ${k.vve.naam}, niet van ${S.vve.naam}. Kies de kopie opnieuw.`, true); }
  if (!confirm(`Alle gegevens van ${S.vve.naam} terugzetten naar de stand van ${wanneer}? Wat daarna is ingevoerd verdwijnt.`)) return;
  meld("Terugzetten…");
  const { data, error } = await sb.rpc("vve_terugzetten", { v: S.vve.id, k });
  if (error) return meld("Terugzetten lukte niet. Er is niets veranderd. " + error.message, true);
  S.terugzet = null;
  await kiesVve(S.vve.id);
  meld(`Teruggezet naar de stand van ${wanneer}: ${data.leden} ${eN()}, ${data.mutaties} mutaties en ${data.vergaderingen} vergaderingen.`, false, true);
}
async function opslaan(belofte, ok, mail = false) {
  const { error } = await belofte;
  if (error) return meld(error.code === "23505" && /contact_email/.test(error.message) ? "Dit mailadres gebruikt een andere VvE al. Kies een ander adres." : "Dat lukte niet: " + error.message, true);
  await kiesVve(S.vve.id);
  const m = mail ? await doorsturen() : null;
  meld((ok || "Opgeslagen.") + (m ? " " + m.tekst : ""), !!m?.fout);
}
// Vera leest de stukken (max. 25) en de portaalgegevens en schrijft over een bericht van een lid.
async function veraOverBericht(b, opdracht) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(VERA_API + "/stuk", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
    body: JSON.stringify({ paden: S.stukken.slice(0, 25).map((f) => f.pad), vve: S.vve.naam, eenheid: eN(),
      portaal: portaalVoorVera() + `\n\nBericht van een lid aan het bestuur:\nOnderwerp: ${b.onderwerp}\n${b.tekst}`, messages: [{ role: "user", content: opdracht }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.answer) throw new Error(j.error || "Vera kon geen antwoord geven.");
  return j.answer;
}
// Een mailadres op @vvekit.nl stuurt de Worker (via ImprovMX) door naar alle bestuursleden met een e-mailadres.
async function doorsturen() {
  const adres = (S.vve?.contact_email || "").toLowerCase();
  if (!adres.endsWith("@vvekit.nl") || !bestuur()) return null;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(VERA_API + "/mailadres", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ vve_id: S.vve.id }) });
    const j = await r.json();
    if (!r.ok) return { fout: true, tekst: "Doorsturen van " + adres + " lukte niet: " + (j.error || r.status) };
    return { tekst: `Mail naar ${j.adres} gaat nu door naar ${j.naar.length === 1 ? "1 bestuurslid" : j.naar.length + " bestuursleden"}.` };
  } catch { return { fout: true, tekst: "Doorsturen van " + adres + " lukte niet: geen verbinding." }; }
}

// ---------- schermen ----------
function inlogScherm() {
  const link = S.inlogModus === "link";
  return `<div class="inlog kaart"><h1 style="font-size:1.6rem;margin-top:0">VvE-portaal</h1>
  ${S.fout ? `<div class="melding fout">${esc(S.fout)}</div>` : ""}${S.melding ? `<div class="melding">${esc(S.melding)}</div>` : ""}
  ${link ? `<p>Vul uw e-mailadres in. U krijgt een e-mail met een inloglink. Daarna kunt u onder <strong>Mijn account</strong> een wachtwoord instellen, zodat u de volgende keer geen mail meer nodig heeft.</p>
  <form class="formulier" data-form="inloglink"><label>E-mailadres<input type="email" name="email" required autocomplete="email"></label><button class="btn" type="submit">Stuur inloglink</button></form>
  <p><button class="linkknop" data-actie="inlogmodus" data-modus="wachtwoord">Terug naar inloggen met wachtwoord</button></p>`
  : `<p>Log in met het e-mailadres dat bij uw ${e1()} staat en uw wachtwoord.</p>
  <form class="formulier" data-form="inloggen"><label>E-mailadres<input type="email" name="email" required autocomplete="username"></label>
  <label>Wachtwoord<input type="password" name="ww" required autocomplete="current-password"></label><button class="btn" type="submit">Inloggen</button></form>
  <p><button class="linkknop" data-actie="inlogmodus" data-modus="link">Wachtwoord vergeten of nog geen wachtwoord? Log in met een e-maillink</button></p>`}
  <p style="font-size:.85rem;color:var(--muted)">Testomgeving. Gemaakt met AI (Claude), een dienst van Lumensquared.</p></div>`;
}

function account() {
  const u = S.sessie.user;
  const mijn = S.leden.filter((l) => l.user_id === u.id);
  const verzoek = S.wisverzoeken.find((w) => w.user_id === u.id && w.status === "open");
  const afgewezen = S.wisverzoeken.filter((w) => w.user_id === u.id && w.status === "afgewezen");
  return `<div class="kaart inlog" style="margin:0 auto;max-width:34rem"><h2 style="margin-top:0">Mijn account</h2>
  <h3>Wachtwoord</h3>
  <p style="color:var(--muted);font-size:.92rem">Met een wachtwoord logt u in zonder e-maillink.</p>
  <form class="formulier" data-form="wachtwoord"><label>Nieuw wachtwoord (minstens 8 tekens)<input type="password" name="ww" required minlength="8" autocomplete="new-password"></label>
  <label>Nog een keer<input type="password" name="ww2" required minlength="8" autocomplete="new-password"></label><button class="btn" type="submit">Wachtwoord opslaan</button></form>

  <h3 style="margin-top:28px">Mijn gegevens (AVG)</h3>
  <p style="color:var(--muted);font-size:.92rem">Dit staat over u in het portaal. <a href="privacy.html" target="_blank" rel="noopener">Lees de privacyverklaring</a>.</p>
  <table class="lijst"><tr><th>E-mailadres (inloggen)</th><td>${esc(u.email)}</td></tr><tr><th>Account sinds</th><td>${new Date(u.created_at).toLocaleDateString("nl-NL")}</td></tr>
  ${mijn.map((l) => `<tr><th>${esc(S.vve?.naam || "VvE")}</th><td>${eK()} ${esc(l.appartement)} (breukdeel ${nl(l.breukdeel)}/${nl(noemer())}), rol ${l.rol}${l.naam ? `, naam ${esc(l.naam)}` : ""}</td></tr>`).join("")}</table>
  <p style="font-size:.85rem;color:var(--muted)">Betalingen van uw ${e1()} staan in de boekhouding van de VvE. Die moet de VvE 7 jaar bewaren; die worden dus niet gewist.</p>
  ${afgewezen.map((w) => `<div class="melding fout">Uw verzoek van ${new Date(w.aangemaakt).toLocaleDateString("nl-NL")} is afgewezen${w.notitie ? `: ${esc(w.notitie)}` : "."}</div>`).join("")}
  ${!mijn.length ? "" : verzoek
    ? `<div class="melding">U heeft op ${new Date(verzoek.aangemaakt).toLocaleDateString("nl-NL")} gevraagd om uw gegevens te wissen. Het bestuur handelt dit af.</div><p><button class="klein-knop" data-actie="wis-intrekken" data-id="${verzoek.id}">Verzoek intrekken</button></p>`
    : `<details class="blok"><summary>Mijn gegevens laten wissen</summary>
      <p style="font-size:.9rem">Het bestuur wist dan uw naam en e-mailadres bij het ${e1()} en verwijdert uw account. U kunt daarna niet meer inloggen. Het ${e1()} en de boekhouding blijven bestaan.</p>
      <form class="formulier" data-form="wisverzoek" data-lid="${mijn[0].id}"><label>Reden (mag leeg blijven)<input name="reden"></label><button class="btn" type="submit">Verzoek indienen</button></form></details>`}
  <p style="margin-top:20px"><button class="linkknop" data-tab="overzicht">${S.vve ? "Terug naar het portaal" : "Terug"}</button></p></div>`;
}

function nieuweVveForm() {
  return `<form class="formulier" data-form="nieuwe-vve"><label>Naam van de VvE<input name="naam" required placeholder="VvE Voorbeeldstraat 12"></label>
  <label style="display:flex;gap:.5em;align-items:center"><input type="checkbox" name="eigen" style="width:auto" data-actie="eigen-eenheid"${S.eigenEenheid ? " checked" : ""}> Ik ben zelf eigenaar in deze VvE</label>
  ${S.eigenEenheid ? `<label>Uw eenheid (nummer)<input name="app" required placeholder="bijv. 1 of 12-A"></label>
  <label>Breukdeel van uw eenheid<input name="deel" inputmode="decimal" value="1"></label>
  <p style="font-size:.85rem;color:var(--muted);margin:0">Zijn alle eenheden gelijk? Laat dan 1 staan. Staat in de splitsingsakte iets als 12/1000, vul dan 12 in.</p>`
  : `<p style="font-size:.85rem;color:var(--muted);margin:0">U wordt beheerder: u kunt alles instellen, maar heeft geen eigen eenheid, breukdeel of stem.</p>`}
  <button class="btn" type="submit">VvE aanmaken</button>${S.vve ? ` <button class="klein-knop" type="button" data-actie="nieuwe-vve-dicht">Annuleren</button>` : ""}</form>`;
}
function geenVve(beheerder) {
  return `<div class="inlog kaart"><h1 style="font-size:1.5rem;margin-top:0">Welkom</h1>
  ${S.fout ? `<div class="melding fout">${esc(S.fout)}</div>` : ""}
  ${beheerder ? `<p>U heeft nog geen VvE. Maak er een aan.</p>${nieuweVveForm()}`
  : `<p>Uw e-mailadres (${esc(S.sessie.user.email)}) staat nog bij geen enkele VvE. Vraag het bestuur van uw VvE om uw e-mailadres bij uw ${e1()} te zetten, en log daarna opnieuw in.</p>`}</div>`;
}

function kop(c) {
  return `<section class="kop"><div><p class="pill">VvE-portaal${bestuur() ? " · bestuur" : ""}</p><h1>${esc(S.vve.naam)}</h1>
  <p class="sub">${S.leden.length} ${eN()} · boekjaar ${c.jaar} · ${ik() ? `u bent ${eK().toLowerCase()} ${esc(ik().appartement)}` : beheert() ? "u bent beheerder" : ""}</p>
  ${S.vves.length > 1 || S.beheerder ? `<div class="vve-kies">${S.vves.length > 1 ? S.vves.map((v) => `<button class="chip" data-actie="kies-vve" data-id="${v.id}"${v.id === S.vve.id ? ' aria-current="true" style="font-weight:700"' : ""}>${esc(v.naam)}</button>`).join("") : ""}${S.beheerder ? `<button class="chip" data-actie="nieuwe-vve-open">+ Nieuwe VvE</button>` : ""}</div>` : ""}
  ${S.nieuweVve ? `<div class="kaart" style="margin-top:14px;max-width:520px"><h2>Nieuwe VvE</h2>${nieuweVveForm()}</div>` : ""}</div>
  <div class="kop-vera"><img src="/img/vera.svg" alt="" width="44" height="44"><div><strong>Vera <span class="ai-label">AI</span></strong><span>Controleert de cijfers bij elk bezoek.</span></div></div></section>
  <nav class="tabs" role="tablist">${["overzicht", "geld", "onderhoud", "vergadering", "stukken", "berichten", "leden", ...(bestuur() ? ["instellingen"] : [])].map((t) => `<button role="tab" data-tab="${t}" aria-selected="${S.tab === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</nav>
  ${S.fout ? `<div class="melding fout">${esc(S.fout)}</div>` : ""}${S.melding ? `<div class="melding">${esc(S.melding)}</div>` : ""}`;
}

function overzicht(c) {
  const open = S.akkoorden.filter((a) => a.status === "open");
  const betaald = c.betaald ?? c.perLid.filter((l) => l.dezeMaand >= l.pm - 0.01 && l.pm > 0).length;
  const volgende = S.vergaderingen.filter((v) => v.datum >= vandaag()).sort((a, b) => a.datum.localeCompare(b.datum))[0];
  return `<div class="raster">
    <div class="tegel"><div class="lab">Betaalrekening</div><div class="getal">${eur(c.saldo)}</div><div class="klein">Startsaldo + ${c.aantal} mutaties in ${c.jaar}</div></div>
    <div class="tegel"><div class="lab">Reservefonds</div><div class="getal">${eur0(c.reserve)}</div><div class="klein">${S.mjop.length ? `Storting ${eur0(c.reservering)} per jaar (MJOP)` : c.minimum ? `Minimum ${eur0(c.minimum)} per jaar (0,5%)` : "Nog geen MJOP"}</div></div>
    <div class="tegel"><div class="lab">Voorschotten deze maand</div><div class="getal">${betaald} van ${S.leden.length}</div><div class="klein">ontvangen volgens de mutaties</div></div>
    <div class="tegel"><div class="lab">Volgende vergadering</div><div class="getal">${volgende ? datumNL(volgende.datum).replace(/ \d{4}$/, "") : "–"}</div><div class="klein">${volgende ? "gepland" : "nog niet gepland"}</div></div>
  </div>
  <div class="twee">
    <div class="kaart"><h2>Wacht op het bestuur (${open.length})</h2>
      ${S.akkoorden.slice(0, 8).map((a) => `<div class="akkoord${a.status !== "open" ? " klaar" : ""}"><p><strong>${esc(a.titel)}</strong></p>${a.uitleg ? `<p class="uitleg">${esc(a.uitleg)}</p>` : ""}
        ${a.status !== "open" ? `<p class="uitleg ok">✓ ${a.status} op ${new Date(a.besloten_op).toLocaleDateString("nl-NL")}</p>`
        : bestuur() ? `<div class="knoppen"><button class="btn" data-actie="akkoord" data-id="${a.id}" data-status="goedgekeurd">Goedkeuren</button><button class="btn ghost" data-actie="akkoord" data-id="${a.id}" data-status="afgewezen">Afwijzen</button></div>` : `<p class="uitleg">Wacht op het bestuur.</p>`}</div>`).join("") || `<p style="color:var(--muted)">Niets open.</p>`}
      ${bestuur() ? `<details class="blok"><summary>Nieuw punt toevoegen</summary><form class="formulier" data-form="akkoord"><label>Wat moet besloten worden?<input name="titel" required placeholder="Factuur schoonmaak betalen: € 75"></label><label>Toelichting<input name="uitleg"></label><button class="btn" type="submit">Toevoegen</button></form></details>` : ""}
    </div>
    <div class="kaart"><h2>Vera controleerde</h2><ul class="punten">${aandachtspunten(c).map(([k, t]) => `<li class="${k}">${t}</li>`).join("")}</ul></div>
  </div>`;
}

function geld(c) {
  const posten = [...new Set(["Voorschot", "Reservefonds", ...c.posten.map((b) => b.post), "Overig"])];
  const kies = (m) => bestuur() ? `<select class="post" data-actie="post" data-id="${m.id}">${posten.map((p) => `<option${p === m.post ? " selected" : ""}>${esc(p)}</option>`).join("")}</select>` : esc(m.post);
  return `<div class="twee">
    <div class="kaart"><h2>Voorschotten ${c.jaar}</h2>
      <p style="margin-top:0;color:var(--muted);font-size:.9rem">Begroting ${eur0(c.vast)} + reservering ${eur0(c.reservering)} = ${eur0(c.totaal)} per jaar, verdeeld naar breukdeel. Verwacht = ${c.maanden} maanden.${bestuur() ? "" : " U ziet alleen uw eigen betalingen; die van anderen ziet alleen het bestuur."}</p>
      <div class="tw"><table class="lijst"><tr><th>${eK()}</th><th class="n">Deel</th><th class="n">Per maand</th><th class="n">Ontvangen</th><th class="n">Verschil</th></tr>
      ${c.perLid.filter((l) => bestuur() || l.appartement === ik()?.appartement).map((l) => `<tr><td>${esc(l.appartement)}</td><td class="n">${nl(l.breukdeel)}/${nl(c.noemer)}</td><td class="n">${eur(l.pm)}</td><td class="n">${eur(l.ontvangen)}</td><td class="n ${l.verschil < -1 ? "let" : "ok"}">${eur(l.verschil)}</td></tr>`).join("")}</table></div></div>
    <div class="kaart"><h2>Begroting ${c.jaar}</h2><div class="tw"><table class="lijst"><tr><th>Post</th><th class="n">Begroot</th><th class="n">Werkelijk</th>${bestuur() ? "<th></th>" : ""}</tr>
      ${c.posten.map((b) => `<tr><td>${esc(b.post)}</td><td class="n">${eur0(b.bedrag)}</td><td class="n">${eur0(c.werkelijk(b.post))}</td>${bestuur() ? `<td><button class="klein-knop" data-actie="weg" data-tabel="begroting" data-id="${b.id}">×</button></td>` : ""}</tr>`).join("")}
      <tr><td>Storting reservefonds (MJOP)</td><td class="n">${eur0(c.reservering)}</td><td class="n">${eur0(c.werkelijk("Reservefonds"))}</td>${bestuur() ? "<td></td>" : ""}</tr>
      <tr><th>Totaal</th><th class="n">${eur0(c.totaal)}</th><th></th>${bestuur() ? "<th></th>" : ""}</tr></table></div>
      ${bestuur() ? `<form class="formulier rij" data-form="post"><label>Post<input name="post" required placeholder="Opstalverzekering"></label><label>Bedrag per jaar<input name="bedrag" required inputmode="decimal"></label><button class="btn" type="submit">Toevoegen</button></form>` : ""}</div>
  </div>
  <div class="kaart" style="margin-top:20px"><h2>Bankmutaties</h2>
    ${bestuur() ? `<details class="blok" ${S.import ? "open" : ""}><summary>Bankafschrift inlezen (CSV)</summary>
      <p style="font-size:.9rem;color:var(--muted)">Download in uw bankapp de transacties als CSV (ING, Rabobank, ABN AMRO, bunq, SNS en Triodos werken meestal). Rekeningnummers worden niet opgeslagen; alleen datum, omschrijving en bedrag.</p>
      <input type="file" accept=".csv,text/csv" data-actie="csv">${S.import ? importVoorbeeld(posten) : ""}</details>
      <details class="blok"><summary>Eén mutatie toevoegen</summary><form class="formulier rij" data-form="mutatie"><label>Datum<input type="date" name="datum" required value="${vandaag()}"></label><label>Omschrijving<input name="oms" required></label><label>Bedrag (af = min)<input name="bedrag" required inputmode="decimal" placeholder="-75,00"></label><label>Post<select name="post">${posten.map((p) => `<option>${esc(p)}</option>`).join("")}</select></label><label>${cap(e1())}<select name="app"><option value="">–</option>${S.leden.map((l) => `<option>${esc(l.appartement)}</option>`).join("")}</select></label><button class="btn" type="submit">Toevoegen</button></form></details>` : ""}
    <div class="tw" style="margin-top:12px"><table class="lijst"><tr><th>Datum</th><th>Omschrijving</th><th>Post</th><th>${eK()}</th><th class="n">Bedrag</th>${bestuur() ? "<th></th>" : ""}</tr>
    ${S.mutaties.filter((m) => bestuur() || !m.appartement || m.appartement === ik()?.appartement).slice(0, 100).map((m) => `<tr><td>${datumNL(m.datum)}</td><td>${esc(m.omschrijving)}</td><td>${kies(m)}</td><td>${esc(m.appartement || "")}</td><td class="n ${m.bedrag > 0 ? "ok" : ""}">${eur(m.bedrag)}</td>${bestuur() ? `<td><button class="klein-knop" data-actie="weg" data-tabel="mutaties" data-id="${m.id}">×</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="6" style="color:var(--muted)">Nog geen mutaties.</td></tr>`}</table></div>
    ${bestuur() ? "" : `<p style="font-size:.85rem;color:var(--muted)">Betalingen van andere eigenaren staan hier niet, wel in de saldi.</p>`}</div>`;
}

function onderhoud(c) {
  const nu = new Date().getFullYear();
  return `<div class="kaart"><h2>Meerjarenonderhoudsplan</h2>
  <p style="margin-top:0;color:var(--muted);font-size:.92rem">Per onderdeel: wanneer het voor het laatst is gedaan, hoe lang het meegaat en wat het kost. Samen ${eur0(c.reservering)} per jaar opzij${c.minimum ? ` (wettelijk minimum zonder MJOP: ${eur0(c.minimum)})` : ""}.</p>
  <div class="tw"><table class="lijst"><tr><th>Onderdeel</th><th class="n">Laatst</th><th class="n">Volgende</th><th class="n">Kosten</th><th class="n">Per jaar</th>${bestuur() ? "<th></th>" : ""}</tr>
  ${[...c.mjop].sort((a, b) => a.volgende - b.volgende).map((m) => `<tr><td>${esc(m.onderdeel)}</td><td class="n">${m.laatst}</td><td class="n ${m.volgende - nu <= 2 ? "let" : ""}">${m.volgende}</td><td class="n">${eur0(m.kosten)}</td><td class="n">${eur0(m.perJaar)}</td>${bestuur() ? `<td><button class="klein-knop" data-actie="weg" data-tabel="mjop" data-id="${m.id}">×</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="6" style="color:var(--muted)">Nog geen onderdelen.</td></tr>`}</table></div>
  ${bestuur() ? `<form class="formulier rij" data-form="mjop"><label>Onderdeel<input name="onderdeel" required placeholder="Schilderwerk buiten"></label><label>Laatst gedaan (jaar)<input name="laatst" required inputmode="numeric"></label><label>Gaat mee (jaar)<input name="duur" required inputmode="numeric"></label><label>Kosten<input name="kosten" required inputmode="decimal"></label><button class="btn" type="submit">Toevoegen</button></form>` : ""}</div>`;
}

function vergadering() {
  return `${S.vergaderingen.map((v) => {
    const stemmingen = S.stemmingen.filter((s) => s.vergadering_id === v.id);
    return `<div class="kaart" style="margin-bottom:20px"><h2>Ledenvergadering ${datumNL(v.datum)} ${v.datum >= vandaag() ? '<span class="label let">gepland</span>' : '<span class="label">geweest</span>'}</h2>
    <ol class="agenda">${v.agenda.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>
    ${stemmingen.map((s) => stemming(s)).join("")}
    ${bestuur() ? `<form class="formulier rij" data-form="stemming" data-id="${v.id}"><label>Nieuw voorstel om over te stemmen<input name="voorstel" required></label><button class="btn ghost" type="submit">Voorstel toevoegen</button></form>
    <form class="formulier" data-form="notities" data-id="${v.id}"><label>Notities / concept-notulen<textarea name="notities">${esc(v.notities)}</textarea></label><button class="btn ghost" type="submit">Notities opslaan</button></form>
    <p><button class="klein-knop" data-actie="weg" data-tabel="vergaderingen" data-id="${v.id}">Vergadering verwijderen</button></p>`
    : v.notities ? `<h3>Notulen</h3><p style="white-space:pre-line">${esc(v.notities)}</p>` : ""}</div>`;
  }).join("") || `<div class="kaart"><p style="color:var(--muted);margin:0">Nog geen vergaderingen.</p></div>`}
  ${bestuur() ? `<div class="kaart" style="margin-top:20px"><h2>Vergadering plannen</h2><form class="formulier" data-form="vergadering"><label>Datum<input type="date" name="datum" required></label><label>Agenda (één punt per regel)<textarea name="agenda">${STANDAARD_AGENDA.join("\n")}</textarea></label><button class="btn" type="submit">Plannen</button></form></div>` : ""}`;
}

function telling(s) {
  let voor = 0, tegen = 0, blanco = 0, aanwezig = 0;
  const noemer = S.leden.reduce((t, l) => t + Number(l.breukdeel), 0);
  for (const l of S.leden) {
    const k = s.stemmen[l.appartement];
    if (!k || k === "afwezig") continue;
    const d = Number(l.breukdeel); aanwezig += d;
    if (k === "voor") voor += d; else if (k === "tegen") tegen += d; else blanco += d;
  }
  const uit = voor + tegen;
  const res = !aanwezig ? "nog geen stemmen" : !uit ? "geen geldige stemmen" : voor > uit / 2 ? "aangenomen" : "verworpen";
  return { voor, tegen, blanco, aanwezig, noemer, res };
}
// Wat Vera naast de stukken uit het portaal meekrijgt: vergaderingen en stemmingen (geen namen of e-mailadressen).
function portaalVoorVera() {
  const r = [`Portaal van ${S.vve.naam}: ${S.leden.length} ${eN()}, totaal breukdelen ${nl(noemer())}, boekjaar ${S.vve.boekjaar}.`];
  for (const v of [...S.vergaderingen].sort((a, b) => a.datum.localeCompare(b.datum))) {
    r.push(`\nVergadering ${v.datum}${v.datum >= vandaag() ? " (gepland)" : ""}. Agenda: ${v.agenda.join("; ") || "-"}.`);
    if (v.notities) r.push(`Notities: ${v.notities.slice(0, 1500)}`);
    for (const st of S.stemmingen.filter((x) => x.vergadering_id === v.id)) {
      const t = telling(st);
      const per = S.leden.map((l) => `${l.appartement}=${st.stemmen[l.appartement] || "geen stem"}`).join(", ");
      r.push(`Stemming "${st.voorstel}": voor ${nl(t.voor)}, tegen ${nl(t.tegen)}, blanco ${nl(t.blanco)}, aanwezig ${nl(t.aanwezig)} van ${nl(t.noemer)} (in breukdelen). Uitslag volgens het portaal (gewone meerderheid): ${t.res}. Per ${e1()}: ${per}.`);
    }
  }
  return r.join("\n").slice(0, 12000);
}
function stemming(s) {
  const { voor, tegen, blanco, aanwezig, noemer, res } = telling(s);
  return `<div class="akkoord"><p><strong>${esc(s.voorstel)}</strong></p>
  ${S.leden.map((l) => `<div class="stem"><strong>${eK()} ${esc(l.appartement)} <span style="font-weight:400;color:var(--muted)">(${nl(l.breukdeel)}/${nl(noemer)})</span></strong><div class="keus">
    ${["voor", "tegen", "blanco", "afwezig"].map((k) => `<button ${bestuur() ? "" : "disabled"} data-actie="stem" data-id="${s.id}" data-app="${esc(l.appartement)}" data-k="${k}" aria-pressed="${s.stemmen[l.appartement] === k}">${k}</button>`).join("")}</div></div>`).join("")}
  <p class="uitslag">Voor ${voor}, tegen ${tegen}, blanco ${blanco} (aanwezig ${aanwezig} van ${noemer}): <span class="${res === "aangenomen" ? "ok" : "let"}">${res}</span></p>
  <p style="font-size:.82rem;color:var(--muted)">Gewone meerderheid van de uitgebrachte stemmen. Welke meerderheid echt nodig is, staat in uw reglement.</p></div>`;
}

function wisverzoekenBestuur() {
  const open = S.wisverzoeken.filter((w) => w.status === "open");
  if (!bestuur() || !open.length) return "";
  return `<div class="kaart" style="margin-bottom:20px;border-left:4px solid #d97706"><h2>Verzoeken om gegevens te wissen (${open.length})</h2>
  <p style="font-size:.9rem;color:var(--muted);margin-top:0">Een eigenaar mag vragen om zijn persoonsgegevens te wissen (AVG). Handel dit binnen een maand af. Wissen haalt naam en e-mail bij het ${e1()} weg en verwijdert het account; breukdeel en boekhouding blijven.</p>
  ${open.map((w) => `<div class="akkoord"><p><strong>${eK()} ${esc(w.appartement)}</strong> · ${new Date(w.aangemaakt).toLocaleDateString("nl-NL")}</p>${w.reden ? `<p class="uitleg">Reden: ${esc(w.reden)}</p>` : ""}
    <div class="knoppen"><button class="btn" data-actie="wis-uitvoeren" data-id="${w.id}">Gegevens wissen</button><button class="btn ghost" data-actie="wis-afwijzen" data-id="${w.id}">Afwijzen</button></div></div>`).join("")}</div>`;
}

function leden() {
  return `${wisverzoekenBestuur()}<div class="kaart"><h2>${cap(eN())} en eigenaren</h2><div class="tw"><table class="lijst"><tr><th>${eK()}</th><th class="n">Breukdeel</th><th>Naam</th>${bestuur() ? "<th>E-mail</th>" : ""}<th>Rol</th><th>Account</th>${bestuur() ? "<th></th>" : ""}</tr>
  ${S.leden.map((l) => `<tr><td>${esc(l.appartement)}</td><td class="n">${nl(l.breukdeel)}/${nl(noemer())}</td><td>${esc(l.naam || "")}</td>${bestuur() ? `<td>${esc(l.email || "")}</td>` : ""}<td>${l.rol}</td><td>${l.user_id ? "ja" : bestuur() && l.email ? `<button class="klein-knop" data-actie="account-maken" data-id="${l.id}">Account maken</button>` : "nee"}</td>${bestuur() && l.user_id !== S.sessie.user.id ? `<td><button class="klein-knop" data-actie="weg" data-tabel="leden" data-id="${l.id}">×</button></td>` : bestuur() ? "<td></td>" : ""}</tr>`).join("")}</table></div>
  ${bestuur() ? `<p style="font-size:.88rem;color:var(--muted)">Zet het e-mailadres van een eigenaar alleen hier als die eigenaar dat goed vindt. Met "Account maken" krijgt de eigenaar een startwachtwoord dat u persoonlijk doorgeeft. Hij of zij kiest bij de eerste keer inloggen een eigen wachtwoord en kan daarna de VvE inzien (niet de betalingen en e-mailadressen van anderen), maar niets wijzigen (behalve met rol "bestuur").</p>
  <p style="font-size:.88rem;color:var(--muted)">Breukdeel: zijn alle ${eN()} gelijk, laat dan overal 1 staan (bij 32 ${eN()} is dat 1/32). Staat in de splitsingsakte bijvoorbeeld 12/1000, vul dan 12 in. Het portaal deelt zelf door het totaal.</p>
  <details class="blok" ${S.leden.length < 3 ? "open" : ""}><summary>Meerdere ${eN()} in één keer toevoegen</summary>
  <form class="formulier rij" data-form="reeks"><label>Van nummer<input name="van" required inputmode="numeric" value="1"></label><label>Tot en met<input name="tot" required inputmode="numeric" placeholder="32"></label><label>Breukdeel per ${e1()}<input name="deel" inputmode="decimal" value="1"></label><button class="btn" type="submit">Toevoegen</button></form>
  <p style="font-size:.85rem;color:var(--muted)">Nummers die al bestaan worden overgeslagen. Namen en e-mailadressen kunt u later invullen.</p></details>
  <h3>Eén ${e1()} toevoegen</h3>
  <form class="formulier rij" data-form="lid"><label>${cap(e1())}<input name="app" required></label><label>Breukdeel<input name="deel" inputmode="decimal" value="1"></label><label>Naam<input name="naam"></label><label>E-mail<input type="email" name="email"></label><label>Rol<select name="rol"><option>eigenaar</option><option>bestuur</option></select></label><button class="btn" type="submit">Toevoegen</button></form>` : ""}</div>`;
}

// Eenvoudige opmaak voor Vera's antwoord: veilig escapen, **vet** en regels.
const opmaak = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

function stukken() {
  const kb = (n) => n > 1048576 ? (n / 1048576).toLocaleString("nl-NL", { maximumFractionDigits: 1 }) + " MB" : Math.round(n / 1024) + " kB";
  const meer = S.stukken.length > 1; // "*" = Vera leest alle stukken tegelijk
  const gekozen = S.veraStuk && (S.veraStuk === "*" ? meer : S.stukken.some((x) => x.pad === S.veraStuk)) ? S.veraStuk : meer ? "*" : S.stukken[0]?.pad;
  const log = S.vera[gekozen] || [];
  return `<div class="twee">
  <div class="kaart"><h2>Stukken van de VvE</h2>
    <p style="margin-top:0;color:var(--muted);font-size:.9rem">Splitsingsakte, reglement, notulen, polissen. Alleen leden van deze VvE kunnen ze openen.</p>
    <div class="tw"><table class="lijst"><tr><th>Stuk</th><th class="n">Grootte</th><th></th></tr>
    ${S.stukken.map((f) => `<tr><td><a href="${esc(f.url || "#")}" target="_blank" rel="noopener">${esc(f.naam)}</a></td><td class="n">${kb(f.grootte)}</td><td>${bestuur() ? `<button class="klein-knop" data-actie="stuk-weg" data-pad="${esc(f.pad)}">×</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="3" style="color:var(--muted)">Nog geen stukken.</td></tr>`}</table></div>
    ${bestuur() ? `<details class="blok" ${S.stukken.length ? "" : "open"}><summary>Stuk uploaden (PDF)</summary>
      <p style="font-size:.88rem;color:var(--muted)">Alleen PDF, tot 20 MB. Upload alleen stukken die alle leden mogen zien.</p>
      <input type="file" accept="application/pdf,.pdf" data-actie="stuk-upload"></details>` : ""}
    ${bestuur() && S.stukken.length ? `<div class="blok" style="margin-top:14px"><strong>Laat Vera de gegevens invullen</strong> <span class="ai-label">AI</span>
      <p style="font-size:.88rem;color:var(--muted);margin:.3em 0 .6em">Vera zoekt in ${S.stukken.length > 25 ? "de nieuwste 25 stukken" : "de stukken"} naar breukdelen, begroting, saldi, herbouwwaarde, vergaderingen en onderhoud. U ziet eerst een voorstel en kiest zelf wat u overneemt.</p>
      <button class="btn ghost" data-actie="invullen"${S.invulBezig ? " disabled" : ""}>${S.invulBezig ? "Vera leest de stukken… (kan een minuut duren)" : "Gegevens laten invullen"}</button></div>` : ""}
  </div>
  <div class="kaart"><h2>Vraag Vera over de stukken <span class="ai-label">AI</span></h2>
    ${S.stukken.length ? `<p style="margin-top:0;color:var(--muted);font-size:.9rem">Vera leest de gekozen stukken en de vergaderingen en stemmingen in het portaal, en noemt waar het antwoord staat. Controleer belangrijke antwoorden altijd in het stuk zelf. De stukken gaan daarvoor naar Anthropic (de maker van Claude).</p>
    <form class="formulier" data-form="vera-stuk"><label>Zoeken in<select name="pad" data-actie="vera-kies">${meer ? `<option value="*"${gekozen === "*" ? " selected" : ""}>${S.stukken.length > 25 ? "De nieuwste 25 stukken" : `Alle stukken (${S.stukken.length})`}</option>` : ""}${S.stukken.map((f) => `<option value="${esc(f.pad)}"${f.pad === gekozen ? " selected" : ""}>${esc(f.naam)}</option>`).join("")}</select></label>
    ${log.map((m) => `<div class="msg ${m.role === "user" ? "ik" : "vera"}" style="margin:0">${m.role === "user" ? esc(m.content) : opmaak(m.content)}</div>`).join("")}
    ${log.length && !S.veraBezig ? `<p style="margin:0"><button class="klein-knop" type="button" data-actie="vera-wis" data-pad="${esc(gekozen)}">Nieuw gesprek</button></p>` : ""}
    ${S.veraBezig ? `<p style="color:var(--muted)">Vera leest ${gekozen === "*" ? "de stukken" : "het stuk"}…</p>` : ""}
    <label>Uw vraag<input name="vraag" required maxlength="600" placeholder="Bijv. wie betaalt onderhoud aan de slagboom?"></label><button class="btn" type="submit"${S.veraBezig ? " disabled" : ""}>Vraag</button></form>`
    : `<p style="color:var(--muted)">Upload eerst een stuk, bijvoorbeeld de splitsingsakte. Daarna kan Vera er vragen over beantwoorden.</p>`}
  </div></div>${S.voorstel && bestuur() ? voorstelScherm(S.voorstel) : ""}`;
}

// ---------- Vera vult in: voorstel uit de stukken, het bestuur kiest wat het overneemt ----------
const appNr = (a) => String(a ?? "").trim().toLowerCase().replace(/^\D+/, "");
const zoekLid = (nummer) => S.leden.find((l) => l.appartement === nummer) || S.leden.find((l) => appNr(l.appartement) === appNr(nummer) && appNr(nummer) !== "");
// Heeft de VvE een onderhoudsplan, dan rekent het portaal de storting in het reservefonds zelf uit; niet dubbel tellen.
const metMjop = (v) => S.mjop.length > 0 || (v.mjop?.onderdelen?.length || 0) > 0;
const begrotingPosten = (v) => (v.begroting?.posten || []).filter((p) => !(metMjop(v) && /reserve/i.test(p.post)));
function voorstelScherm(v) {
  const vink = (naam, aan, tekst) => `<label style="display:flex;gap:.5em;align-items:flex-start;font-weight:600"><input type="checkbox" name="${naam}"${aan ? " checked" : ""} style="width:auto;margin-top:.25em">${tekst}</label>`;
  const bron = (b) => b ? `<p style="font-size:.82rem;color:var(--muted);margin:.2em 0 0 1.6em">Bron: ${esc(b)}</p>` : "";
  const delen = [], a = v.algemeen || {};
  if (a.herbouwwaarde) delen.push(vink("hbw", true, `Herbouwwaarde ${eur0(a.herbouwwaarde)}`) + bron(a.herbouwwaarde_bron));
  if (a.saldo_betaal != null || a.saldo_reserve != null) {
    const jaar = Number(String(a.saldo_datum || "").slice(0, 4)) + 1, past = jaar === S.vve.boekjaar;
    delen.push(vink("saldi", past, `Startsaldi: betaalrekening ${eur(a.saldo_betaal || 0)}, reservefonds ${eur(a.saldo_reserve || 0)}${a.saldo_datum ? ` (stand ${datumNL(a.saldo_datum)})` : ""}`) + bron(a.saldo_bron)
      + (past || !jaar ? "" : `<p style="font-size:.85rem;margin:.2em 0 0 1.6em" class="let">Let op: dit zijn de saldi op 1 januari ${jaar}, uw boekjaar is ${S.vve.boekjaar}.</p>`));
  }
  const b = v.begroting || {}, bj = b.jaar || S.vve.boekjaar, posten = begrotingPosten(v), overgeslagen = (b.posten?.length || 0) - posten.length;
  if (posten.length) delen.push(vink("begroting", true, `Begroting ${bj}: ${posten.length} posten, samen ${eur0(posten.reduce((t, p) => t + p.bedrag, 0))}${S.begroting.some((x) => x.jaar === bj) ? ` <span class="let">(vervangt de huidige begroting ${bj})</span>` : ""}`)
    + `<ul style="margin:.3em 0 0 1.6em;font-size:.9rem">${posten.map((p) => `<li>${esc(p.post)}: ${eur0(p.bedrag)}</li>`).join("")}</ul>`
    + (overgeslagen ? `<p style="font-size:.85rem;margin:.2em 0 0 1.6em;color:var(--muted)">De storting in het reservefonds neemt Vera niet over: die berekent het portaal uit het onderhoudsplan.</p>` : "") + bron(b.bron));
  const e = (v.breukdelen?.eenheden || []).map((x) => ({ ...x, lid: zoekLid(x.nummer) }));
  if (e.length) {
    const gevonden = e.filter((x) => x.lid), anders = gevonden.filter((x) => Number(x.lid.breukdeel) !== x.teller);
    delen.push(vink("breukdelen", anders.length > 0, `Breukdelen: ${e.length} uit de akte${v.breukdelen.noemer ? ` (noemer ${nl(v.breukdelen.noemer)})` : ""}; ${gevonden.length} gevonden in het portaal, waarvan ${anders.length} anders dan nu`)
      + (e.length > gevonden.length ? `<p style="font-size:.85rem;margin:.2em 0 0 1.6em" class="let">Niet in het portaal: ${e.filter((x) => !x.lid).map((x) => esc(x.nummer)).slice(0, 20).join(", ")}. Pas eerst het aantal of de nummers aan bij Instellingen.</p>` : "")
      + (anders.length ? `<p style="font-size:.85rem;margin:.2em 0 0 1.6em">${anders.slice(0, 12).map((x) => `${esc(x.lid.appartement)}: ${nl(x.lid.breukdeel)} → ${nl(x.teller)}`).join(" · ")}${anders.length > 12 ? " …" : ""}</p>` : "") + bron(v.breukdelen.bron));
  }
  (v.vergaderingen || []).forEach((g, i) => {
    const al = S.vergaderingen.some((x) => x.datum === g.datum);
    delen.push(vink("verg_" + i, !al, `Vergadering ${/^\d{4}-\d\d-\d\d$/.test(g.datum) ? datumNL(g.datum) : esc(g.datum)}${al ? ' <span class="let">(staat er al)</span>' : ""}`)
      + `<p style="font-size:.88rem;margin:.2em 0 0 1.6em;white-space:pre-line">${esc(g.samenvatting)}</p>` + bron(g.bron));
  });
  const m = v.mjop?.onderdelen || [];
  if (m.length) delen.push(vink("mjop", S.mjop.length === 0, `Onderhoudsplan: ${m.length} onderdelen toevoegen${S.mjop.length ? ` <span class="let">(er staan er al ${S.mjop.length})</span>` : ""}`)
    + `<ul style="margin:.3em 0 0 1.6em;font-size:.9rem">${m.map((o) => `<li>${esc(o.onderdeel)}: ${eur0(o.kosten)}, laatst ${o.laatst}, elke ${o.levensduur} jaar</li>`).join("")}</ul>` + bron(v.mjop.bron));
  return `<div class="kaart" style="margin-top:20px"><h2>Voorstel van Vera <span class="ai-label">AI</span></h2>
  <p style="margin-top:0;color:var(--muted);font-size:.9rem">Controleer de bedragen met het stuk ernaast. Alleen wat aangevinkt is, wordt opgeslagen.${v.opmerking ? " " + esc(v.opmerking) : ""}</p>
  ${delen.length ? `<form class="formulier" data-form="voorstel">${delen.map((x) => `<div style="padding:.6em 0;border-top:1px solid var(--line, #e5e2da)">${x}</div>`).join("")}
  <p><button class="btn" type="submit">Aangevinkte gegevens overnemen</button> <button class="klein-knop" type="button" data-actie="voorstel-weg">Voorstel sluiten</button></p></form>`
  : `<p>Vera vond in de stukken geen gegevens om in te vullen.</p><p><button class="klein-knop" data-actie="voorstel-weg">Sluiten</button></p>`}</div>`;
}
async function voorstelOvernemen(d) {
  const v = S.voorstel, vve_id = S.vve.id, a = v.algemeen || {}, klaar = [], fouten = [];
  const doe = async (wat, belofte) => { const { error } = await belofte; (error ? fouten : klaar).push(error ? `${wat}: ${error.message}` : wat); };
  const upd = {};
  if (d.hbw) upd.herbouwwaarde = a.herbouwwaarde;
  if (d.saldi) { upd.startsaldo_betaal = a.saldo_betaal || 0; upd.startsaldo_reserve = a.saldo_reserve || 0; }
  if (Object.keys(upd).length) await doe("algemene gegevens", sb.from("vves").update(upd).eq("id", vve_id));
  if (d.begroting) {
    const jaar = v.begroting.jaar || S.vve.boekjaar;
    const weg = await sb.from("begroting").delete().eq("vve_id", vve_id).eq("jaar", jaar);
    if (weg.error) fouten.push("begroting: " + weg.error.message);
    else await doe(`begroting ${jaar}`, sb.from("begroting").insert(begrotingPosten(v).map((p) => ({ vve_id, jaar, post: p.post.slice(0, 80), bedrag: p.bedrag }))));
  }
  if (d.breukdelen) {
    const rijen = v.breukdelen.eenheden.map((x) => ({ x, lid: zoekLid(x.nummer) })).filter((r) => r.lid && r.x.teller > 0 && Number(r.lid.breukdeel) !== r.x.teller);
    const res = await Promise.all(rijen.map((r) => sb.from("leden").update({ breukdeel: r.x.teller }).eq("id", r.lid.id)));
    const fout = res.find((r) => r.error);
    fout ? fouten.push("breukdelen: " + fout.error.message) : klaar.push(`${rijen.length} breukdelen`);
  }
  for (const [i, g] of (v.vergaderingen || []).entries()) if (d["verg_" + i] && /^\d{4}-\d\d-\d\d$/.test(g.datum))
    await doe(`vergadering ${datumNL(g.datum)}`, sb.from("vergaderingen").insert({ vve_id, datum: g.datum, agenda: g.agenda.slice(0, 30), notities: `${g.samenvatting}\n\n(Samenvatting door Vera uit ${g.bron})` }));
  if (d.mjop) await doe("onderhoudsplan", sb.from("mjop").insert(v.mjop.onderdelen.filter((o) => o.levensduur > 0).map((o) => ({ vve_id, onderdeel: o.onderdeel.slice(0, 120), laatst: o.laatst, levensduur: o.levensduur, kosten: o.kosten }))));
  S.voorstel = null;
  await kiesVve(vve_id);
  if (fouten.length) return meld("Niet alles lukte. " + fouten.join("; ") + (klaar.length ? ". Wel opgeslagen: " + klaar.join(", ") + "." : ""), true);
  meld(klaar.length ? "Overgenomen: " + klaar.join(", ") + "." : "Niets aangevinkt, er is niets veranderd.");
}

// ---------- Berichten: leden schrijven het bestuur; een lid ziet alleen zijn eigen berichten ----------
function berichten() {
  const tijd = (t) => new Date(t).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const kaartje = (b, beheer) => `<div class="akkoord" style="margin-bottom:12px"><p style="margin:0 0 .3em"><strong>${esc(b.onderwerp)}</strong>
    <span class="label${b.status === "open" ? " let" : ""}">${b.status === "open" ? (b.antwoord ? "beantwoord" : "nieuw") : "afgehandeld"}</span></p>
    <p style="margin:0;font-size:.85rem;color:var(--muted)">${beheer ? `Van ${b.afzender === "beheer" ? "de beheerder" : `${eK().toLowerCase()} ${esc(b.afzender)}`} · ` : ""}${tijd(b.aangemaakt)}</p>
    <p style="white-space:pre-line;margin:.5em 0">${esc(b.tekst)}</p>
    ${b.vera_antwoord ? `<div class="msg vera" style="margin:0 0 .6em"><strong>${beheer ? "Het lid kreeg dit antwoord van Vera (AI):" : "Eerste antwoord van Vera (AI, niet van het bestuur):"}</strong><br>${esc(b.vera_antwoord)}</div>` : !beheer && S.veraBericht === b.id ? `<p style="margin:0 0 .6em;font-size:.9rem">Vera zoekt een antwoord in de stukken…</p>` : ""}
    ${beheer ? `<form class="formulier" data-form="antwoord" data-id="${b.id}"><label>Antwoord aan het lid<textarea name="antwoord" maxlength="4000">${esc(S.concepten[b.id] ?? b.antwoord)}</textarea></label>
      ${S.concepten[b.id] !== undefined ? `<p style="margin:0;font-size:.85rem;color:var(--muted)">Concept van Vera (AI). Controleer het, pas het aan en kies Opslaan; pas dan ziet het lid het.</p>` : ""}
      <label style="display:flex;gap:.5em;align-items:center"><input type="checkbox" name="klaar" style="width:auto"${b.status === "afgehandeld" ? " checked" : ""}> Afgehandeld</label>
      <p style="margin:0"><button class="btn ghost" type="submit">Opslaan</button> ${S.stukken.length ? `<button class="klein-knop" type="button" data-actie="vera-concept" data-id="${b.id}"${S.conceptBezig ? " disabled" : ""}>${S.conceptBezig === b.id ? "Vera schrijft…" : "Concept door Vera"}</button> ` : ""}<button class="klein-knop" type="button" data-actie="weg" data-tabel="berichten" data-id="${b.id}">Verwijderen</button></p></form>`
    : b.antwoord ? `<div class="msg vera" style="margin:0"><strong>Antwoord van het bestuur${b.beantwoord_op ? ` (${tijd(b.beantwoord_op)})` : ""}:</strong><br>${esc(b.antwoord)}</div>` : `<p style="margin:0;font-size:.85rem;color:var(--muted)">${b.vera_antwoord ? "Het bestuur leest uw bericht ook en vult aan als dat nodig is." : "Nog geen antwoord."}</p>`}</div>`;
  const mijn = S.berichten.filter((b) => b.user_id === S.sessie.user.id);
  const schrijf = `<div class="kaart"><h2>Bericht aan het bestuur</h2>
    <p style="margin-top:0;color:var(--muted);font-size:.9rem">Alleen het bestuur${S.beheer?.length ? " en de beheerder" : ""} van ${esc(S.vve.naam)} leest dit. U ziet hier ook het antwoord.${S.vve.contact_email ? ` Liever mailen? Dat kan naar <a href="mailto:${esc(S.vve.contact_email)}">${esc(S.vve.contact_email)}</a>.` : ""}</p>
    <form class="formulier" data-form="bericht"><label>Onderwerp<input name="onderwerp" required maxlength="120" placeholder="Bijv. lekkage in de berging"></label>
    <label>Bericht<textarea name="tekst" required maxlength="4000"></textarea></label><button class="btn" type="submit">Versturen</button></form>
    ${mijn.length ? `<h3 style="margin-top:20px">Uw berichten</h3>${mijn.map((b) => kaartje(b, false)).join("")}` : ""}</div>`;
  if (!bestuur()) return schrijf;
  const lijst = [...S.berichten].sort((a, b) => (a.status === "open") === (b.status === "open") ? b.aangemaakt.localeCompare(a.aangemaakt) : a.status === "open" ? -1 : 1);
  return `<div class="twee"><div class="kaart"><h2>Berichten van leden (${S.berichten.filter((b) => b.status === "open").length} open)</h2>
    ${lijst.map((b) => kaartje(b, true)).join("") || `<p style="color:var(--muted)">Nog geen berichten. Leden sturen die via deze tab.</p>`}</div>${ik() ? schrijf : ""}</div>`;
}

function instellingen() {
  const v = S.vve;
  return `<div class="kaart"><h2>Instellingen</h2><form class="formulier rij" data-form="instellingen">
  <label>Naam<input name="naam" required value="${esc(v.naam)}"></label>
  <label>Soort<select name="eenheid">${Object.entries(EENHEDEN).map(([k, w]) => `<option value="${k}"${k === (v.eenheid || "appartement") ? " selected" : ""}>${cap(w[1])}</option>`).join("")}</select></label>
  <label>Aantal ${eN()}<input name="aantal" required inputmode="numeric" value="${S.leden.length}"></label>
  <label>Boekjaar<input name="jaar" required inputmode="numeric" value="${v.boekjaar}"></label>
  <label>Herbouwwaarde<input name="hbw" inputmode="decimal" value="${v.herbouwwaarde ?? ""}"></label>
  <label>Saldo betaalrekening 1 januari<input name="sb" inputmode="decimal" value="${v.startsaldo_betaal}"></label>
  <label>Saldo reservefonds 1 januari<input name="sr" inputmode="decimal" value="${v.startsaldo_reserve}"></label>
  <label>E-mailadres voor leden<input type="email" name="mail" value="${esc(v.contact_email || "")}" placeholder="bijv. naamvve@vvekit.nl"></label>
  <button class="btn" type="submit">Opslaan</button></form>
  <p style="font-size:.85rem;color:var(--muted)">Kiest u een adres op @vvekit.nl, dan stuurt het portaal de mail door naar alle bestuursleden die bij ${cap(eN())} aanpassen een e-mailadres hebben. Dat wordt vanzelf bijgewerkt als het bestuur verandert.${(v.contact_email || "").toLowerCase().endsWith("@vvekit.nl") ? ` <button class="linkknop" data-actie="doorsturen">Doorsturen nu bijwerken</button>` : ""}</p></div>
  <div class="kaart" style="margin-top:20px"><h2>${cap(eN())} aanpassen</h2>
  <p style="margin-top:0;color:var(--muted);font-size:.9rem">Pas hier per ${e1()} het nummer, breukdeel, de naam, het e-mailadres en de rol aan, en kies onderaan "Wijzigingen opslaan". Breukdeel: vul de teller in (1, of 12 bij 12/1000); het portaal deelt zelf door het totaal (nu ${nl(noemer())}).</p>
  <p><button class="klein-knop" data-actie="alle-een">Alle breukdelen op 1 zetten</button></p>
  <form data-form="appartementen"><div class="tw"><table class="lijst bewerk"><tr><th>${eK()}</th><th class="n">Breukdeel</th><th>Naam</th><th>E-mail</th><th>Rol</th></tr>
  ${S.leden.map((l) => `<tr><td><input name="app_${l.id}" value="${esc(l.appartement)}" required></td><td><input name="deel_${l.id}" value="${l.breukdeel}" inputmode="decimal" required class="n"></td>
    <td><input name="naam_${l.id}" value="${esc(l.naam || "")}"></td><td><input type="email" name="email_${l.id}" value="${esc(l.email || "")}"></td>
    <td><select name="rol_${l.id}"><option${l.rol === "eigenaar" ? " selected" : ""}>eigenaar</option><option${l.rol === "bestuur" ? " selected" : ""}>bestuur</option></select></td></tr>`).join("")}</table></div>
  <p><button class="btn" type="submit">Wijzigingen opslaan</button></p></form>
  <p style="font-size:.85rem;color:var(--muted)">Heeft een eigenaar al een account, dan verandert een nieuw e-mailadres hier niet zijn inlognaam. ${cap(eN())} verwijderen kan bij Leden (×).</p></div>
  <div class="kaart" style="margin-top:20px"><h2>Veiligheidskopie</h2>
  <p style="margin-top:0;color:var(--muted);font-size:.9rem">Download alle gegevens van ${esc(v.naam)} in één bestand: ${eN()}, geld, begroting, onderhoud, vergaderingen, akkoorden en berichten. Bewaar het op een veilige plek, zoals iCloud Drive of OneDrive. Doe dit bijvoorbeeld elke maand en altijd vóór grote wijzigingen. De PDF-stukken zitten er niet in; bewaar die apart.</p>
  <p><button class="btn" data-actie="kopie-maken">Kopie downloaden</button></p>
  <details${S.terugzet ? " open" : ""}><summary>Kopie terugzetten</summary><p style="color:var(--muted);font-size:.9rem">Kies een eerder gedownloade kopie. Alle gegevens van ${esc(v.naam)} worden dan vervangen door die uit het bestand; wat daarna is ingevoerd verdwijnt. Het portaal downloadt eerst automatisch een kopie van de huidige stand. Accounts van eigenaren blijven bestaan.</p>
  ${S.terugzet ? `<div class="melding"><p style="margin-top:0"><strong>Gekozen kopie:</strong> ${esc(S.terugzet.k.vve.naam)}, stand van ${esc(S.terugzet.wanneer)}, met ${S.terugzet.k.leden.length} ${eN()}, ${S.terugzet.k.mutaties.length} mutaties en ${S.terugzet.k.vergaderingen.length} vergaderingen.</p>
  <p>Stap 1: ${S.terugzet.veilig ? "✓ kopie van de huidige stand gedownload." : `<button class="btn ghost" data-actie="kopie-voor-terug">Kopie van de huidige stand downloaden</button>`}</p>
  <p>Stap 2: <button class="btn" data-actie="kopie-nu-terug"${S.terugzet.veilig ? "" : " disabled"}>Nu terugzetten</button> <button class="klein-knop" data-actie="kopie-terug-stop">Annuleren</button></p></div>`
  : `<label>Kies het kopiebestand (meestal in Bestanden, map Downloads)<input type="file" data-actie="kopie-terug"></label>`}</details></div>`;
}

function teken() {
  if (!sb) { app.innerHTML = `<div class="inlog kaart"><h1 style="font-size:1.5rem;margin-top:0">VvE-portaal</h1><p>Het portaal wordt nog gekoppeld aan de database. Probeer het later opnieuw.</p></div>`; return; }
  wie.innerHTML = S.sessie ? `<button data-tab="account">Mijn account</button><button data-actie="uitloggen">Uitloggen</button>` : "";
  if (!S.sessie) { app.innerHTML = inlogScherm(); return; }
  if (startwachtwoord()) { S.tab = "account"; if (!S.fout && !S.melding) S.melding = "Welkom! Kies eerst een eigen wachtwoord. Het startwachtwoord kent het bestuur ook."; }
  if (S.tab === "account") { app.innerHTML = (S.fout ? `<div class="melding fout">${esc(S.fout)}</div>` : "") + (S.melding ? `<div class="melding">${esc(S.melding)}</div>` : "") + account(); return; }
  if (!S.vve) { app.innerHTML = geenVve(S.beheerder); return; }
  const c = cijfers();
  const scherm = { overzicht, geld, onderhoud, vergadering, stukken, berichten, leden, instellingen }[S.tab] || overzicht;
  app.innerHTML = kop(c) + scherm(c) + `<p class="demo-voet">Testomgeving. Wijzigingen kunnen alleen door het bestuur. Geen juridisch of financieel advies; uw splitsingsakte en reglement zijn leidend. Gemaakt met AI (Claude), een dienst van <a href="https://www.lumensquared.nl/">Lumensquared</a>.</p>` + `<button class="vera-knop" type="button" data-actie="naar-vera" aria-label="Vraag Vera over de stukken en het portaal"><img src="/img/vera.svg" alt=""><span>Vraag het Vera <span class="ai-label">AI</span></span></button>`;
}

// ---------- CSV-import ----------
function leesCsv(tekst) {
  const eerste = tekst.split(/\r?\n/)[0];
  const sep = (eerste.match(/;/g) || []).length > (eerste.match(/,/g) || []).length ? ";" : (eerste.match(/\t/g) || []).length > 1 ? "\t" : ",";
  const rijen = []; let rij = [], veld = "", q = false;
  for (let i = 0; i < tekst.length; i++) {
    const ch = tekst[i];
    if (q) { if (ch === '"' && tekst[i + 1] === '"') { veld += '"'; i++; } else if (ch === '"') q = false; else veld += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { rij.push(veld); veld = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && tekst[i + 1] === "\n") i++; rij.push(veld); veld = ""; if (rij.some((x) => x !== "")) rijen.push(rij); rij = []; }
    else veld += ch;
  }
  rij.push(veld); if (rij.some((x) => x !== "")) rijen.push(rij);
  return rijen;
}
function leesDatum(s) {
  s = s.trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
function raadPost(oms, bedrag, posten) {
  const o = oms.toLowerCase();
  const heeft = (w) => posten.find((p) => p.toLowerCase().includes(w));
  if (/spaar|reserve/.test(o)) return "Reservefonds";
  if (bedrag > 0) return "Voorschot";
  for (const p of posten) if (p.length > 3 && o.includes(p.toLowerCase())) return p;
  const regels = [[/verzeker|polis|achmea|centraal beheer|nn schade|a\.s\.r|interpolis/, "verzeker"], [/schoonma|glazenwas/, "schoonma"], [/eneco|vattenfall|essent|greenchoice|energie|stroom|budget energie/, "energie"], [/kosten|rente|pakket|bank/, "bank"], [/onderhoud|loodgieter|elektric|dak|schilder|installat/, "onderhoud"]];
  for (const [re, w] of regels) if (re.test(o) && heeft(w)) return heeft(w);
  return "Overig";
}
function raadApp(oms) {
  const o = oms.toLowerCase();
  for (const l of S.leden) {
    if (l.naam && l.naam.length > 2 && o.includes(l.naam.toLowerCase())) return l.appartement;
    const re = new RegExp(`\\b(app\\.?|appartement|nr\\.?|huisnummer)\\s*${l.appartement.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(o)) return l.appartement;
  }
  return "";
}
function verwerkCsv(tekst) {
  const rijen = leesCsv(tekst);
  if (rijen.length < 2) return meld("Dit bestand bevat geen transacties.", true);
  const kop = rijen[0].map((h) => h.trim().toLowerCase());
  const zoek = (...w) => kop.findIndex((h) => w.some((x) => h === x)) >= 0 ? kop.findIndex((h) => w.some((x) => h === x)) : kop.findIndex((h) => w.some((x) => h.includes(x)));
  const iDatum = zoek("datum", "date", "boekingsdatum", "transactiedatum");
  const iBedrag = zoek("bedrag (eur)", "bedrag", "amount", "transactiebedrag");
  const iAfBij = kop.findIndex((h) => h === "af bij" || h === "af/bij");
  const iNaam = zoek("naam tegenpartij", "naam / omschrijving", "name", "counterparty", "naam");
  const iOms = zoek("omschrijving-1", "mededelingen", "omschrijving", "description");
  if (iDatum < 0 || iBedrag < 0) return meld("Ik herken de kolommen niet. Stuur het bestand naar alv@vvekit.nl, dan voeg ik deze bank toe.", true);
  const posten = [...new Set([...S.begroting.map((b) => b.post), "Overig"])];
  const bestaand = new Set(S.mutaties.map((m) => `${m.datum}|${Number(m.bedrag).toFixed(2)}|${m.omschrijving}`));
  const regels = [];
  for (const r of rijen.slice(1)) {
    const datum = leesDatum(r[iDatum] || ""); let bedrag = getal(r[iBedrag]);
    if (!datum || !isFinite(bedrag)) continue;
    if (iAfBij >= 0 && /^af/i.test((r[iAfBij] || "").trim())) bedrag = -Math.abs(bedrag);
    const oms = [r[iNaam], iOms !== iNaam ? r[iOms] : ""].filter(Boolean).join(" · ").replace(/\s+/g, " ").trim().slice(0, 200);
    const dubbel = bestaand.has(`${datum}|${bedrag.toFixed(2)}|${oms}`);
    regels.push({ datum, bedrag, omschrijving: oms, post: raadPost(oms, bedrag, posten), appartement: bedrag > 0 ? raadApp(oms) : "", mee: !dubbel, dubbel });
  }
  S.import = regels; S.melding = `${regels.length} transacties gevonden. Controleer de posten en kies "Importeren".`; S.fout = ""; teken();
}
function importVoorbeeld(posten) {
  return `<div class="tw voorbeeld-csv" style="margin-top:10px"><table class="lijst"><tr><th></th><th>Datum</th><th>Omschrijving</th><th>Post</th><th>${eK()}</th><th class="n">Bedrag</th></tr>
  ${S.import.map((r, i) => `<tr><td><input type="checkbox" data-actie="imp-mee" data-i="${i}" ${r.mee ? "checked" : ""}></td><td>${r.datum}</td><td>${esc(r.omschrijving)}${r.dubbel ? ' <span class="label let">al ingelezen</span>' : ""}</td>
  <td><select class="post" data-actie="imp-post" data-i="${i}">${posten.map((p) => `<option${p === r.post ? " selected" : ""}>${esc(p)}</option>`).join("")}</select></td>
  <td><select class="post" data-actie="imp-app" data-i="${i}"><option value="">–</option>${S.leden.map((l) => `<option${l.appartement === r.appartement ? " selected" : ""}>${esc(l.appartement)}</option>`).join("")}</select></td><td class="n">${eur(r.bedrag)}</td></tr>`).join("")}</table></div>
  <p><button class="btn" data-actie="imp-ok">Importeren (${S.import.filter((r) => r.mee).length})</button> <button class="btn ghost" data-actie="imp-stop">Annuleren</button></p>`;
}

// ---------- acties ----------
app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f)), vve_id = S.vve?.id;
  switch (f.dataset.form) {
    case "voorstel": return voorstelOvernemen(d);
    case "bericht": {
      const r = await sb.from("berichten").insert({ vve_id, user_id: S.sessie.user.id, afzender: ik()?.appartement || (beheert() ? "beheer" : ""), onderwerp: d.onderwerp.trim(), tekst: d.tekst.trim() }).select().single();
      await opslaan(Promise.resolve(r), "Uw bericht is verstuurd naar het bestuur.");
      if (r.error || !S.stukken.length) return;
      // Vera geeft meteen een eerste antwoord uit de stukken; het bestuur leest mee en vult aan.
      S.veraBericht = r.data.id; teken();
      try {
        const antwoord = await veraOverBericht(r.data, "Een lid stuurde het bericht hierboven aan het bestuur. Beantwoord het nu direct voor dit lid: kort en vriendelijk, in de u-vorm, op basis van de stukken en de portaalgegevens. Noem het stuk en artikel. Staat het antwoord er niet in, zeg dan kort dat het bestuur erop terugkomt. Beloof niets namens het bestuur. Geen aanhef; sluit af met „Vera (AI-assistent)”, niet namens het bestuur.");
        const { error } = await sb.rpc("vera_antwoord", { b: r.data.id, tekst: antwoord });
        if (error) throw new Error(error.message);
        S.veraBericht = null; await kiesVve(S.vve.id);
        return meld("Uw bericht is verstuurd naar het bestuur. Vera heeft alvast geantwoord.");
      } catch (err) { console.warn("Vera-antwoord:", err.message); S.veraBericht = null; return meld("Uw bericht is verstuurd naar het bestuur. Vera kon nu geen antwoord geven; het bestuur antwoordt zelf."); }
    }
    case "antwoord": return opslaan(sb.from("berichten").update({ antwoord: (d.antwoord || "").trim(), status: d.klaar ? "afgehandeld" : "open", beantwoord_op: (d.antwoord || "").trim() ? new Date().toISOString() : null }).eq("id", f.dataset.id), "Opgeslagen.");
    case "inloggen": {
      const { error } = await sb.auth.signInWithPassword({ email: d.email.trim(), password: d.ww });
      if (error) return meld(/invalid/i.test(error.message) ? "E-mailadres of wachtwoord klopt niet. Nog geen wachtwoord? Log dan in met een e-maillink en stel daarna een wachtwoord in." : "Inloggen lukte niet: " + error.message, true);
      S.melding = S.fout = ""; return;
    }
    case "wachtwoord": {
      if (d.ww !== d.ww2) return meld("De twee wachtwoorden zijn niet gelijk.", true);
      const { data, error } = await sb.auth.updateUser({ password: d.ww, data: { startwachtwoord: null } });
      if (error) return meld(/same|different/i.test(error.message) ? "Kies een ander wachtwoord dan het startwachtwoord." : "Opslaan lukte niet: " + error.message, true);
      if (data?.user) S.sessie.user = data.user;
      return meld("Wachtwoord opgeslagen. Voortaan logt u in met uw e-mailadres en dit wachtwoord.");
    }
    case "wisverzoek": {
      const l = S.leden.find((x) => x.id === f.dataset.lid);
      return opslaan(sb.from("wisverzoeken").insert({ vve_id: l.vve_id, lid_id: l.id, user_id: S.sessie.user.id, appartement: l.appartement, reden: (d.reden || "").trim() }), "Uw verzoek is ingediend. Het bestuur handelt het af.");
    }
    case "vera-stuk": {
      const pad = d.pad, vraag = (d.vraag || "").trim();
      if (!vraag) return;
      S.veraStuk = pad;
      const log = (S.vera[pad] = S.vera[pad] || []);
      log.push({ role: "user", content: vraag });
      S.veraBezig = true; S.fout = ""; S.melding = ""; teken();
      try {
        const { data: { session } } = await sb.auth.getSession(); // vers token, ook na een uur open laten staan
        const r = await fetch(VERA_API + "/stuk", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
          body: JSON.stringify({ ...(pad === "*" ? { paden: S.stukken.slice(0, 25).map((f) => f.pad) } : { pad }), messages: log.slice(-8), vve: S.vve.naam, eenheid: eN(), portaal: portaalVoorVera() }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.answer) throw new Error(j.error || "Vera kon geen antwoord geven.");
        log.push({ role: "assistant", content: j.answer });
      } catch (err) { log.pop(); S.fout = err.message === "Failed to fetch" ? "Vera is nu niet bereikbaar." : err.message; }
      S.veraBezig = false; return teken();
    }
    case "inloglink": {
      const { error } = await sb.auth.signInWithOtp({ email: d.email.trim(), options: { emailRedirectTo: location.origin + "/portaal/" } });
      return error ? meld(/rate limit/i.test(error.message) ? "Er zijn net te veel inloglinks verstuurd. Probeer het over een uur opnieuw, of gebruik de laatste link die u al kreeg (als u die nog niet gebruikt heeft)." : "Versturen lukte niet: " + error.message, true) : meld(`Er is een inloglink gestuurd naar ${d.email}. Open die mail op dit apparaat. Geen mail? Kijk ook in uw spam.`);
    }
    case "nieuwe-vve": {
      const eigen = !!d.eigen;
      const { data: id, error } = await sb.rpc("maak_vve", { p_naam: d.naam, p_appartement: eigen ? d.app.trim() : "", p_breukdeel: eigen ? deel(d.deel) : 1 });
      if (error) return meld(error.message, true);
      S.nieuweVve = false; S.eigenEenheid = false;
      await laadVves(); await kiesVve(id); S.tab = "instellingen";
      return meld(`VvE "${d.naam}" aangemaakt. Kies hier de soort en het aantal eenheden; daarna kunt u bij Stukken de akte uploaden en Vera de gegevens laten invullen.`);
    }
    case "lid": return opslaan(sb.from("leden").insert({ vve_id, appartement: d.app.trim(), breukdeel: deel(d.deel), naam: d.naam || null, email: d.email?.trim() || null, rol: d.rol }), `${cap(e1())} toegevoegd.`, d.rol === "bestuur");
    case "appartementen": {
      const wijzig = [];
      for (const l of S.leden) {
        const n = { appartement: (d["app_" + l.id] || "").trim(), breukdeel: deel(d["deel_" + l.id]), naam: (d["naam_" + l.id] || "").trim() || null, email: (d["email_" + l.id] || "").trim() || null, rol: d["rol_" + l.id] };
        if (!n.appartement) return meld(`Elk ${e1()} heeft een nummer of naam nodig.`, true);
        if (!(n.breukdeel > 0)) return meld(`Breukdeel bij ${eK().toLowerCase()} ${n.appartement} moet groter dan 0 zijn.`, true);
        if (n.appartement !== l.appartement || n.breukdeel !== Number(l.breukdeel) || n.naam !== l.naam || n.email !== l.email || n.rol !== l.rol) wijzig.push([l, n]);
      }
      const nummers = S.leden.map((l) => (d["app_" + l.id] || "").trim());
      if (new Set(nummers).size !== nummers.length) return meld(`Twee ${eN()} hebben hetzelfde nummer.`, true);
      const blijftBestuur = beheert() || S.leden.some((l) => l.user_id && d["rol_" + l.id] === "bestuur");
      if (!blijftBestuur) return meld("Er moet minstens één bestuurslid met een account overblijven.", true);
      if (!wijzig.length) return meld("Er was niets gewijzigd.");
      // Eerst tijdelijke nummers, zodat omwisselen (bijv. 1 en 2) niet botst op de unieke nummering.
      const hernoem = wijzig.filter(([l, n]) => n.appartement !== l.appartement);
      for (const [l] of hernoem) { const { error } = await sb.from("leden").update({ appartement: "~" + l.id }).eq("id", l.id); if (error) return meld("Opslaan lukte niet: " + error.message, true); }
      const fouten = (await Promise.all(wijzig.map(([l, n]) => sb.from("leden").update(n).eq("id", l.id)))).filter((r) => r.error);
      if (fouten.length) { await kiesVve(S.vve.id); return meld("Niet alles is opgeslagen: " + fouten[0].error.message, true); }
      const bestuurAnders = wijzig.some(([l, n]) => (l.rol === "bestuur" || n.rol === "bestuur") && (n.rol !== l.rol || n.email !== l.email));
      return opslaan(Promise.resolve({}), `${wijzig.length} ${wijzig.length === 1 ? e1() : eN()} aangepast.`, bestuurAnders);
    }
    case "reeks": {
      const van = parseInt(d.van), tot = parseInt(d.tot), bd = deel(d.deel);
      if (!(van >= 0 && tot >= van && tot - van < 500)) return meld("Vul een geldige reeks in, bijvoorbeeld van 1 tot en met 32.", true);
      if (!(bd > 0)) return meld("Het breukdeel moet groter dan 0 zijn.", true);
      const bestaand = new Set(S.leden.map((l) => l.appartement));
      const rijen = [];
      for (let n = van; n <= tot; n++) if (!bestaand.has(String(n))) rijen.push({ vve_id, appartement: String(n), breukdeel: bd });
      if (!rijen.length) return meld(`Al deze ${eN()} bestaan al.`);
      return opslaan(sb.from("leden").insert(rijen), `${rijen.length} ${eN()} toegevoegd.`);
    }
    case "post": return opslaan(sb.from("begroting").insert({ vve_id, jaar: S.vve.boekjaar, post: d.post.trim(), bedrag: getal(d.bedrag) }), "Post toegevoegd.");
    case "mutatie": return opslaan(sb.from("mutaties").insert({ vve_id, datum: d.datum, omschrijving: d.oms, bedrag: getal(d.bedrag), post: d.post, appartement: d.app || null }), "Mutatie toegevoegd.");
    case "mjop": return opslaan(sb.from("mjop").insert({ vve_id, onderdeel: d.onderdeel, laatst: parseInt(d.laatst), levensduur: parseInt(d.duur), kosten: getal(d.kosten) }), "Onderdeel toegevoegd.");
    case "vergadering": return opslaan(sb.from("vergaderingen").insert({ vve_id, datum: d.datum, agenda: d.agenda.split("\n").map((s) => s.trim()).filter(Boolean) }), "Vergadering gepland.");
    case "stemming": return opslaan(sb.from("stemmingen").insert({ vve_id, vergadering_id: f.dataset.id, voorstel: d.voorstel }), "Voorstel toegevoegd.");
    case "notities": return opslaan(sb.from("vergaderingen").update({ notities: d.notities }).eq("id", f.dataset.id), "Notities opgeslagen.");
    case "akkoord": return opslaan(sb.from("akkoorden").insert({ vve_id, titel: d.titel, uitleg: d.uitleg || "" }), "Punt toegevoegd.");
    case "instellingen": {
      const aantal = parseInt(d.aantal);
      if (!(aantal >= 1 && aantal <= 500)) return meld("Vul een aantal tussen 1 en 500 in.", true);
      const verschil = aantal - S.leden.length;
      if (verschil > 0) {
        const bestaand = new Set(S.leden.map((l) => l.appartement)); const rijen = [];
        for (let n = 1; rijen.length < verschil; n++) if (!bestaand.has(String(n))) rijen.push({ vve_id, appartement: String(n), breukdeel: 1 });
        const { error } = await sb.from("leden").insert(rijen);
        if (error) return meld("Toevoegen lukte niet: " + error.message, true);
      } else if (verschil < 0) {
        const weg = S.leden.filter((l) => !l.user_id && !l.email && !l.naam && /^\d+$/.test(l.appartement))
          .sort((a, b) => Number(b.appartement) - Number(a.appartement)).slice(0, -verschil);
        if (weg.length < -verschil) return meld(`Er zijn niet genoeg lege genummerde ${eN()} om weg te halen. Verwijder ze zelf bij Leden (×).`, true);
        if (!confirm(`Deze ${eN()} worden verwijderd: ${weg.map((l) => l.appartement).join(", ")}. Doorgaan?`)) return;
        const { error } = await sb.from("leden").delete().in("id", weg.map((l) => l.id));
        if (error) return meld("Verwijderen lukte niet: " + error.message, true);
      }
      return opslaan(sb.from("vves").update({ eenheid: d.eenheid, naam: d.naam, boekjaar: parseInt(d.jaar), herbouwwaarde: d.hbw ? getal(d.hbw) : null, startsaldo_betaal: getal(d.sb) || 0, startsaldo_reserve: getal(d.sr) || 0, contact_email: (d.mail || "").trim().toLowerCase() || null }).eq("id", vve_id), "Instellingen opgeslagen.", (d.mail || "").trim().toLowerCase() !== (S.vve.contact_email || ""));
    }
  }
});

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tab],[data-actie]");
  if (!t || !(app.contains(t) || wie.contains(t))) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.melding = S.fout = ""; return teken(); }
  const a = t.dataset.actie;
  if (a === "uitloggen") { await sb.auth.signOut(); return; }
  if (a === "alle-een") {
    if (!confirm(`Alle ${S.leden.length} ${eN()} krijgen breukdeel 1 (ieder 1/${S.leden.length}). Doorgaan?`)) return;
    return opslaan(sb.from("leden").update({ breukdeel: 1 }).eq("vve_id", S.vve.id), "Alle breukdelen staan op 1.");
  }
  if (a === "kopie-maken") {
    meld("Kopie maken…");
    try { const k = await kopieDownloaden(); meld(`Kopie gedownload: ${k.leden.length} ${eN()}, ${k.mutaties.length} mutaties en ${k.vergaderingen.length} vergaderingen. Bewaar het bestand op een veilige plek.`); }
    catch (err) { meld("Kopie maken lukte niet: " + err.message, true); }
    return;
  }
  if (a === "kopie-voor-terug") {
    try { await kopieDownloaden("-voor-terugzetten"); S.terugzet.veilig = true; meld("Kopie van de huidige stand gedownload. U kunt nu terugzetten."); }
    catch (err) { meld("Kopie maken lukte niet: " + err.message, true); }
    return;
  }
  if (a === "kopie-nu-terug") return kopieTerugzetten();
  if (a === "kopie-terug-stop") { S.terugzet = null; return meld(""); }
  if (a === "nieuwe-vve-open") { S.nieuweVve = true; S.eigenEenheid = false; return teken(); }
  if (a === "nieuwe-vve-dicht") { S.nieuweVve = false; return teken(); }
  if (a === "naar-vera") {
    S.tab = "stukken"; S.melding = S.fout = ""; teken();
    const v = app.querySelector("form[data-form=vera-stuk] [name=vraag]");
    if (v) { v.scrollIntoView({ block: "center", behavior: "smooth" }); v.focus({ preventScroll: true }); }
    return;
  }
  if (a === "vera-concept") {
    // Vera schrijft uit de stukken een concept-antwoord; het bestuur controleert en slaat het zelf op.
    const b = S.berichten.find((x) => x.id === t.dataset.id);
    if (!b || S.conceptBezig) return;
    S.conceptBezig = b.id; S.fout = ""; S.melding = ""; teken();
    try {
      S.concepten[b.id] = await veraOverBericht(b, "Schrijf een concept-antwoord namens het bestuur op het bericht van het lid hierboven. Kort en vriendelijk, in de u-vorm. Noem het stuk en artikel waarop je je baseert. Staat het antwoord niet in de stukken, schrijf dan dat het bestuur erop terugkomt. Geef alleen de tekst van het antwoord.");
    } catch (err) { S.fout = err.message === "Failed to fetch" ? "Vera is nu niet bereikbaar." : err.message; }
    S.conceptBezig = null; return teken();
  }
  if (a === "vera-wis") { delete S.vera[t.dataset.pad]; return teken(); }
  if (a === "voorstel-weg") { S.voorstel = null; return teken(); }
  if (a === "invullen") {
    S.invulBezig = true; S.voorstel = null; S.fout = S.melding = ""; teken();
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(VERA_API + "/invullen", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ paden: S.stukken.slice(0, 25).map((f) => f.pad), vve: S.vve.naam, eenheid: eN() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.voorstel) throw new Error(j.error || "Vera kon de stukken niet invullen.");
      S.voorstel = j.voorstel;
    } catch (err) { S.fout = err.message === "Failed to fetch" ? "Vera is nu niet bereikbaar." : err.message; }
    S.invulBezig = false; return teken();
  }
  if (a === "stuk-weg") {
    if (!confirm("Dit stuk verwijderen? Dit kan niet ongedaan worden.")) return;
    const { error } = await sb.storage.from("stukken").remove([t.dataset.pad]);
    if (error) return meld("Verwijderen lukte niet: " + error.message, true);
    await laadStukken(); return meld("Stuk verwijderd.");
  }
  if (a === "wis-intrekken") return opslaan(sb.from("wisverzoeken").delete().eq("id", t.dataset.id), "Verzoek ingetrokken.");
  if (a === "wis-uitvoeren") {
    if (!confirm(`Naam en e-mail bij dit ${e1()} wissen en het account verwijderen? Dit kan niet ongedaan worden.`)) return;
    return opslaan(sb.rpc("voer_wisverzoek_uit", { p_verzoek: t.dataset.id }), "Gegevens gewist en account verwijderd.");
  }
  if (a === "wis-afwijzen") {
    const notitie = prompt("Waarom wijst u het verzoek af? De eigenaar ziet deze uitleg.");
    if (notitie === null) return;
    return opslaan(sb.from("wisverzoeken").update({ status: "afgewezen", notitie, besloten_op: new Date().toISOString() }).eq("id", t.dataset.id), "Verzoek afgewezen.");
  }
  if (a === "account-maken") {
    const l = S.leden.find((x) => x.id === t.dataset.id);
    const tekens = "abcdefghjkmnpqrstuvwxyz23456789";
    const r = crypto.getRandomValues(new Uint32Array(10));
    const ww = Array.from(r, (n, i) => tekens[n % tekens.length] + (i === 4 ? "-" : "")).join("");
    if (!confirm(`Account maken voor ${eK().toLowerCase()} ${l.appartement} (${l.email})?`)) return;
    const { error } = await sb.rpc("maak_account", { p_lid: l.id, p_wachtwoord: ww });
    if (error) return meld(error.message, true);
    await kiesVve(S.vve.id);
    return meld(`Account gemaakt voor ${eK().toLowerCase()} ${l.appartement}. Inloggen met ${l.email} en startwachtwoord: ${ww}. Geef dit persoonlijk door (niet per mail). Bij de eerste keer inloggen kiest de eigenaar zelf een nieuw wachtwoord.`);
  }
  if (a === "inlogmodus") { S.inlogModus = t.dataset.modus; S.melding = S.fout = ""; return teken(); }
  if (a === "kies-vve") { S.voorstel = null; S.nieuweVve = false; S.melding = S.fout = ""; await kiesVve(t.dataset.id); return teken(); }
  if (a === "weg" && confirm("Weet u het zeker? Dit kan niet ongedaan worden.")) return opslaan(sb.from(t.dataset.tabel).delete().eq("id", t.dataset.id), "Verwijderd.", t.dataset.tabel === "leden" && S.leden.find((l) => l.id === t.dataset.id)?.rol === "bestuur");
  if (a === "doorsturen") { const m = await doorsturen(); return m && meld(m.tekst, !!m.fout); }
  if (a === "akkoord") return opslaan(sb.from("akkoorden").update({ status: t.dataset.status, besloten_door: S.sessie.user.id, besloten_op: new Date().toISOString() }).eq("id", t.dataset.id), "Besluit vastgelegd.");
  if (a === "stem" && bestuur()) {
    return opslaan(sb.rpc("stem", { p_id: t.dataset.id, p_app: t.dataset.app, p_keus: t.dataset.k }), "Stem vastgelegd.");
  }
  if (a === "imp-stop") { S.import = null; S.melding = ""; return teken(); }
  if (a === "imp-ok") {
    const rijen = S.import.filter((r) => r.mee).map(({ datum, bedrag, omschrijving, post, appartement }) => ({ vve_id: S.vve.id, datum, bedrag, omschrijving, post, appartement: appartement || null }));
    S.import = null;
    return opslaan(sb.from("mutaties").insert(rijen), `${rijen.length} mutaties ingelezen.`);
  }
});

app.addEventListener("change", (e) => {
  const t = e.target, a = t.dataset.actie;
  if (a === "vera-kies") { S.veraStuk = t.value; return teken(); }
  if (a === "eigen-eenheid") { S.eigenEenheid = t.checked; const naam = t.form.naam.value; teken(); const f = app.querySelector("form[data-form=nieuwe-vve]"); if (f) f.naam.value = naam; return; }
  if (a === "post") opslaan(sb.from("mutaties").update({ post: t.value }).eq("id", t.dataset.id), "Post aangepast.");
  if (a === "stuk-upload" && t.files[0]) {
    const f = t.files[0];
    if (f.size > 20 * 1048576) return meld("Dit bestand is groter dan 20 MB.", true);
    const naam = f.name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/^-+/, "") || "stuk.pdf";
    meld("Uploaden…");
    sb.storage.from("stukken").upload(`${S.vve.id}/${naam}`, f, { contentType: "application/pdf", upsert: false }).then(async ({ error }) => {
      if (error) return meld(/exists|duplicate/i.test(error.message) ? "Er staat al een stuk met deze naam." : "Uploaden lukte niet: " + error.message, true);
      await laadStukken(); meld(`"${naam}" is geüpload.`);
    });
  }
  if (a === "csv" && t.files[0]) t.files[0].text().then(verwerkCsv);
  if (a === "kopie-terug" && t.files[0]) { const f = t.files[0]; t.value = ""; kopieKiezen(f).catch((err) => meld("Het bestand lezen lukte niet: " + err.message, true)); }
  if (a === "imp-mee") { S.import[t.dataset.i].mee = t.checked; teken(); }
  if (a === "imp-post") S.import[t.dataset.i].post = t.value;
  if (a === "imp-app") S.import[t.dataset.i].appartement = t.value;
});

// ---------- start ----------
async function start(sessie) {
  S.voorkeur = S.vve?.id; S.sessie = sessie; S.vve = null; S.vves = [];
  if (sessie) {
    try {
      await laadVves();
      const { data } = await sb.rpc("ben_beheerder"); S.beheerder = !!data;
    } catch (err) { S.fout = "Laden lukte niet: " + err.message; }
  }
  teken();
}
if (sb) {
  const hashFout = new URLSearchParams(location.hash.slice(1)).get("error_description");
  if (hashFout) S.fout = "Inloggen lukte niet: " + hashFout + ". Vraag een nieuwe link aan.";
  if (/access_token|type=magiclink/.test(location.hash)) { S.tab = "account"; S.melding = "U bent ingelogd. Stel hieronder een wachtwoord in, dan heeft u de volgende keer geen e-maillink meer nodig."; }
  sb.auth.onAuthStateChange((event, sessie) => {
    if (event === "SIGNED_OUT") { S.tab = "overzicht"; S.melding = "U bent uitgelogd. Uw gegevens blijven bewaard."; S.fout = ""; }
    // Safari meldt SIGNED_IN opnieuw als u terugkomt in het tabblad (bijv. na het kiezen van een bestand). Dan niets herladen,
    // anders verdwijnt wat u op het scherm aan het doen was.
    if (event === "SIGNED_IN" && S.sessie && sessie?.user?.id === S.sessie.user.id) { S.sessie = sessie; return; }
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => start(sessie), 0);
  });
} else teken();
