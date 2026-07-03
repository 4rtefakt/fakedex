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
vendor/three.min.js      # three.js (vendored) for bedrock model rendering
data/base-moves.js       # bundled Showdown move metadata (generated)
data/base-abilities.js   # bundled Showdown ability metadata (generated)
data/base-cobblemon.js   # bundled base Cobblemon dex, loaded by default (generated)
js/constants.js          # type/category colors, slugs, prettifiers
js/parser.js             # archive -> normalized dex + custom move/ability data
js/modrinth.js           # Modrinth API: resolve project, list versions, download
js/bedrock.js            # bedrock .geo.json -> THREE.Group
js/sprite.js             # render a model to a PNG data URL
js/sharedb.js            # shared-dex client (hash, publish, search)
js/app.js                # drag/drop, grid, filters, detail drawer, tooltips, sprites
functions/api/*.js       # Cloudflare Pages Functions: publish / search / packs
schema.sql               # D1 schema (also auto-created at runtime)
scripts/build-base-data.js  # regenerates bundled move/ability data
scripts/build-base-dex.js   # regenerates the base Cobblemon dex
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

## Base Cobblemon dex

On load, Fakédex shows the **base Cobblemon Pokédex** by default (1025 species +
223 forms) so fakemon packs slot into a complete dex. The data is bundled at
`data/base-cobblemon.js` (~0.4 MB gzipped, generated from the Cobblemon mod's
species + lang — no models, so base mons are data-only cards):

```
node scripts/build-base-dex.js <path-to-Cobblemon.jar>
```

Loading a pack **adds** it as a named *source* alongside the base rather than
replacing it. A source filter in the topbar switches between "All sources", the
base dex, and each loaded pack; pack mons carry a small source badge so they're
easy to spot in the combined view.

## Sprites

Packs don't ship flat sprites — Cobblemon renders **Minecraft bedrock models**
(`.geo.json` cubes + textures, tied together by resolvers and posers). Fakédex
renders them itself:

- `js/bedrock.js` parses the geometry (bones, pivots, rotations, cubes with
  box/per-face UV, inflate, mirror) into a `THREE.Group`.
- `js/sprite.js` frames the model with an orthographic camera and snapshots it to
  a PNG data URL on a single shared WebGL context.
- The parser resolves each entry's model + textures via the pack's resolvers
  (matching aspects for forms) and extracts just those PNGs in a second unzip pass.
- The grid renders thumbnails lazily as cards scroll into view (IntersectionObserver,
  one render at a time to stay smooth); the detail drawer shows a larger portrait.

Entries whose model isn't in the pack (e.g. forms of vanilla mons that reuse
base-Cobblemon models) fall back to a placeholder. For Laser's pack that's all
69 species + 122/130 forms rendered.

## Shared dex (Cloudflare D1)

A community index of every fakemon across every published pack, searchable
without loading anything. Clients still parse locally, then contribute a
**compact summary** (name/dex#/types/BST/abilities/egg-groups — no sprites or
movesets) to a D1 database via Pages Functions.

- Packs are keyed by a **SHA-256 of their file bytes**, so a given version is
  stored once (`{status:"exists"}` on re-publish).
- **Modrinth packs auto-contribute** (they're already public); drag-dropped
  local files get an opt-in "Publish to shared dex" button.
- The **🌐 Shared dex** button opens a cross-pack search (`/api/search`); the
  button only appears when the backend is reachable, so the site degrades
  cleanly before D1 is provisioned.

Functions live in `functions/api/` (`publish`, `search`, `packs`); the schema
auto-creates on first request (`functions/_utils.js`), so provisioning is just:

```
wrangler d1 create fakedex-db
# then in the Pages dashboard: Settings > Functions > add a D1 binding
#   named  DB  ->  fakedex-db
```

Local dev binds a throwaway local D1 automatically:

```
npx wrangler pages dev . --port 4173 --d1 DB=fakedex-db
```

## Roadmap

Done: local viewer, resolved move/ability data, Cloudflare Pages hosting,
Modrinth integration, in-browser 3D sprites, base Cobblemon dex, shared database.
Planned next: QoL & polish (grid virtualization for the 1200+ base dex,
evolution chains, shiny toggle, deep-linking to a mon, sprite caching).
