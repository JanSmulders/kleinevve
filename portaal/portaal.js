// VvE-portaal (testomgeving). Inloggen per e-mail via Supabase; de database bepaalt met
// row level security wie wat mag zien en wijzigen. Deze code berekent alleen en toont.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";

const SUPABASE_URL = "https://nevkccqxidibpthxowyh.supabase.co";
const SUPABASE_KEY = "sb_publishable_vP7uUh1wM9WoTkShwNsEWg_8ikU4UlC"; // publishable key: mag openbaar, de database-regels beschermen de gegevens

const app = document.getElementById("app");
const wie = document.getElementById("wie");
const sb = SUPABASE_URL ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ---------- hulpjes ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => "€ " + Number(n || 0).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = (n) => "€ " + Math.round(Number(n || 0)).toLocaleString("nl-NL");
const getal = (s) => {
  let t = String(s ?? "").trim().replace(/\s|€/g, "");
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "");
  return Number(t.replace(",", "."));
};
const datumNL = (d) => new Date(d + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
const vandaag = () => new Date().toISOString().slice(0, 10);
const STANDAARD_AGENDA = ["Opening en vaststellen agenda", "Notulen vorige vergadering", "Jaarrekening en decharge bestuur", "Begroting en voorschotten", "Reservefonds en MJOP", "Besluiten over onderhoud", "Benoeming bestuur en kascommissie", "Rondvraag en sluiting"];

// ---------- toestand ----------
const S = { sessie: null, vves: [], vve: null, leden: [], begroting: [], mutaties: [], mjop: [], vergaderingen: [], stemmingen: [], akkoorden: [], tab: "overzicht", melding: "", fout: "", import: null, inlogModus: "wachtwoord" };
const ik = () => S.leden.find((l) => l.user_id === S.sessie?.user?.id);
const bestuur = () => ik()?.rol === "bestuur";

function meld(tekst, fout = false) { S.melding = fout ? "" : tekst; S.fout = fout ? tekst : ""; teken(); }

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
  return { jaar, mjop, reservering, minimum, posten, vast, totaal, noemer, muts, saldo, reserve, maanden, perLid, werkelijk };
}

function aandachtspunten(c) {
  const p = [];
  for (const l of c.perLid) if (c.maanden && l.verschil < -1) p.push(["let", `App. ${esc(l.appartement)} loopt ${eur(-l.verschil)} achter met voorschotten.`]);
  for (const m of c.mjop) if (m.volgende - new Date().getFullYear() <= 2) p.push(["let", `${esc(m.onderdeel)} is aan de beurt in ${m.volgende} (${eur0(m.kosten)}).`]);
  if (!S.mjop.length && c.minimum) p.push(["let", `Er is nog geen MJOP. Dan is het wettelijk minimum voor het reservefonds 0,5% van de herbouwwaarde: ${eur0(c.minimum)} per jaar.`]);
  if (!S.mjop.length && !c.minimum) p.push(["let", "Vul de herbouwwaarde in (Instellingen) of maak een MJOP (Onderhoud), dan reken ik de reservering uit."]);
  for (const b of c.posten) { const w = c.werkelijk(b.post); if (w > Number(b.bedrag) && Number(b.bedrag) > 0) p.push(["let", `${esc(b.post)}: ${eur0(w)} uitgegeven, begroot ${eur0(b.bedrag)}.`]); }
  const ditJaar = S.vergaderingen.some((v) => v.datum.startsWith(String(c.jaar)) || v.datum.startsWith(String(c.jaar + 1)));
  if (!ditJaar) p.push(["let", "Er staat nog geen ledenvergadering gepland. Een VvE moet minstens één keer per jaar vergaderen."]);
  if (!S.leden.some((l) => l.email)) p.push(["let", "Nog geen e-mailadressen bij de appartementen: eigenaren kunnen dan nog niet inloggen."]);
  if (!p.length) p.push(["ok", "Alles op orde: geen achterstanden, geen onderhoud binnen 2 jaar, vergadering gepland."]);
  return p;
}

