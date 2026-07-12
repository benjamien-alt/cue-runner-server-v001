# CUE RUNNER — Project overdracht naar Claude Code

## Wat is dit project
Een suite van timecode/cue-tools voor theatervoorstellingen, gebouwd als losse HTML-bestanden
(geen build-tool, geen framework — puur HTML/CSS/JS in één bestand per versie zodat ze
offline en zonder installatie werken).

## Bestanden
- `cue-runner-desktop.html` — hoofdversie, 3-koloms layout (regions | klok+cues | detail/MIDI/CSV)
- `theater-cue-runner.html` — smartphone-versie
- `cue-runner-watch.html` — Wear OS smartwatch-versie (466×466px rond scherm)
- `cue-runner-viewer.html` — read-only viewer voor externe kijkers
- `server.js` — Node.js WebSocket relay-server (gehost op Render.com)
- `package.json` — dependencies voor server.js (alleen `ws`)

## Kernarchitectuur — belangrijk om te weten
- **MIDI-synchronisatie**: ontvangt MTC (MIDI Time Code) quarter-frames + MIDI Clock van Reaper
  via LoopMIDI. `requestMIDIAccess({sysex:false})` — bewust zo gezet om de "Geblokkeerd"-melding
  te vermijden. **Consequentie: kan geen SysEx-berichten meer VERSTUREN** (nodig voor "ga naar
  tijdstip" / positie-sync naar Reaper) — dit is precies bug B2 hieronder.
- **CSV-import**: Reaper exporteert regions/markers in drie mogelijke tijdformaten:
  `M:SS.mmm`, `SS.B.TT` (bars/beats), `HH:MM:SS:FF` (frames). Er is een keuzemenu (Auto/
  geforceerd per formaat) in het CSV-paneel — zie `parseReaperTime()`.
- **MTC offset**: Reaper start zijn timecode vaak bij `01:00:00:00` (broadcast-conventie).
  Er is een offset-veld + presets (0s / −1u / −2u) + een "Auto"-knop in het MIDI-paneel.
- **Regions vs. cues**: regions (`R*` in CSV) = "delen" van de voorstelling, markers (`M*`) =
  cues. Elke cue krijgt automatisch een `regionId` toegewezen op basis van zijn tijdstip.
- **Live broadcast**: desktop-app kan via WebSocket naar `server.js` (op Render.com) sturen;
  viewers verbinden via `wss://` en tonen dezelfde staat read-only, met lokale klok-doorloop
  bij tijdelijk verbindingsverlies.
- **Bekend regressiepatroon**: dit bestand is al meermaals gebroken door een verkeerd geplaatste
  sluitende `</div>` waardoor een paneel buiten zijn container valt. Check dit als eerste
  verdachte bij "paneel toont niets" / "verkeerde kant van het scherm"-bugs.

## Openstaande bugs (prioriteit 1 — eerst oplossen)

### B1 — Broadcast-venster opent niet meer bij klik op "● Uit" (regressie sinds versie 9 mei)
Werkte in eerdere versie. Vermoedelijke oorzaak: HTML/JS-koppeling van de broadcast-modal
(`openBroadcast()` / `#broadcastModal`) gebroken bij latere edit. Controleer of de modal nog
correct in de DOM zit en of de onclick-handler nog matcht.

### B2 — Viewer blijft hangen op "Verbinding maken met de Cue Runner server…"
Desktop-app toont wél "LIVE" (broadcaster verbindt met server), maar de viewer op
`https://[naam].onrender.com/viewer` verbindt niet. Eerste checks:
1. Bevestig dat de laatste `server.js` én `cue-runner-viewer.html` effectief op Render staan
   (opnieuw geüpload naar GitHub + herdeployed)
2. Check `/health`-endpoint voor status
3. Check server-logs in Render dashboard voor foutmeldingen
4. Bevestig dat viewer zijn URL correct auto-detecteert (`wss://` + `location.host`)

### B3 — MIDI-out naar Reaper faalt: "System exclusive message is not allowed at index 0 (240)"
Rootoorzaak bekend: `sysex:false` (nodig om input-blokkering te vermijden) verhindert ook het
versturen van SysEx-berichten (0xF0 = 240 decimaal). Dit treft `sendMTCFullFrame()` — gebruikt
door "Ga naar tijdstip" en "Stuur huidige positie". Start/Stop/Continue (0xFA/FB/FC, geen SysEx)
zouden wél moeten werken — apart testen.

**Voorgestelde fix:** tweetrapsmodel.
- Standaardverbinding blijft `sysex:false` (stabiel, geen blokkering)
- Voeg een aparte knop toe: "Activeer volledige MTC-positionering" die opnieuw
  `requestMIDIAccess({sysex:true})` aanvraagt — dit triggert een eigen browserprompt, maar
  alleen wanneer de gebruiker het expliciet wil, niet bij elke gewone verbinding
- Zonder die activatie: Start/Stop/Continue blijven werken, Locate/positie-sync toont een
  duidelijke melding ("Activeer eerst volledige positionering")

## Volledige prioriteitenlijst (na de bugs)

| # | Taak | Aanbevolen model | Opmerking |
|---|------|----|-----------|
| B1 | Broadcast-venster + viewer-verbinding | Sonnet | Eén sessie, zelfde subsysteem |
| B2 | MIDI-out SysEx tweetrapsmodel | Opus | Ontwerpbeslissing, niet mechanisch |
| 1 | Licht/donker modus + kleursysteem (groen → `#bceff6` overal) | Opus | Fundament voor latere UI |
| 2 | Vertaalsysteem NL/EN/FR/ES | Opus | Nieuwe tekst als vertaalsleutel schrijven vanaf nu |
| 3 | Eén bestand, omschakelbaar desktop/tablet/telefoon-weergave | Opus | Grootste/riskantste losse taak |
| 4 | View-only modus + waarschuwingsvenster bij "besturen" aanzetten | Sonnet | |
| 5 | Tooltips bij hover op knoppen/functies | Sonnet | |
| 6 | Meerdere types per cue toewijzen (bv. SPOT + KRAAN) | Sonnet | Samen met #7 |
| 7 | Filter op cue-type: LICHT, SPOT, KRAAN, KABOEM, TRUSS, DIR, SOUND, VIDEO | Sonnet | Samen met #6 |
| 8 | Frames tonen naast uur/min/sec in de klok | Sonnet | |
| 9 | Delen-view: aftellen naar volgende cue + lijst van 3 volgende cues | Sonnet | |
| 10 | Volledige in-app handleiding (Reaper-setup, Markers/Regions workflow, GitHub+Render hosting-stappenplan) | Sonnet | Pas nadat B1/B2 werken — documenteer de kloppende eindsituatie |

## Werkwijze per sessie in Claude Code
1. Kies het model bovenaan de sessie vóór je start
2. Eerste zin van je prompt: *"Werk alleen aan [taaknaam]. Raak geen andere functionaliteit aan."*
3. Laat Claude Code testen/verifiëren waar mogelijk (bv. bestand openen in de browserpreview)
4. Sluit af met: *"Commit deze wijziging met een duidelijke boodschap."*
5. Bij twijfel of iets eerder werkte: `git log` / `git diff` gebruiken om te vergelijken met de
   baseline-commit

## Niet gebruiken voor dit project
**Claude Fable 5** — Mythos-klasse model, bedoeld voor ambigue meerdaagse taken, sinds
7 juli 2026 buiten het gewone abonnementslimiet (gebruikskrediet, ~2× kost van Opus, verbruikt
quota 2× zo snel). Voor deze goed-omschreven taken presteert Opus al minstens even goed.
