# CUE RUNNER — Project-documentatie

> **Onderhoudsregel: dit bestand MOET bijgewerkt worden bij elke volgende functionele wijziging.**
> Wanneer je (Claude Code, in deze of een latere sessie, op deze of een andere pc) iets toevoegt,
> verwijdert of herstructureert, werk het relevante hoofdstuk hieronder bij vóórdat je de sessie
> afsluit. Dit bestand is de enige plek waar een nieuwe sessie zonder chatgeschiedenis snapt hoe
> de app in elkaar zit — laat het niet verouderen.

## Wat is dit

Een suite van timecode/cue-tools voor theatervoorstellingen. Geen build-tool, geen framework:
elk bestand is losstaande HTML/CSS/JS in één file, zodat ze offline en zonder installatie werken.
De operator bestuurt de show vanaf `cue-runner-desktop.html`, gesynchroniseerd met Reaper via MIDI
Time Code; publiek/techniek elders kan meekijken via `cue-runner-viewer.html`, live gestreamd over
een WebSocket-relay (`server.js`, gehost op Render.com).

## Bestanden

| Bestand | Rol |
|---|---|
| `cue-runner-desktop.html` | **Master.** Volledige operator-app: MIDI-sync, cue/region-editor, CSV-import/export, broadcast, alle 5 view-modi (desktop/tablet/telefoon/watch + auto), in-app handleiding. Bron van waarheid voor alles wat de viewer ook moet tonen. |
| `cue-runner-viewer.html` | **Slave.** Read-only spiegel van de master — zelfde UI/CSS/i18n/thema/view-modi, maar gedreven door WebSocket-`state` in plaats van lokale state. Geen MIDI/CSV/editor/broadcast-panelen, geen "bestuurbaar"-modus. Wordt door `server.js` geserveerd op `/` en `/viewer`. |
| `server.js` | Node/`ws`-relay. Eén broadcaster tegelijk (laatste WebSocket-verbinding die JSON stuurt "wint"), stuurt elk bericht 1-op-1 door naar alle overige verbonden clients (viewers). Bewaart `lastState` zodat nieuwe viewers meteen iets zien i.p.v. een lege pagina. Ping/pong elke 25s om Render's idle-timeout te omzeilen. |
| `package.json` | Enige dependency: `ws`. `npm start` → `node server.js`. |
| `archive/cue-runner-smartphone.html`, `archive/cue-runner-watch.html`, `archive/SETUP-GIDS.html` | Uitgefaseerd. Smartphone/watch-losse-bestanden zijn vervangen door de responsive/watch-modi ín desktop+viewer; SETUP-GIDS.html's inhoud zit nu in de in-app handleiding (§ Hosting). Bewaard voor referentie, niet actief onderhouden. |
| `CUE-RUNNER-HANDOFF.md` | Historisch takenlijstje waarmee deze sessie begon. Alle items zijn afgehandeld — dit bestand is een archief, geen actuele bron. Gebruik **dit** PROJECT.md voor de huidige stand van zaken. |

## Kernarchitectuur

### MIDI-synchronisatie (alleen desktop.html)
- Ontvangt **MTC** (MIDI Time Code, quarter-frames) + **MIDI Clock** van Reaper via LoopMIDI (of directe MIDI-interface).
- Tweetrapsmodel voor WebMIDI-toegang (`requestMidi(sysex)`, `sysexEnabled`-flag):
  - **Standaard**: `requestMIDIAccess({sysex:false})` — stabiel, geen "geblokkeerd"-melding, maar kan geen SysEx-berichten *versturen* (0xF0). Start/Stop/Continue werken hiermee.
  - **Optioneel**: knop "Activeer volledige MTC-positionering" vraagt opnieuw aan met `{sysex:true}` (nieuwe browserprompt, alleen als de gebruiker het expliciet wil). Pas hierna werkt `sendMTCFullFrame()` — nodig voor "ga naar tijdstip" / positie-sync terug naar Reaper.
- **MTC-offset**: Reaper start zijn timecode vaak bij `01:00:00:00` (broadcast-conventie). Offsetveld + presets + `autoDetectOffset()` (gebruikt eerste region-start of stript het uur-component als er geen regions zijn) compenseren dit.