// ---------- gegevens ----------
async function laadVves() {
  await sb.rpc("koppel_mij");
  const { data, error } = await sb.from("vves").select("*").order("naam");
  if (error) throw error;
  S.vves = data;
  if (!S.vve && data.length) await kiesVve(data[0].id);
}
async function kiesVve(id) {
  const q = (t) => sb.from(t).select("*").eq("vve_id", id);
  const [vve, leden, begroting, mutaties, mjop, vergaderingen, stemmingen, akkoorden] = await Promise.all([
    sb.from("vves").select("*").eq("id", id).single(), q("leden").order("appartement"), q("begroting").order("post"),
    q("mutaties").order("datum", { ascending: false }), q("mjop").order("laatst"), q("vergaderingen").order("datum", { ascending: false }),
    q("stemmingen"), q("akkoorden").order("aangemaakt", { ascending: false }),
  ]);
  for (const r of [vve, leden, begroting, mutaties, mjop, vergaderingen, stemmingen, akkoorden]) if (r.error) throw r.error;
  Object.assign(S, { vve: vve.data, leden: leden.data, begroting: begroting.data, mutaties: mutaties.data, mjop: mjop.data, vergaderingen: vergaderingen.data, stemmingen: stemmingen.data, akkoorden: akkoorden.data });
}
async function opslaan(belofte, ok) {
  const { error } = await belofte;
  if (error) return meld("Dat lukte niet: " + error.message, true);
  await kiesVve(S.vve.id);
  meld(ok || "Opgeslagen.");
}

// ---------- schermen ----------
function inlogScherm() {
  const link = S.inlogModus === "link";
  return `<div class="inlog kaart"><h1 style="font-size:1.6rem;margin-top:0">VvE-portaal</h1>
  ${S.fout ? `<div class="melding fout">${esc(S.fout)}</div>` : ""}${S.melding ? `<div class="melding">${esc(S.melding)}</div>` : ""}
  ${link ? `<p>Vul uw e-mailadres in. U krijgt een e-mail met een inloglink. Daarna kunt u onder <strong>Mijn account</strong> een wachtwoord instellen, zodat u de volgende keer geen mail meer nodig heeft.</p>
  <form class="formulier" data-form="inloglink"><label>E-mailadres<input type="email" name="email" required autocomplete="email"></label><button class="btn" type="submit">Stuur inloglink</button></form>
  <p><button class="linkknop" data-actie="inlogmodus" data-modus="wachtwoord">Terug naar inloggen met wachtwoord</button></p>`
  : `<p>Log in met het e-mailadres dat bij uw appartement staat en uw wachtwoord.</p>
  <form class="formulier" data-form="inloggen"><label>E-mailadres<input type="email" name="email" required autocomplete="username"></label>
  <label>Wachtwoord<input type="password" name="ww" required autocomplete="current-password"></label><button class="btn" type="submit">Inloggen</button></form>
  <p><button class="linkknop" data-actie="inlogmodus" data-modus="link">Wachtwoord vergeten of nog geen wachtwoord? Log in met een e-maillink</button></p>`}
  <p style="font-size:.85rem;color:var(--muted)">Testomgeving. Gemaakt door AI (Claude) als experiment, beheerd door Lumensquared.</p></div>`;
}

function account() {
  return `<div class="kaart inlog" style="margin:0 auto"><h2 style="margin-top:0">Mijn account</h2>
  <p style="color:var(--muted)">Ingelogd als ${esc(S.sessie.user.email)}. Met een wachtwoord logt u voortaan in zonder e-maillink.</p>
  <form class="formulier" data-form="wachtwoord"><label>Nieuw wachtwoord (minstens 8 tekens)<input type="password" name="ww" required minlength="8" autocomplete="new-password"></label>
  <label>Nog een keer<input type="password" name="ww2" required minlength="8" autocomplete="new-password"></label><button class="btn" type="submit">Wachtwoord opslaan</button></form>
  ${S.vve ? `<p><button class="linkknop" data-tab="overzicht">Terug naar het portaal</button></p>` : `<p><button class="linkknop" data-tab="overzicht">Terug</button></p>`}</div>`;
}

