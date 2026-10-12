// Vera, de AI-assistent van vvekit.nl.
// Staat VERA_API leeg, dan antwoordt Vera met vaste antwoorden uit deze file (er gaat niets het internet op).
// Staat er het adres van de Cloudflare Worker, dan antwoordt Claude, met de vaste antwoorden als reserve.
const VERA_API = "https://kleinevve.jansmulders1966.workers.dev";

// Testomgeving (test.vvekit.nl of een Cloudflare-voorbeeld): duidelijke balk bovenaan.
if (!/^(www\.)?vvekit\.nl$/.test(location.hostname)) {
  const b = document.createElement("div");
  b.textContent = "TESTOMGEVING · niet de echte site · ga naar vvekit.nl";
  b.style.cssText = "background:#f2b84b;color:#3a2a00;text-align:center;font:600 14px system-ui,sans-serif;padding:6px 12px";
  b.onclick = () => { location.href = "https://vvekit.nl" + location.pathname; };
  document.body.prepend(b);
}

(() => {
  const AVATAR = "/img/vera.svg";
  const GROET = "Hallo, ik ben Vera, de AI-assistent van vvekit.nl. Ik help met vragen over kleine VvE's: reservefonds, voorschotten, de ledenvergadering en wat een VvE moet regelen. Waar kan ik mee helpen?";
  const SUGGESTIES = [
    "Hoeveel moeten we reserveren?",
    "Hoe bereken ik het voorschot?",
    "Onze VvE doet niets. Waar beginnen we?",
    "Wat zit er in de VvE-kit?",
  ];

  // Vaste antwoorden: trefwoorden (stukjes van woorden) en een antwoord.
  const VAST = [
    { w: ["reserv", "spar", "0,5", "0.5", "mjop", "onderhoudsplan", "groot onderhoud", "dak"], a: "Sinds 2018 moet elke VvE jaarlijks sparen voor groot onderhoud. Heeft u een meerjarenonderhoudsplan (MJOP), dan reserveert u minimaal wat daaruit volgt. Zonder MJOP is het minimum **0,5% van de herbouwwaarde per jaar**. Bij een herbouwwaarde van €600.000 is dat €3.000 per jaar, met 4 gelijke appartementen €62,50 per maand per appartement.\n\nMeer uitleg en een tabel: [Reservefonds](reservefonds.html). In de [VvE-kit](vve-kit.html) rekent een eenvoudig MJOP het voor u uit." },
    { w: ["voorschot", "bijdrage", "maandbedrag", "per maand", "breukdeel", "verdeel", "betalen we"], a: "Het voorschot per maand is: **(begroting + reservering) × breukdeel ÷ 12**. Het breukdeel staat in de splitsingsakte en is niet altijd gelijk.\n\nVoorbeeld: begroting €1.800 plus €2.400 reservering is €4.200 per jaar. Een appartement met 40/100 betaalt dan €140 per maand, een appartement met 30/100 €105.\n\nStap voor stap: [Voorschot berekenen](voorschot-berekenen.html). De [VvE-kit](vve-kit.html) rekent het per appartement uit." },
    { w: ["kvk", "kamer van koophandel", "inschrij", "handelsregister"], a: "Ja, een VvE moet in het Handelsregister van de KvK staan. Dat kunt u op kvk.nl controleren. Staat de VvE er niet in, dan kan het bestuur dat alsnog regelen.\n\nAlle plichten op een rij: [Wat moet een VvE?](verplichtingen.html)" },
    { w: ["verzeker", "opstal", "polis", "schade"], a: "Meestal verzekert de VvE het hele gebouw met één opstalverzekering, tegen bijvoorbeeld brand en storm. Wat precies moet, staat in de splitsingsakte en het reglement. Op de polis staat ook de herbouwwaarde, die u nodig heeft voor het reservefonds.\n\nZie ook [Wat moet een VvE?](verplichtingen.html)" },
    { w: ["alv", "vergader", "notulen", "agenda", "uitnodig", "stem", "kascommissie", "decharge"], a: "Een VvE vergadert minstens één keer per jaar. Stuur de uitnodiging op tijd (de termijn staat in uw reglement, vaak minimaal 15 dagen), met de agenda, de jaarrekening, de begroting en eventuele voorstellen. Noteer bij elk besluit de stemmen voor, tegen en blanco.\n\nHandig: de [ALV-checklist](alv-checklist.html) en een [voorbeelduitnodiging](uitnodiging-alv.html). Geen tijd? Met het [ALV-pakket](alv-pakket.html) maken wij de stukken voor €29." },
    { w: ["slaap", "slapend", "niets", "nooit", "beginnen", "begin", "opstarten", "wakker", "geen rekening", "starten"], a: "Begin klein:\n1. Zoek de splitsingsakte op bij het Kadaster.\n2. Controleer of de VvE bij de KvK staat.\n3. Open een bankrekening op naam van de VvE.\n4. Plan één ledenvergadering en spreek een voorschot af.\n\nWat er wettelijk moet: [Wat moet een VvE?](verplichtingen.html). Voor de administratie vanaf dag één is er de [VvE-kit](vve-kit.html) (€12)." },
    { w: ["kit", "spreadsheet", "excel", "sheets", "administratie", "kasboek", "jaarrekening", "boekhoud", "begroting"], a: "De **VvE-kit** is één spreadsheet voor de administratie van een kleine VvE: leden en breukdelen, voorschotten, begroting, kasboek, jaarrekening, reservefonds, een eenvoudig MJOP en een notulen-sjabloon. Werkt in Excel, Google Sheets en LibreOffice, met een ingevuld voorbeeld erbij. **Eenmalig €12**, geen abonnement.\n\n[Bekijk de VvE-kit](vve-kit.html) of [koop hem direct](https://vvekit.gumroad.com/l/Vvekit)." },
    { w: ["pakket", "geen tijd", "uitbested", "laten maken", "voor ons", "29", "stukken"], a: "Met het **ALV-pakket** maken wij de stukken voor uw jaarvergadering: uitnodiging en agenda, jaarrekening, begroting met voorschotten per appartement, het reservefonds en een notulen-sjabloon. U stuurt de cijfers naar alv@vvekit.nl en krijgt alles binnen 5 werkdagen terug. **€29 per vergadering**, geen abonnement.\n\n[Meer over het ALV-pakket](alv-pakket.html) of [bestel direct](https://vvekit.gumroad.com/l/egnbn)." },
    { w: ["moet", "verplicht", "wet", "regels", "plicht"], x: 0.5, a: "Een kleine VvE moet: ingeschreven staan bij de KvK, meestal het gebouw verzekeren, minstens één ledenvergadering per jaar houden, een reservefonds opbouwen en een bestuurder met een eenvoudige administratie hebben. De regels staan in Boek 5 van het Burgerlijk Wetboek en in de splitsingsakte van uw gebouw.\n\nAlles op een rij: [Wat moet een VvE?](verplichtingen.html)" },
    { w: ["ben je", "bent u", "mens", "robot", "wie ben", "echt", " ai"], a: "Ik ben Vera, een AI-assistent, geen mens. vvekit.nl is een experiment met AI (Claude), beheerd door Lumensquared. Ik kan fouten maken en geef geen juridisch advies: uw splitsingsakte en reglement zijn altijd leidend." },
    { w: ["bestel", "gekocht", "download", "gumroad", "factuur", "contact", "mail", "terug"], a: "Voor vragen over een bestelling of iets anders kunt u mailen naar alv@vvekit.nl. Betalen en downloaden gaat via Gumroad; na betaling krijgt u de downloadlink ook per e-mail." },
    { w: ["hallo", "hoi", "goedemorgen", "goedemiddag", "goedenavond", "hey"], a: "Hallo! Stel gerust uw vraag over uw VvE, bijvoorbeeld over het reservefonds, het voorschot of de ledenvergadering." },
    { w: ["dank", "bedankt", "top", "super"], a: "Graag gedaan. Succes met uw VvE!" },
  ];
  const ONBEKEND = "Daar heb ik geen goed antwoord op. Ik help met vragen over kleine VvE's: reservefonds, voorschotten, de ledenvergadering en de wettelijke plichten. Voor andere vragen kunt u mailen naar alv@vvekit.nl.";

  function vastAntwoord(vraag) {
    const v = " " + vraag.toLowerCase() + " ";
    let best = null, score = 0;
    for (const item of VAST) {
      const s = item.w.reduce((n, w) => n + (v.includes(w) ? 1 + w.length / 10 : 0), 0) * (item.x || 1);
      if (s > score) { score = s; best = item; }
    }
    return best ? best.a : ONBEKEND;
  }

  // Tekst veilig tonen: eerst alles escapen, dan alleen **vet** en [links](naar eigen pagina's of de winkel).
  function opmaak(tekst) {
    const esc = tekst.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    return esc
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, url) => {
        const ok = /^[a-z0-9-]+\.html(#[a-z0-9-]+)?$/i.test(url) || /^https:\/\/vvekit\.gumroad\.com\/l\/[A-Za-z0-9]+$/.test(url) || /^https:\/\/(www\.)?vvekit\.nl\//.test(url);
        return ok ? `<a href="${/^[a-z0-9-]+\.html/i.test(url) ? "/" + url : url}">${t}</a>` : t;
      })
      .replace(/alv@vvekit\.nl/g, '<a href="mailto:alv@vvekit.nl">alv@vvekit.nl</a>');
  }

  const opslag = {
    lees() { try { return JSON.parse(sessionStorage.getItem("vera") || "[]"); } catch { return []; } },
    schrijf(g) { try { sessionStorage.setItem("vera", JSON.stringify(g.slice(-20))); } catch {} },
  };
  let gesprek = opslag.lees();

  // Knop en paneel maken
  const knop = document.createElement("button");
  knop.className = "vera-knop";
  knop.type = "button";
  knop.setAttribute("aria-label", "Stel een vraag aan Vera, de AI-assistent");
  knop.innerHTML = `<img src="${AVATAR}" alt=""><span>Vraag het Vera <span class="ai-label">AI</span></span>`;

  const paneel = document.createElement("section");
  paneel.className = "vera-paneel";
  paneel.hidden = true;
  paneel.setAttribute("aria-label", "Chat met Vera, de AI-assistent");
  paneel.innerHTML = `
    <header><img src="${AVATAR}" alt=""><div><strong>Vera <span class="ai-label">AI</span></strong><small>AI-assistent voor kleine VvE's</small></div>
    <button class="vera-sluit" type="button" aria-label="Sluiten">×</button></header>
    <div class="vera-log" aria-live="polite"></div>
    <form><input name="v" autocomplete="off" maxlength="600" placeholder="Typ uw vraag…" aria-label="Uw vraag"><button type="submit">Stuur</button></form>
    <div class="vera-voet">${VERA_API
      ? "Vera is een AI (Claude) en kan fouten maken. Uw vraag gaat naar Anthropic om een antwoord te maken; noem geen namen of adressen. Geen juridisch advies."
      : "Vera is een AI-assistent en kan fouten maken. Geen juridisch advies."}</div>`;
  document.body.append(knop, paneel);

  const log = paneel.querySelector(".vera-log");
  const form = paneel.querySelector("form");
  const invoer = form.querySelector("input");

  function bericht(rol, tekst, extraKlasse) {
    const d = document.createElement("div");
    d.className = "msg " + (rol === "user" ? "ik" : "vera") + (extraKlasse ? " " + extraKlasse : "");
    if (rol === "user") d.textContent = tekst; else d.innerHTML = opmaak(tekst);
    log.append(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function chips() {
    const c = document.createElement("div");
    c.className = "chips";
    for (const s of SUGGESTIES) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = s;
      b.onclick = () => { c.remove(); vraag(s); };
      c.append(b);
    }
    log.append(c);
  }

  function teken() {
    log.innerHTML = "";
    bericht("assistant", GROET);
    for (const m of gesprek) bericht(m.role, m.content);
    if (gesprek.length === 0) chips();
  }

  let bezig = false;
  async function vraag(tekst) {
    tekst = tekst.trim().slice(0, 600);
    if (!tekst || bezig) return;
    bezig = true;
    log.querySelectorAll(".chips").forEach((c) => c.remove());
    gesprek.push({ role: "user", content: tekst });
    bericht("user", tekst);
    const wacht = bericht("assistant", "Vera denkt na…", "denkt");
    let antwoord = null;
    if (VERA_API) {
      try {
        const r = await fetch(VERA_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: gesprek.slice(-11) }),
        });
        const data = await r.json();
        antwoord = data.answer || null;
      } catch { antwoord = null; }
    } else {
      await new Promise((r) => setTimeout(r, 450));
    }
    if (!antwoord) antwoord = vastAntwoord(tekst);
    wacht.remove();
    gesprek.push({ role: "assistant", content: antwoord });
    opslag.schrijf(gesprek);
    bericht("assistant", antwoord);
    bezig = false;
  }

  function open(eerst) {
    paneel.hidden = false;
    knop.hidden = true;
    if (!log.childElementCount) teken();
    if (eerst) vraag(eerst);
    else if (matchMedia("(min-width: 481px)").matches) invoer.focus();
  }
  function dicht() { paneel.hidden = true; knop.hidden = kaartZichtbaar; if (!knop.hidden) knop.focus(); }

  knop.onclick = () => open();

  // Op de beginpagina staat Vera al in beeld: dan de zwevende knop verbergen.
  const kaart = document.querySelector(".vera-kaart");
  let kaartZichtbaar = false;
  if (kaart && "IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => {
      kaartZichtbaar = e.isIntersecting;
      if (paneel.hidden) knop.hidden = kaartZichtbaar;
    }).observe(kaart);
  }
  paneel.querySelector(".vera-sluit").onclick = dicht;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !paneel.hidden) dicht(); });
  form.onsubmit = (e) => { e.preventDefault(); const t = invoer.value; invoer.value = ""; vraag(t); };

  // Vragen vanaf de beginpagina (knoppen en het invoerveld in de Vera-kaart)
  document.querySelectorAll("[data-vera]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); open(b.dataset.vera || b.textContent); }));
  const heroForm = document.querySelector("form[data-vera-form]");
  if (heroForm) heroForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const i = heroForm.querySelector("input");
    const t = i.value; i.value = "";
    open(t);
  });
})();