### CSV-import (Reaper markers/regions export)
- `parseAndImport(txt)` herkent Reaper's `#,Name,Start,End,Length,Color`-formaat: regels met ID `R*` → regions, `M*` → cues (markers).
- Tijdformaten: `parseReaperTime()` ondersteunt `M:SS.mmm`, `SS.B.TT` (bars/beats), `HH:MM:SS:FF` (frames) — keuzemenu Auto/geforceerd per formaat in het CSV-paneel.
- **Notitie-splitsing**: `splitNoteFromName(raw)` — regex `/^(.*?)\s*Note:\s*(.*)$/i`. Alles ná het (hoofdletterongevoelige) woord `Note:` in de marker-naam wordt de cue-notitie; de rest wordt de naam. Een gewone dubbele punt zonder het woord "Note" triggert dit niet (bv. `"KRAAN: engel weg"` blijft intact).
- `guessTypes(name)` kent automatisch een of meer cue-types toe op basis van trefwoorden in de naam (zie Cue-types hieronder) — zowel Nederlandse als Engelse termen, hoofdletter-Reaper-conventie eerst.
- Elke cue krijgt een `regionId` op basis van zijn tijdstip binnen een region-range.
- Fallback-parser (niet-Reaper CSV/tab-gescheiden tekst) bestaat ook, met dezelfde note-splitsing en type-gok.

### Datamodel
```js
// Cue
{ time: Number, name: String, note: String, types: ['licht'|'spot'|'kraan'|'kaboem'|'truss'|'dir'|'sound'|'video', ...], regionId: String|null }

// Region ("deel")
{ id: String, name: String, start: Number, end: Number, color: String|null }
```
`types` is altijd een array (een cue kan meerdere types tegelijk hebben, bv. SPOT + KRAAN). `type` (enkelvoud) duikt alleen op in de broadcast-payload als backward-compat eerste-element-alias — gebruik in nieuwe code altijd `types`.

### Live broadcast (master → viewer)
- Master maakt een WebSocket-verbinding naar `server.js` en roept `broadcastState()` bij elke relevante state-wijziging (tick, cue-check, editor-save, import, taalwissel, …) — niet op een timer.
- **Payload van `broadcastState()`** (in `cue-runner-desktop.html`, functie rond regel 4693):
  ```js
  {
    t: Number,              // elapsed seconds
    running: Boolean,
    fps: Number,             // clockFps() — zodat viewer dezelfde framerate toont
    activeCue: {name,time,type,types,note} | null,
    nextCue:   {name,time,type,types,note} | null,   // ongefilterd; viewer herberekent zelf filter-aware
    prevCueTime: Number,
    region: {id,name,start,end,color} | null,        // huidige actieve region (volledig object, niet alleen id)
    cues:    [{time,name,type,types,note,regionId}],  // hele cue-lijst
    regions: [{id,name,start,end,color}],              // hele region-lijst
  }
  ```
  **Regel: elk cue/region-veld dat de viewer moet kunnen tonen, moet hier expliciet in de payload zitten.** Iets aan de master toevoegen dat de viewer ook nodig heeft (zoals eerder `time` op `activeCue`) is zinloos als het niet ook gebroadcast wordt.
- Viewer ontvangt dit als `lastState`, houdt zelf een lokale `requestAnimationFrame`-klok bij (`localElapsed`/`localRunning`/`localStartedAt`) zodat de klok blijft doorlopen bij een tijdelijke verbindingsonderbreking, en rendert alles daaruit — nooit uit eigen mutable cue/region state.
- `server.js` bewaart de laatste broadcast en stuurt die meteen naar nieuw verbonden viewers (`lastState` op de server, niet te verwarren met `lastState` in de viewer-JS — zelfde naam, andere plek).

### Master/slave UI-contract — **belangrijk voor elke toekomstige wijziging**
De gebruiker wil dat de viewer qua UI **quasi-identiek** blijft aan de desktop-app: zelfde klok/frames,
zelfde delen-lijst, cue-lijst, filterchips, delen-view, thema, i18n, responsive layout — alleen
read-only (geen MIDI/CSV/editor/broadcast/"bestuurbaar"-knoppen). **Elke wijziging aan een
kijk-relevant stuk van desktop.html moet in dezelfde sessie ook naar viewer.html geport worden.**
Zie ook de persistente memory `viewer-mirrors-desktop` / `broadcaststate-payload-fields`.

