// Demo-portaal VvE Lindehof. Alle gegevens zijn verzonnen; er wordt niets opgeslagen of verstuurd.
const eur = (n) => "€ " + n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = (n) => "€ " + Math.round(n).toLocaleString("nl-NL");

const VVE = {
  apps: [
    { nr: 1, deel: 28 },
    { nr: 2, deel: 24 },
    { nr: 3, deel: 24 },
    { nr: 4, deel: 24 },
  ],
  begroting: [
    ["Opstalverzekering", 1150],
    ["Schoonmaak trappenhuis", 900],
    ["Klein onderhoud", 450],
    ["AI-beheer (Lumensquared)", 400],
    ["Energie trappenhuis", 180],
    ["Bankkosten", 120],
  ],
  mjop: [
    // onderdeel, laatst gedaan, levensduur (jaar), kosten
    ["Schilderwerk buiten", 2021, 6, 8500],
    ["Kozijnen en ramen", 1996, 35, 22000],
    ["Dakbedekking", 2006, 25, 14000],
    ["Trappenhuis schilderen", 2020, 10, 3200],
    ["Voegwerk gevel", 1999, 35, 6000],
    ["Intercom en deurbel", 2014, 15, 1800],
  ],
  saldo: 1842.15,
  reservefonds: 17830,
  kleinOnderhoudUit: 240,
};

const HUIDIG_JAAR = 2026;
const mjop = VVE.mjop.map(([naam, laatst, duur, kosten]) => ({ naam, laatst, duur, kosten, volgende: laatst + duur, perJaar: kosten / duur }));
const reservering = mjop.reduce((s, m) => s + m.perJaar, 0);
const vast = VVE.begroting.reduce((s, [, b]) => s + b, 0);
const totaal = vast + reservering;
const voorschot = (deel) => (totaal * deel) / 100 / 12;
const STATUS = { 1: "betaald 1 okt", 2: "betaald 2 okt", 3: "open", 4: "betaald 1 okt" };

const AKKOORD = [
  { id: "a1", titel: `Factuur schoonmaak oktober betalen: ${eur(75)}`, uitleg: "Zelfde bedrag als het contract en de vorige maanden. Past in de begroting.", ja: "Goedkeuren", nee: "Afwijzen" },
  { id: "a2", titel: `Dakgoten laten reinigen: ${eur(385)}`, uitleg: `Goedkoopste van 2 offertes. Het budget klein onderhoud heeft nog ${eur(450 - VVE.kleinOnderhoudUit)}, dus dit valt ${eur(385 - 450 + VVE.kleinOnderhoudUit)} hoger uit. Vera raadt aan het voor de winter te doen.`, ja: "Akkoord", nee: "Naar de ALV" },
  { id: "a3", titel: `Tweede herinnering sturen aan app. 3 (${eur(voorschot(24))})`, uitleg: "Het voorschot van oktober staat nog open. De eerste herinnering ging op 8 oktober.", ja: "Versturen", nee: "Nog niet" },
];
const besluit = {};

const FEED = [
  ["vandaag 07:00", "6 nieuwe bankmutaties ingelezen en ingedeeld in de begroting."],
  ["8 okt", "Vriendelijke herinnering gestuurd aan app. 3 over het voorschot van oktober."],
  ["5 okt", "Twee offertes voor het reinigen van de dakgoten opgevraagd. De goedkoopste ligt bij het bestuur."],
  ["1 okt", `Maandelijkse storting van ${eur(reservering / 12)} naar het reservefonds klaargezet; het bestuur keurde goed.`],
  ["20 sep", "Opstalpolis verlengd. Premie 4% hoger; de begroting voor 2027 is aangepast."],
];

const MUTATIES = [
  ["8 okt", "Schoonmaakbedrijf", "Schoonmaak", -75],
  ["2 okt", "Eigenaar app. 2", "Voorschot", voorschot(24)],
  ["1 okt", "Eigenaar app. 1", "Voorschot", voorschot(28)],
  ["1 okt", "Eigenaar app. 4", "Voorschot", voorschot(24)],
  ["1 okt", "Spaarrekening VvE", "Reservefonds", -reservering / 12],
  ["28 sep", "Energieleverancier", "Energie", -15],
  ["15 sep", "Elektricien (trapverlichting)", "Klein onderhoud", -95],
];

const STUKKEN = [
  ["📜", "Splitsingsakte (1998)", "4 appartementen. Breukdelen 28, 24, 24 en 24 honderdste. Elk appartement heeft stemmen gelijk aan zijn breukdeel. Uitnodiging ALV minimaal 15 dagen vooraf."],
  ["🛡️", "Opstalpolis 2026", `Herbouwwaarde ${eur0(720000)}. Premie ${eur0(1150)} per jaar. Eigen risico ${eur0(250)} bij stormschade.`],
  ["📝", "Notulen ALV 2026", "Jaarrekening 2025 vastgesteld, decharge verleend. Besloten: schilderwerk buiten plannen voor 2027."],
  ["📊", "Jaarrekening 2025", "Uitgaven 3% onder begroting. Reservefonds groeide naar € 15.150 eind 2025."],
  ["📄", "Offertes dakgoten (2)", "€ 385 en € 460, allebei inclusief afvoer. Vera vergeleek ze: zelfde werk, de eerste is goedkoper."],
];

