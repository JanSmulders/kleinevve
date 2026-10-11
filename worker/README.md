# Vera: de AI-assistent van vvekit.nl

Deze map is een Cloudflare Worker. De website (`assistent.js`) stuurt vragen hierheen en de Worker vraagt Claude om een antwoord.

## Instellen (eenmalig)
1. Anthropic Console: maak een API-sleutel en zet een maandelijks uitgavenplafond.
2. Cloudflare: Workers & Pages → Create → Import a repository → `JanSmulders/kleinevve`, root directory `worker`.
3. In de Worker: Settings → Variables and Secrets → Add → type **Secret**, naam `ANTHROPIC_API_KEY`, waarde = de sleutel.
4. Zet het Worker-adres (`https://vvekit-assistent.<naam>.workers.dev`) in `assistent.js` bij `VERA_API`.

## Instellingen in `wrangler.toml`
- `MODEL`: welk Claude-model (`claude-haiku-5-5`, of slimmer maar duurder `claude-opus-5-5`).
- `EFFORT`: `low` houdt antwoorden snel en zuinig.
- `ALLOWED_ORIGINS`: alleen vvekit.nl mag de Worker gebruiken.

De sleutel staat nooit in deze repo.