Let op: wijzigingen aan `cue-runner-viewer.html` worden pas online zichtbaar nadat de gebruiker
zelf opnieuw deployt naar Render (push naar de gekoppelde GitHub-repo) — dat is een handeling van
de gebruiker, niet iets Claude Code kan/mag doen zonder expliciete opdracht.

### View-only / "bestuurbaar"-gating (alleen desktop.html)
- `controlsEnabled` (boolean) bepaalt of de operator-acties (start/stop, cue bewerken, MIDI, …) uitgevoerd mogen worden. `requireControl()` checkt dit en opent zo nodig een waarschuwingsmodal (`openControlWarning()`/`confirmEnableControl()`).
- De statusbadge (`onControlBadgeClick()`) is een **echte toggle**: view-only → bestuurbaar vraagt bevestiging via de modal; bestuurbaar → view-only (`disableControl()`) gebeurt direct, zonder bevestiging, omdat dat de veilige richting is.
- De viewer heeft dit systeem niet — die is per ontwerp altijd read-only.

## Thema-systeem
CSS custom properties op `:root` (donker, standaard) en `:root[data-theme="light"]` (override).
Kernvariabelen: `--bg/--s1/--s2/--s3/--bdr` (achtergrond-lagen/border), `--acc`+`--acc-rgb` (accentkleur,
teal `#bceff6`), `--warn`/`--danger`/`--text`/`--muted`/`--dim`, plus per-cue-type kleuren
`--licht/--spot/--kraan/--kaboem/--truss/--dir/--sound/--video/--none` (zie `TYPE_COLORS` in JS —
**deze twee bronnen moeten in sync blijven** als een typekleur ooit verandert). Toggle: `toggleTheme()`,
opgeslagen in `localStorage['cueRunnerTheme']`. Beide bestanden hebben dit onafhankelijk maar identiek
geïmplementeerd (geen gedeeld CSS-bestand, single-file-per-app blijft het uitgangspunt).

## i18n-systeem (NL/EN/FR/ES)
- `T` = platte dictionary `{ key: {nl, en, fr, es} }`, gedefinieerd in een `<script>`-blok in elk bestand apart (geen gedeeld bestand — bij nieuwe tekst dus in **beide** bestanden toevoegen als de tekst in beide voorkomt).
- `t(key)` → huidige taal (valt terug op `nl`, dan op de key zelf). `tf(key, {var:val})` → `t()` met `{var}`-placeholders vervangen.
- `applyTranslations(root?)` scant `[data-i18n]` (→ `innerHTML`), `[data-i18n-title]` (→ `title`), `[data-i18n-ph]` (→ `placeholder`).
- `setLang(lang)` zet `LANG`, slaat op in `localStorage['cueRunnerLang']`, roept `applyTranslations()` en herbouwt daarna alle dynamisch gerenderde stukken (regions, cue-lijst, filterchips, strips, …) die zelf tekst bevatten en dus niet via `data-i18n` lopen. `initLang()` leest de opgeslagen taal bij opstart.
- **Twee patronen voor content**:
  1. **Atomaire keys** (de standaard) — elke UI-string is een eigen `T`-entry, `data-i18n="korte_key"` op het element.
  2. **Sectie-blobs** (alleen voor de in-app handleiding) — een hele handleiding-sectie (kopjes, lijsten, tabellen, code) is als één grote HTML-template-literal per taal opgeslagen onder één key (`help_reaper_body`, `help_markers_body`, `help_hosting_body`), toegepast via `data-i18n` direct op de sectie-container. Bewust gekozen omdat het atomiseren van lange documentatie-proza in tientallen micro-keys onwerkbaar is. Nieuwe handleiding-secties: volg dit blob-patroon, niet het atomaire.