const STEMMEN = {}; // app -> voor | tegen | blanco | afwezig

function overzicht() {
  const open = AKKOORD.filter((a) => !besluit[a.id]).length;
  return `
  <div class="raster">
    <div class="tegel"><div class="lab">Betaalrekening</div><div class="getal">${eur(VVE.saldo)}</div><div class="klein ok">Bijgewerkt vandaag 07:00</div></div>
    <div class="tegel"><div class="lab">Reservefonds</div><div class="getal">${eur0(VVE.reservefonds)}</div><div class="klein">Storting ${eur0(reservering)} per jaar volgens het MJOP</div></div>
    <div class="tegel"><div class="lab">Voorschotten oktober</div><div class="getal">3 van 4</div><div class="klein let">App. 3 staat nog open</div></div>
    <div class="tegel"><div class="lab">Volgende ledenvergadering</div><div class="getal">18 mrt</div><div class="klein">Concept-agenda staat klaar</div></div>
  </div>
  <div class="twee">
    <div class="kaart"><h2>Wacht op het bestuur (${open})</h2>
      ${AKKOORD.map((a) => `
        <div class="akkoord${besluit[a.id] ? " klaar" : ""}">
          <p><strong>${a.titel}</strong></p><p class="uitleg">${a.uitleg}</p>
          ${besluit[a.id] ? `<p class="uitleg ok">✓ ${besluit[a.id]} (demo: er gebeurt niets echt)</p>`
          : `<div class="knoppen"><button class="btn" data-akkoord="${a.id}" data-keus="${a.ja}">${a.ja}</button><button class="btn ghost" data-akkoord="${a.id}" data-keus="${a.nee}">${a.nee}</button></div>`}
        </div>`).join("")}
    </div>
    <div class="kaart"><h2>Wat Vera deed</h2><ul class="feed">${FEED.map(([t, x]) => `<li><time>${t}</time><span>${x}</span></li>`).join("")}</ul></div>
  </div>`;
}

function geld() {
  return `
  <div class="twee">
    <div class="kaart"><h2>Voorschotten 2026</h2>
      <p class="uitleg" style="margin-top:0;color:var(--muted);font-size:.9rem">Begroting ${eur0(vast)} + reservering ${eur0(reservering)} = ${eur0(totaal)} per jaar, verdeeld naar breukdeel.</p>
      <div class="tw"><table class="lijst"><tr><th>App.</th><th class="n">Breukdeel</th><th class="n">Per maand</th><th>Oktober</th></tr>
      ${VVE.apps.map((a) => `<tr><td>${a.nr}</td><td class="n">${a.deel}/100</td><td class="n">${eur(voorschot(a.deel))}</td><td><span class="label${STATUS[a.nr] === "open" ? " let" : ""}">${STATUS[a.nr]}</span></td></tr>`).join("")}
      </table></div></div>
    <div class="kaart"><h2>Begroting 2026</h2><div class="tw"><table class="lijst">
      ${VVE.begroting.map(([n, b]) => `<tr><td>${n}</td><td class="n">${eur0(b)}</td></tr>`).join("")}
      <tr><td>Storting reservefonds (MJOP)</td><td class="n">${eur0(reservering)}</td></tr>
      <tr><th>Totaal</th><th class="n">${eur0(totaal)}</th></tr></table></div>
      <p style="font-size:.9rem;color:var(--muted)">Klein onderhoud: ${eur0(VVE.kleinOnderhoudUit)} van ${eur0(450)} gebruikt.</p>
      <div class="balk"><i style="width:${(VVE.kleinOnderhoudUit / 450) * 100}%"></i></div></div>
  </div>
  <div class="kaart" style="margin-top:20px"><h2>Laatste bankmutaties <span class="label">automatisch ingedeeld</span></h2><div class="tw"><table class="lijst">
    <tr><th>Datum</th><th>Omschrijving</th><th>Post</th><th class="n">Bedrag</th></tr>
    ${MUTATIES.map(([d, o, p, b]) => `<tr><td>${d}</td><td>${o}</td><td>${p}</td><td class="n ${b > 0 ? "ok" : ""}">${b > 0 ? "+" : "−"}${eur(Math.abs(b)).slice(2)}</td></tr>`).join("")}
  </table></div></div>`;
}