function geenVve(beheerder) {
  return `<div class="inlog kaart"><h1 style="font-size:1.5rem;margin-top:0">Welkom</h1>
  ${S.fout ? `<div class="melding fout">${esc(S.fout)}</div>` : ""}
  ${beheerder ? `<p>U heeft nog geen VvE. Maak er een aan; u wordt dan bestuurder van uw eigen appartement.</p>
  <form class="formulier" data-form="nieuwe-vve"><label>Naam van de VvE<input name="naam" required placeholder="VvE Voorbeeldstraat 12"></label>
  <label>Uw appartement<input name="app" required placeholder="bijv. 1 of 12-A"></label>
  <label>Breukdeel van uw appartement<input name="deel" required inputmode="decimal" placeholder="bijv. 25 (van 100)"></label>
  <button class="btn" type="submit">VvE aanmaken</button></form>`
  : `<p>Uw e-mailadres (${esc(S.sessie.user.email)}) staat nog bij geen enkele VvE. Vraag het bestuur van uw VvE om uw e-mailadres bij uw appartement te zetten, en log daarna opnieuw in.</p>`}</div>`;
}

function kop(c) {
  return `<section class="kop"><div><p class="pill">VvE-portaal${bestuur() ? " · bestuur" : ""}</p><h1>${esc(S.vve.naam)}</h1>
  <p class="sub">${S.leden.length} appartementen · boekjaar ${c.jaar} · u bent app. ${esc(ik()?.appartement)}</p>
  ${S.vves.length > 1 ? `<div class="vve-kies">${S.vves.map((v) => `<button class="chip" data-actie="kies-vve" data-id="${v.id}">${esc(v.naam)}</button>`).join("")}</div>` : ""}</div>
  <div class="kop-vera"><img src="/img/vera.svg" alt="" width="44" height="44"><div><strong>Vera <span class="ai-label">AI</span></strong><span>Controleert de cijfers bij elk bezoek.</span></div></div></section>
  <nav class="tabs" role="tablist">${["overzicht", "geld", "onderhoud", "vergadering", "leden", ...(bestuur() ? ["instellingen"] : [])].map((t) => `<button role="tab" data-tab="${t}" aria-selected="${S.tab === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</nav>
  ${S.fout ? `<div class="melding fout">${esc(S.fout)}</div>` : ""}${S.melding ? `<div class="melding">${esc(S.melding)}</div>` : ""}`;
}

function overzicht(c) {
  const open = S.akkoorden.filter((a) => a.status === "open");
  const betaald = c.perLid.filter((l) => l.dezeMaand >= l.pm - 0.01 && l.pm > 0).length;
  const volgende = S.vergaderingen.filter((v) => v.datum >= vandaag()).sort((a, b) => a.datum.localeCompare(b.datum))[0];
  return `<div class="raster">
    <div class="tegel"><div class="lab">Betaalrekening</div><div class="getal">${eur(c.saldo)}</div><div class="klein">Startsaldo + ${c.muts.length} mutaties in ${c.jaar}</div></div>
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
      <p style="margin-top:0;color:var(--muted);font-size:.9rem">Begroting ${eur0(c.vast)} + reservering ${eur0(c.reservering)} = ${eur0(c.totaal)} per jaar, verdeeld naar breukdeel. Verwacht = ${c.maanden} maanden.</p>
      <div class="tw"><table class="lijst"><tr><th>App.</th><th class="n">Deel</th><th class="n">Per maand</th><th class="n">Ontvangen</th><th class="n">Verschil</th></tr>
      ${c.perLid.map((l) => `<tr><td>${esc(l.appartement)}</td><td class="n">${l.breukdeel}/${c.noemer}</td><td class="n">${eur(l.pm)}</td><td class="n">${eur(l.ontvangen)}</td><td class="n ${l.verschil < -1 ? "let" : "ok"}">${eur(l.verschil)}</td></tr>`).join("")}</table></div></div>
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
      <details class="blok"><summary>Eén mutatie toevoegen</summary><form class="formulier rij" data-form="mutatie"><label>Datum<input type="date" name="datum" required value="${vandaag()}"></label><label>Omschrijving<input name="oms" required></label><label>Bedrag (af = min)<input name="bedrag" required inputmode="decimal" placeholder="-75,00"></label><label>Post<select name="post">${posten.map((p) => `<option>${esc(p)}</option>`).join("")}</select></label><label>Appartement<select name="app"><option value="">–</option>${S.leden.map((l) => `<option>${esc(l.appartement)}</option>`).join("")}</select></label><button class="btn" type="submit">Toevoegen</button></form></details>` : ""}
    <div class="tw" style="margin-top:12px"><table class="lijst"><tr><th>Datum</th><th>Omschrijving</th><th>Post</th><th>App.</th><th class="n">Bedrag</th>${bestuur() ? "<th></th>" : ""}</tr>
    ${S.mutaties.slice(0, 100).map((m) => `<tr><td>${datumNL(m.datum)}</td><td>${esc(m.omschrijving)}</td><td>${kies(m)}</td><td>${esc(m.appartement || "")}</td><td class="n ${m.bedrag > 0 ? "ok" : ""}">${eur(m.bedrag)}</td>${bestuur() ? `<td><button class="klein-knop" data-actie="weg" data-tabel="mutaties" data-id="${m.id}">×</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="6" style="color:var(--muted)">Nog geen mutaties.</td></tr>`}</table></div></div>`;
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

function stemming(s) {
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
  return `<div class="akkoord"><p><strong>${esc(s.voorstel)}</strong></p>
  ${S.leden.map((l) => `<div class="stem"><strong>App. ${esc(l.appartement)} <span style="font-weight:400;color:var(--muted)">(${l.breukdeel})</span></strong><div class="keus">
    ${["voor", "tegen", "blanco", "afwezig"].map((k) => `<button ${bestuur() ? "" : "disabled"} data-actie="stem" data-id="${s.id}" data-app="${esc(l.appartement)}" data-k="${k}" aria-pressed="${s.stemmen[l.appartement] === k}">${k}</button>`).join("")}</div></div>`).join("")}
  <p class="uitslag">Voor ${voor}, tegen ${tegen}, blanco ${blanco} (aanwezig ${aanwezig} van ${noemer}): <span class="${res === "aangenomen" ? "ok" : "let"}">${res}</span></p>
  <p style="font-size:.82rem;color:var(--muted)">Gewone meerderheid van de uitgebrachte stemmen. Welke meerderheid echt nodig is, staat in uw reglement.</p></div>`;
}

function leden() {
  return `<div class="kaart"><h2>Appartementen en eigenaren</h2><div class="tw"><table class="lijst"><tr><th>App.</th><th class="n">Breukdeel</th><th>Naam</th><th>E-mail</th><th>Rol</th><th>Ingelogd</th>${bestuur() ? "<th></th>" : ""}</tr>
  ${S.leden.map((l) => `<tr><td>${esc(l.appartement)}</td><td class="n">${l.breukdeel}</td><td>${esc(l.naam || "")}</td><td>${esc(l.email || "")}</td><td>${l.rol}</td><td>${l.user_id ? "ja" : "nee"}</td>${bestuur() && l.user_id !== S.sessie.user.id ? `<td><button class="klein-knop" data-actie="weg" data-tabel="leden" data-id="${l.id}">×</button></td>` : bestuur() ? "<td></td>" : ""}</tr>`).join("")}</table></div>
  ${bestuur() ? `<p style="font-size:.88rem;color:var(--muted)">Zet het e-mailadres van een eigenaar alleen hier als die eigenaar dat goed vindt. Met dat adres kan hij of zij inloggen en alles van de VvE inzien, maar niets wijzigen (behalve als rol "bestuur").</p>
  <form class="formulier rij" data-form="lid"><label>Appartement<input name="app" required></label><label>Breukdeel<input name="deel" required inputmode="decimal"></label><label>Naam<input name="naam"></label><label>E-mail<input type="email" name="email"></label><label>Rol<select name="rol"><option>eigenaar</option><option>bestuur</option></select></label><button class="btn" type="submit">Toevoegen</button></form>` : ""}</div>`;
}

function instellingen() {
  const v = S.vve;
  return `<div class="kaart"><h2>Instellingen</h2><form class="formulier rij" data-form="instellingen">
  <label>Naam<input name="naam" required value="${esc(v.naam)}"></label>
  <label>Boekjaar<input name="jaar" required inputmode="numeric" value="${v.boekjaar}"></label>
  <label>Herbouwwaarde<input name="hbw" inputmode="decimal" value="${v.herbouwwaarde ?? ""}"></label>
  <label>Saldo betaalrekening 1 januari<input name="sb" inputmode="decimal" value="${v.startsaldo_betaal}"></label>
  <label>Saldo reservefonds 1 januari<input name="sr" inputmode="decimal" value="${v.startsaldo_reserve}"></label>
  <button class="btn" type="submit">Opslaan</button></form></div>`;
}

function teken() {
  if (!sb) { app.innerHTML = `<div class="inlog kaart"><h1 style="font-size:1.5rem;margin-top:0">VvE-portaal</h1><p>Het portaal wordt nog gekoppeld aan de database. Probeer het later opnieuw.</p></div>`; return; }
  wie.innerHTML = S.sessie ? `<button data-tab="account">Mijn account</button><button data-actie="uitloggen">Uitloggen</button>` : "";
  if (!S.sessie) { app.innerHTML = inlogScherm(); return; }
  if (S.tab === "account") { app.innerHTML = (S.fout ? `<div class="melding fout">${esc(S.fout)}</div>` : "") + (S.melding ? `<div class="melding">${esc(S.melding)}</div>` : "") + account(); return; }
  if (!S.vve) { app.innerHTML = geenVve(S.beheerder); return; }
  const c = cijfers();
  const scherm = { overzicht, geld, onderhoud, vergadering, leden, instellingen }[S.tab] || overzicht;
  app.innerHTML = kop(c) + scherm(c) + `<p class="demo-voet">Testomgeving. Wijzigingen kunnen alleen door het bestuur. Geen juridisch of financieel advies; uw splitsingsakte en reglement zijn leidend. Gemaakt door AI (Claude) als experiment, beheerd door <a href="https://www.lumensquared.nl/">Lumensquared</a>.</p>`;
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
  return `<div class="tw voorbeeld-csv" style="margin-top:10px"><table class="lijst"><tr><th></th><th>Datum</th><th>Omschrijving</th><th>Post</th><th>App.</th><th class="n">Bedrag</th></tr>
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
    case "inloggen": {
      const { error } = await sb.auth.signInWithPassword({ email: d.email.trim(), password: d.ww });
      if (error) return meld(/invalid/i.test(error.message) ? "E-mailadres of wachtwoord klopt niet. Nog geen wachtwoord? Log dan in met een e-maillink en stel daarna een wachtwoord in." : "Inloggen lukte niet: " + error.message, true);
      S.melding = S.fout = ""; return;
    }
    case "wachtwoord": {
      if (d.ww !== d.ww2) return meld("De twee wachtwoorden zijn niet gelijk.", true);
      const { error } = await sb.auth.updateUser({ password: d.ww });
      return error ? meld("Opslaan lukte niet: " + error.message, true) : meld("Wachtwoord opgeslagen. Voortaan logt u in met uw e-mailadres en dit wachtwoord.");
    }
    case "inloglink": {
      const { error } = await sb.auth.signInWithOtp({ email: d.email.trim(), options: { emailRedirectTo: location.origin + "/portaal/" } });
      return error ? meld(/rate limit/i.test(error.message) ? "Er zijn net te veel inloglinks verstuurd. Probeer het over een uur opnieuw, of gebruik de laatste link die u al kreeg (als u die nog niet gebruikt heeft)." : "Versturen lukte niet: " + error.message, true) : meld(`Er is een inloglink gestuurd naar ${d.email}. Open die mail op dit apparaat. Geen mail? Kijk ook in uw spam.`);
    }
    case "nieuwe-vve": {
      const { error } = await sb.rpc("maak_vve", { p_naam: d.naam, p_appartement: d.app.trim(), p_breukdeel: getal(d.deel) });
      if (error) return meld(error.message, true);
      await laadVves(); S.tab = "leden"; return meld("VvE aangemaakt. Voeg nu de andere appartementen toe.");
    }
    case "lid": return opslaan(sb.from("leden").insert({ vve_id, appartement: d.app.trim(), breukdeel: getal(d.deel), naam: d.naam || null, email: d.email?.trim() || null, rol: d.rol }), "Appartement toegevoegd.");
    case "post": return opslaan(sb.from("begroting").insert({ vve_id, jaar: S.vve.boekjaar, post: d.post.trim(), bedrag: getal(d.bedrag) }), "Post toegevoegd.");
    case "mutatie": return opslaan(sb.from("mutaties").insert({ vve_id, datum: d.datum, omschrijving: d.oms, bedrag: getal(d.bedrag), post: d.post, appartement: d.app || null }), "Mutatie toegevoegd.");
    case "mjop": return opslaan(sb.from("mjop").insert({ vve_id, onderdeel: d.onderdeel, laatst: parseInt(d.laatst), levensduur: parseInt(d.duur), kosten: getal(d.kosten) }), "Onderdeel toegevoegd.");
    case "vergadering": return opslaan(sb.from("vergaderingen").insert({ vve_id, datum: d.datum, agenda: d.agenda.split("\n").map((s) => s.trim()).filter(Boolean) }), "Vergadering gepland.");
    case "stemming": return opslaan(sb.from("stemmingen").insert({ vve_id, vergadering_id: f.dataset.id, voorstel: d.voorstel }), "Voorstel toegevoegd.");
    case "notities": return opslaan(sb.from("vergaderingen").update({ notities: d.notities }).eq("id", f.dataset.id), "Notities opgeslagen.");
    case "akkoord": return opslaan(sb.from("akkoorden").insert({ vve_id, titel: d.titel, uitleg: d.uitleg || "" }), "Punt toegevoegd.");
    case "instellingen": return opslaan(sb.from("vves").update({ naam: d.naam, boekjaar: parseInt(d.jaar), herbouwwaarde: d.hbw ? getal(d.hbw) : null, startsaldo_betaal: getal(d.sb) || 0, startsaldo_reserve: getal(d.sr) || 0 }).eq("id", vve_id), "Instellingen opgeslagen.");
  }
});

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tab],[data-actie]");
  if (!t || !(app.contains(t) || wie.contains(t))) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.melding = S.fout = ""; return teken(); }
  const a = t.dataset.actie;
  if (a === "uitloggen") { await sb.auth.signOut(); return; }
  if (a === "inlogmodus") { S.inlogModus = t.dataset.modus; S.melding = S.fout = ""; return teken(); }
  if (a === "kies-vve") { await kiesVve(t.dataset.id); return teken(); }
  if (a === "weg" && confirm("Weet u het zeker? Dit kan niet ongedaan worden.")) return opslaan(sb.from(t.dataset.tabel).delete().eq("id", t.dataset.id), "Verwijderd.");
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
  if (a === "post") opslaan(sb.from("mutaties").update({ post: t.value }).eq("id", t.dataset.id), "Post aangepast.");
  if (a === "csv" && t.files[0]) t.files[0].text().then(verwerkCsv);
  if (a === "imp-mee") { S.import[t.dataset.i].mee = t.checked; teken(); }
  if (a === "imp-post") S.import[t.dataset.i].post = t.value;
  if (a === "imp-app") S.import[t.dataset.i].appartement = t.value;
});

// ---------- start ----------
async function start(sessie) {
  S.sessie = sessie; S.vve = null; S.vves = [];
  if (sessie) {
    try {
      await laadVves();
      if (!S.vve) { const { data } = await sb.rpc("ben_beheerder"); S.beheerder = !!data; }
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
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => start(sessie), 0);
  });
} else teken();