## Cue-types + filter
- `TYPE_ORDER = ['licht','spot','kraan','kaboem','truss','dir','sound','video']` — vaste volgorde, ook gebruikt voor cyclen (watch-filterknop) en chip-rendering.
- Een cue kan **meerdere** types hebben (`cue.types` array). `typeColor(types)` geeft de kleur van het eerste type (voor stip/balk-weergave); bij meerdere types toont de cue-rij een gesegmenteerde kleurbalk.
- Filter: `activeFilter` (een `Set<string>`). Leeg = geen filter (alles zichtbaar). `cueMatchesFilter(c)` = leeg-filter OF minstens één overlappend type. `buildFilterChips()`/`toggleTypeFilter()`/`clearTypeFilter()`.
- **Vaste regel**: de *huidige actieve* cue wordt altijd getoond, ongeacht filter — een filter beïnvloedt alleen wat als "volgende" telt/getoond wordt. Vandaar het onderscheid tussen `nextIdx()` (ongefilterd, alleen gebruikt voor de broadcast-payload) en `nextIdxFiltered()` (filter-aware, gebruikt voor alles wat de operator/kijker daadwerkelijk ziet aftellen — inclusief de watch-weergave).
  - Desktop: `nextIdxFiltered()` leest de globale `elapsed`/`cues`.
  - Viewer: `nextIdxFiltered(tm)` neemt tijd als parameter en leest `lastState.cues` — andere signatuur, zelfde semantiek. Hou dit verschil in gedachten bij het porten van filter-gerelateerde code.

## View-modus systeem (responsive: desktop/tablet/telefoon/watch, + auto)
- `viewMode` (`'auto'|'desktop'|'tablet'|'phone'|'watch'`), opgeslagen in `localStorage['cueRunnerView']`.
- `resolveView()`: geeft `viewMode` terug als die niet `'auto'` is; anders breedte-gebaseerde auto-detectie (`≤640`→phone, `≤1024`→tablet, anders desktop). **`'watch'` wordt nooit automatisch gekozen** — een ronde smartwatch-viewport is niet betrouwbaar te onderscheiden van een kleine telefoon op breedte alleen, dus watch is uitsluitend handmatig via de `#viewSelect`-dropdown.
- `applyView()` zet `data-view` op `<html>` (CSS-driven layout via `:root[data-view="..."]`-selectors) en ververst de mobiele navigatiebalk.
- `setViewMode(m)` valideert, bewaart, past toe. Op resize wordt `applyView()` gedebouncet herroepen, maar **alleen** als `viewMode==='auto'`.
- Tablet/telefoon: `.mobile-nav` onderaan met secties "Show"/"Delen" (viewer) of "Show"/"Delen"/"Paneel" (desktop, extra editor-tab) — `setSection()`/`currentSection()`/`refreshMobileNav()`.
- **Watch** (5e modus): vervangt de volledige normale UI (`.topbar`/`.layout`/`.mobile-nav` op `display:none`) door één cirkelvormige "wijzerplaat" (`#watchView` > `.watch-face`, `border-radius:50%`, percentuele safe-zone padding zodat tekst niet buiten de cirkel valt). Toont: status-dot + tekst, aftelling naar **volgend deel** (regions hebben geen type dus dit is nooit gefilterd), aftelling naar **volgende cue** (filter-aware via `nextIdxFiltered`), de klok, en één "tik-om-te-cyclen"-filterknop (`cycleWatchFilter()`) die dezelfde `activeFilter`/`TYPE_ORDER` gebruikt als de reguliere filterchips — dus altijd in sync, geen aparte filterstate.
  - Desktop: `renderWatch()` is parameterloos, leest globale state, wordt aangeroepen vanuit `updateStrip()` (dus elke tick/cue-check/edit/import/taalwissel) en guardt zichzelf met `if(resolveView()!=='watch') return;`.
  - Viewer: `renderWatch(tm)` neemt de lokale tijd als parameter, leest `lastState`, wordt aangeroepen vanuit de rAF-klokloop én vanuit `renderFull()` (bij elke binnenkomende server-state) én vanuit `applyView()` (zodat overschakelen naar watch-modus meteen vult i.p.v. te wachten op het volgende frame/de volgende state-push).

## Delen-view ("regions-only", volledige-scherm overlay)
`regionViewActive` + `toggleRegionView()`/`updateRegionView()`. Toont het huidige deel (met voortgangsbalk),
het volgende deel + aftelling, én — sinds de laatste uitbreiding — zowel de **huidige** cue (`rvActiveCueName`/`rvActiveCueNote`,
accentkleur) als de **volgende** cue (`rvCueName`/`rvCueNote`, warn/oranje) met hun volledige notitie, plus
een rij van de eerstvolgende 3 cues. Zelfde visuele onderscheid huidig/volgend als de reguliere "Nu actief"/"Volgend"-strips
boven de cue-lijst (`updateActiveStrip()` resp. `updateNextStrip()`/`nsCountdown`).