function onderhoud() {
  const max = Math.max(...mjop.map((m) => m.volgende)) - HUIDIG_JAAR;
  return `
  <div class="kaart"><h2>Meerjarenonderhoudsplan</h2>
  <p style="margin-top:0;color:var(--muted);font-size:.92rem">Vera rekent per onderdeel uit wat er jaarlijks opzij moet. Samen is dat ${eur0(reservering)} per jaar. Met ${eur0(VVE.reservefonds)} in kas is het schilderwerk van 2027 gedekt.</p>
  <div class="tw"><table class="lijst tijdlijn"><tr><th>Onderdeel</th><th class="n">Volgende keer</th><th class="n">Kosten</th><th class="n">Per jaar</th><th>Tijd tot uitvoering</th></tr>
  ${mjop.sort((a, b) => a.volgende - b.volgende).map((m) => {
    const jaren = m.volgende - HUIDIG_JAAR;
    return `<tr><td>${m.naam}</td><td class="n ${jaren <= 2 ? "let" : ""}">${m.volgende}</td><td class="n">${eur0(m.kosten)}</td><td class="n">${eur0(m.perJaar)}</td><td><div class="balk"><i style="width:${Math.max(4, (jaren / max) * 100)}%;${jaren <= 2 ? "background:var(--warm)" : ""}"></i></div></td></tr>`;
  }).join("")}</table></div></div>`;
}

function vergadering() {
  const agenda = ["Opening en vaststellen agenda", "Notulen ALV 2026", "Jaarrekening 2026 en decharge bestuur", "Begroting 2027 en voorschotten", "Voorstel: schilderwerk buiten in 2027 uit het reservefonds (€ 8.500)", "Benoeming bestuur en kascommissie", "Rondvraag en sluiting"];
  return `
  <div class="twee">
    <div class="kaart"><h2>ALV 18 maart 2027 <span class="label let">concept</span></h2>
      <ol class="agenda">${agenda.map((a) => `<li>${a}</li>`).join("")}</ol>
      <p style="font-size:.9rem;color:var(--muted)">Vera verstuurt de uitnodiging met de stukken op 1 maart, na akkoord van het bestuur. Dat is ruim boven de 15 dagen uit de splitsingsakte.</p></div>
    <div class="kaart"><h2>Stemmen tellen</h2>
      <p style="margin-top:0;font-size:.92rem;color:var(--muted)">Voorstel 5: schilderwerk buiten. Tik per appartement wat er gestemd wordt. Stemmen tellen naar breukdeel.</p>
      ${VVE.apps.map((a) => `<div class="stem"><strong>App. ${a.nr} <span style="font-weight:400;color:var(--muted)">(${a.deel})</span></strong><div class="keus">
        ${["voor", "tegen", "blanco", "afwezig"].map((k) => `<button data-stem="${a.nr}" data-k="${k}" aria-pressed="${STEMMEN[a.nr] === k}">${k}</button>`).join("")}</div></div>`).join("")}
      <div class="uitslag" id="uitslag">${uitslag()}</div>
      <p style="font-size:.82rem;color:var(--muted)">Demo: gewone meerderheid van de uitgebrachte stemmen. Welke meerderheid echt nodig is, staat in het reglement.</p></div>
  </div>`;
}

function uitslag() {
  let voor = 0, tegen = 0, blanco = 0, aanwezig = 0;
  for (const a of VVE.apps) {
    const k = STEMMEN[a.nr];
    if (!k || k === "afwezig") continue;
    aanwezig += a.deel;
    if (k === "voor") voor += a.deel; else if (k === "tegen") tegen += a.deel; else blanco += a.deel;
  }
  if (!aanwezig) return "Nog geen stemmen.";
  const uit = voor + tegen;
  const res = uit === 0 ? "geen geldige stemmen" : voor > uit / 2 ? "aangenomen" : "verworpen";
  return `Voor ${voor}, tegen ${tegen}, blanco ${blanco} (aanwezig ${aanwezig} van 100): <span class="${res === "aangenomen" ? "ok" : "let"}">${res}</span>. Vera zet dit zo in de notulen.`;
}

function stukken() {
  return `<div class="kaart"><h2>Stukken van de VvE</h2><p style="margin-top:0;color:var(--muted);font-size:.92rem">Vera leest elk document en zet de kern erbij, zodat niemand de akte hoeft door te spitten.</p>
  ${STUKKEN.map(([i, t, s]) => `<div class="doc"><span class="ico" aria-hidden="true">${i}</span><div><strong>${t}</strong><p>${s}</p></div></div>`).join("")}</div>`;
}

const TABS = { overzicht, geld, onderhoud, vergadering, stukken };
let tab = "overzicht";
const inhoud = document.getElementById("inhoud");
function teken() { inhoud.innerHTML = TABS[tab](); }

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
  teken();
});
inhoud.addEventListener("click", (e) => {
  const a = e.target.closest("[data-akkoord]");
  if (a) { besluit[a.dataset.akkoord] = a.dataset.keus; teken(); return; }
  const s = e.target.closest("[data-stem]");
  if (s) { STEMMEN[s.dataset.stem] = s.dataset.k; teken(); }
});
teken();
