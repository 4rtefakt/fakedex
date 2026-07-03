# Fakédex

A browser-based Pokédex for **Cobblemon fakemon packs**. Drag & drop a mod file,
it unzips and parses everything **locally in your browser** (nothing is uploaded),
and shows a searchable dex with types, abilities, base stats, egg groups and
movesets.

Built to read [Laser's Fakemon Pack](https://modrinth.com/mod/lasers-fakemon-pack)
and any other Cobblemon addon that follows the standard data layout.

## How it works

All four Modrinth distribution formats — Fabric `.jar`, NeoForge `.jar`, datapack
`.zip`, resourcepack `.zip` — are just ZIP containers. The species data always
lives at `data/<namespace>/species/**.json`, so one parser handles every format:

1. `fflate` unzips the archive in-browser (filtered to just species + lang files).
2. `js/parser.js` reads each species JSON into a normalized entry:
   types, abilities (`h:` → hidden), base stats + BST, egg groups, EV yield,
   and moves split into level-up / TM / tutor / egg / legacy.
3. Descriptions come from `assets/<namespace>/lang/en_us.json`. These lang files
   aren't always strict JSON (they carry `#section#` comment lines and trailing
   commas), so the parser falls back to a lenient clean-up pass — this is the
   "not always formatted the same" problem the pack authors warned about.
4. `species_additions` and inline `forms` are surfaced as extra entries, but
   **only when they're a real battle form** (own stats/typing) — purely cosmetic
   colour/aspect variants are skipped so the dex isn't cluttered.

### Move & ability data

Cobblemon move/ability ids are lowercase and spaceless (`dazzlinggleam`). Real
display names, damage category, typing and descriptions come from **Pokémon
Showdown's dataset** (the same data Cobblemon uses), bundled in
`data/base-moves.js` + `data/base-abilities.js` — no network needed at runtime.

Packs also ship their own **custom** fakemon moves at `data/<ns>/moves/*.js` in
Showdown's object-literal format (which can contain JS functions, so we
field-extract with regex rather than eval, tolerant of single/double quotes).
Resolution order per move is **pack-defined > bundled base > prettified id**.

In the moveset list each move shows its damage category (PHY/SPE/STA) and type
badge, a hover tooltip (power / accuracy / PP + effect), and — for standard
moves — a click-through to its [PokémonDB](https://pokemondb.net) page. Truly
pack-original moves are tagged `custom` and aren't linked. Custom ability
descriptions are read from the pack's own lang keys.

To refresh the bundled base data: `node scripts/build-base-data.js`.

Verified against Laser's Fakemon Pack v1.6: **69 species + 130 forms/variants**,
all descriptions resolved, from both the `.jar` and the `.zip`.

## Run locally

Pure static files — any static server works. A tiny zero-dependency one is included:

```bash
node server.js      # http://localhost:4173
```

Then drop `samples/lasers-fakemon-pack/lasers-fakemon-pack-1.6.jar` onto the page.

## Project layout

```
index.html               # page shell
styles.css               # styling
vendor/fflate.js         # unzip library (vendored, no CDN)
data/base-moves.js       # bundled Showdown move metadata (generated)
data/base-abilities.js   # bundled Showdown ability metadata (generated)
js/constants.js          # type/category colors, slugs, prettifiers
js/parser.js             # archive -> normalized dex + custom move/ability data
js/modrinth.js           # Modrinth API: resolve project, list versions, download
js/app.js                # drag/drop, grid, filters, detail drawer, tooltips
scripts/build-base-data.js  # regenerates the bundled data/ files
server.js                # dev static server
samples/                 # sample packs for testing
```

## Deploy

Static site — hosted on **Cloudflare Pages**, connected to this GitHub repo
(auto-deploys on push to `main`). No build step:

- **Build command:** *(none)*
- **Build output directory:** `/`

`_headers` sets long-lived immutable caching on the versioned `vendor/` + `data/`
bundles and revalidation on the app code.

## Modrinth integration

Paste a Modrinth mod URL (or bare slug) and Fakédex resolves the project, lists
every version, and downloads + scans the one you pick — no manual download.

It's **fully client-side**: both `api.modrinth.com` and `cdn.modrinth.com` send
`Access-Control-Allow-Origin: *`, so the browser talks to Modrinth directly (with
a streamed download + progress bar) — no proxy or backend required. See
`js/modrinth.js`.

## Roadmap

Done: local viewer, resolved move/ability data, Cloudflare Pages hosting,
Modrinth integration. Planned next:

- **Sprites.** Packs ship 3D bedrock models, not flat sprites, so rendering a
  portrait means either rendering the model or generating thumbnails offline.
- **Shared database.** Cache parsed results keyed by a mod hash/signature so the
  same pack version isn't re-parsed by everyone; build a global index of every
  fakemon and which pack it belongs to. (This is the point where a Cloudflare
  Pages Function + D1/KV finally earns its keep.)