## In-app handleiding
`#helpOverlay` (alleen desktop.html — de viewer heeft geen editor/hosting-stappen nodig, dus geen
handleiding-overlay). Secties: Reaper-setup (incl. Timecode Generator-stap: hoe je in Reaper zorgt
dat er *altijd* MTC uitgestuurd wordt, ook buiten actieve playback, via een loop over een stil stuk
of de gratis SWS-extensie), Markers/Regions-workflow, Hosting (GitHub + Render — voorheen een apart
`SETUP-GIDS.html`, nu hier geïntegreerd). Alle 4 talen, via het sectie-blob i18n-patroon (zie i18n
hierboven). Openen/sluiten/navigeren: `openHelp()`/`closeHelp()`/`switchHelpSection()`.

## Lokaal testen (geen Node op deze dev-machine)
Er is geen Node/Python geïnstalleerd op de machine waar dit project ontwikkeld wordt. Voor lokaal
testen zonder de WebSocket-server: een PowerShell `System.Net.HttpListener`-scriptje als statische
file-server (zie sessiegeschiedenis/scratchpad — niet in de repo), en de `state` van de viewer
handmatig injecteren via de browserconsole (`applyServerState({...})`) i.p.v. een echte
`server.js`-instance op te zetten, wat sneller is voor UI-only wijzigingen. `window.alert` moet
gestubt worden vóór het aanroepen van functies die `alert()` gebruiken (bv. CSV-import), anders
blokkeert een automated-browser sessie volledig.

## Conventies / bekende valkuilen
- **Geen build-tool.** Alles blijft één `<script>`/`<style>`-blok per HTML-bestand. Geen gedeelde
  JS/CSS-bestanden tussen desktop en viewer — bewust, voor offline/zonder-installatie-gebruik.
  Dit betekent: elke gedeelde constante (TYPE_COLORS, T-dictionary-keys, CSS-variabelen) moet
  **handmatig in sync gehouden worden** tussen beide bestanden.
- **Bekend regressiepatroon**: een verkeerd geplaatste sluitende `</div>` laat een paneel buiten
  zijn container vallen. Eerste verdachte bij "paneel toont niets" / "verkeerde kant van het scherm".
- Cue-tijden zijn in seconden (float), niet frames — frames worden alleen voor weergave berekend
  (`fmtFrames()`, afhankelijk van `fps`/`clockFps()`).
- `type` (enkelvoud, backward-compat) vs. `types` (array, canoniek) — gebruik in nieuwe code altijd
  `types`; `type` bestaat alleen omdat de broadcast-payload het al bevatte voordat multi-type cues
  bestonden.

## Changelog (kort, per feature-batch — niet per commit)
- Basis: MIDI-sync (MTC/Clock via LoopMIDI), CSV-import/export, live broadcast naar viewer.
- B1: broadcast-modal openBroadcast()/closeBroadcast() ontbrak — toegevoegd.
- B3: MIDI SysEx-tweetrapsmodel (`sysexEnabled`, `requestMidi(sysex)`) voor "ga naar tijdstip".
- Licht/donker thema, NL/EN/FR/ES i18n-systeem, view-only/bestuurbaar-gating met bidirectionele toggle.
- Meerdere cue-types per cue + type-filter (chips), frames in de klok.
- Delen-view met aftelling + lijst van volgende cues.
- Viewer volledig herbouwd om qua UI/functionaliteit de master te spiegelen (i.p.v. eigen kaart-layout).
- Volledig responsive systeem (auto/desktop/tablet/telefoon) in beide bestanden, filter-aware "volgende cue".
- Huidige + volgende cue-notitie met visueel onderscheid, in reguliere view én delen-view, beide bestanden.
- CSV-import: tekst na "Note:" in een marker-naam wordt automatisch de cue-notitie.
- Volledige in-app handleiding (Reaper-setup incl. Timecode Generator, Markers/Regions-workflow,
  Hosting) in alle 4 talen, sectie-blob i18n-patroon.
- Watch-weergave (5e, ronde, handmatig-only view-modus) met dubbele filter-aware aftelling en
  tik-om-te-cyclen typefilter — in beide bestanden.
- Dit PROJECT.md.
