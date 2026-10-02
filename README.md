# Pinewood Derby Race Manager

Race management software for a Cub Scout pack pinewood derby. One Windows
laptop runs a local server; every screen (race coordinator, audience display,
pit crew check-in, judges, replay camera) is a browser page served over a
Wi-Fi hotspot, so it works in a gym or church hall with no internet at all.
It drives a Derby Magic timer, or a built-in simulator for rehearsals.

## Installing on the race laptop

Download `PinewoodDerby-Setup-<version>.exe` from the repository's Releases
page and run it. It is an ordinary Windows installer: it asks where to put
the program (`C:\Program Files\Pinewood Derby`), whether to add desktop
shortcuts and whether to open Windows Firewall ports 8080 and 8443 for the
phones and projector, then installs the race server, all four screens and a
private copy of Node.js. Nothing else has to be installed first, no internet
is needed to install or to run, and the program appears in Settings › Apps
like any other, with an uninstaller.

Race data (events, photos, replay clips, certificates) lives in
`C:\ProgramData\Pinewood Derby`, outside the program folder, so upgrading
keeps it. Uninstalling asks whether to delete it. Installing a newer version
over an older one just works; a running race server is stopped first.

**What Windows security will say.** The installer is not code-signed, so
SmartScreen may show "Windows protected your PC" (click *More info*, then
*Run anyway*) and the browser may say the download "isn't commonly
downloaded" (keep it). Windows will ask for administrator approval once,
for Program Files and the firewall rules. The app makes its own local
security certificate so phone cameras work; that is expected.

**Building the installer** (for developers): `npm run installer` with
[Inno Setup 6](https://jrsoftware.org/isinfo.php) installed. It builds the
screens, stages the app with production dependencies and the current Node
24 release into `installer/stage`, and writes
`installer/out/PinewoodDerby-Setup-<version>.exe` (about 30 MB; `-- --with-ffmpeg`
adds the video converter for phones that can only record WebM).

## Feedback button (temporary)

Every screen has a small *Report feedback* button in the bottom-left corner
while the program is being tried out. It opens an email to the developer in
the device's own mail app (subject "Pinewood Derby Feedback") with the
person's words followed by a details block: which screen they were on, the
car they were working on and its photo state, the event and round, timer and
audience state, the device and browser, the server's addresses and build,
and any errors from the last few minutes. Screenshots can be attached to the
email by hand. *Copy text instead* puts the same text on the clipboard for
devices without a mail app.

## Race day

1. **Network.** Everything talks over one local Wi-Fi network; no internet is
   needed. Three ways to get one, most reliable first:
   - *A small router* (any home router or a travel router, internet not
     connected). Plug the race laptop into it or join its Wi-Fi, and have the
     phones and projector laptop join too. Best range in a gym, no Windows
     quirks, no idle timeouts.
   - *Windows Mobile Hotspot* on the race laptop: Settings › Network &
     internet › Mobile hotspot. The laptop is then always `192.168.137.1`.
     Catch: Windows only offers the hotspot while some adapter is connected to
     something, so with no internet at the venue plug the laptop's Ethernet
     into any switch or router (it does not need internet) to satisfy it.
     Turn off "automatically turn off mobile hotspot when no devices are
     connected" under the hotspot's power saving option, and use the 2.4 GHz
     band for range.
   - *The iPhone's Personal Hotspot*, with the laptop joining it. Simplest to
     set up but the phone then doubles as the pit crew camera on the same
     network, the laptop address changes each time, and iOS drops idle clients.

   Whatever you use, the home page and the coordinator's Setup tab show the
   laptop's current address with a QR code, so nothing has to be typed on the
   phones. Phones may say "no internet" for this network; that is expected,
   just keep them on it (Android sometimes asks to stay connected).
2. **Start.** Double-click *Start Pinewood Derby* on the desktop (or
   `Start Derby.cmd` in a git checkout, which builds on first run). The server
   starts and the home page opens with QR codes for the phones.
3. **Screens.** *Derby Audience Screen* (or `Start Audience Screen.cmd`) opens
   the audience display full screen in Edge; drag it to the projector. Open
   `/coordinator` on the race laptop, `/pit` on the check-in phone, `/judges`
   on a tablet, and `/replay` on whichever computer has the finish-line webcam.
4. **Firewall.** Only if you skipped the firewall step in the installer: run
   `Allow Through Firewall.cmd` once as administrator so other devices can
   reach ports 8080 and 8443.

## Security notes

Everything runs on the race-day Wi-Fi, and that network's password is the
fence: anyone on it can open the screens and read the roster, and, unless a
PIN is set, change things. Set `DERBY_PIN` (see the developer section) to
require a PIN for every change from the phones and tablets; the screens stay
viewable. Only the pit crew, judges and coordinator devices should be on the
hotspot in any case.

The phones trust the server's own certificate authority so their cameras
work. That root is limited by name constraints to private LAN addresses and
`localhost`, so even if its key leaked it could not impersonate a website,
and it expires 30 days after it is made, so set the phones up in the month
before the race; the server makes a fresh root the next time it runs after
that, and the phones trust it again. Its private key is `data/tls/ca.key` on
the race laptop; it is never included in exports or USB backups. Phones can
remove the trusted root after the season (iPhone: Settings › General › VPN
& Device Management; Android: Settings › Security › Encryption & credentials
› Trusted credentials › User).

## First-time setup wizard

Coordinator › Wizard (also offered on the Race tab until it has been completed
once). Nine steps, each with a live check that keeps updating while you work:
event name and format; network (this laptop's addresses, the Windows hotspot,
whether the firewall rule exists, HTTPS); projector (an audience screen is
connected); phones (a phone is on the pit page over the secure address with a
working camera, with QR codes for the certificate step and the page); replay
camera (webcam on this PC with a test clip, or a phone on a tripod); timer
(connect, lane test, every lane reports); roster; a dry run with the
simulator; and a summary. Each step has troubleshooting notes for the usual
failures.

## Running the race (coordinator script)

Before the crowd arrives: start the server, open `/coordinator` on the race
laptop and `/audience` on the projector (click once for full screen and
sound). On the Setup tab connect the timer and run a lane test. Check people
in on the Roster tab (or let the pit crew do it from their phones).

The Race tab has an **"On the projector"** strip at the top that tells you what
the audience is seeing and has one button for the next step. The whole event
is that button plus *Arm timer*:

1. **Welcome slide** is up. Click **Start race**. The first round is scheduled
   from the checked-in racers if you have not already scheduled it, and the
   projector shows its title card ("Round 1 · Lions", the cars parading
   along the bottom, fanfare).
2. **Arm timer for heat 1** when the cars are on the pins. The show moves to
   the racer spotlight, then *Start countdown* runs the light tree, the scout
   opens the gate on green, times come in, the replay plays, and the next
   "Now staging" lineup appears. Keep arming heats.
3. When the round's last result has been shown, the projector switches to
   that round's **standings** and holds there. The button now reads **Next
   round: Tigers**; click it when you are ready and the next title card goes
   up. Rounds that need earlier results (the pack final) are scheduled
   automatically at that moment. Repeat for every round.
4. After the last round the button reads **Start awards ceremony**. Speed
   awards are created and filled from the results, and the awards title card
   goes up. Then the button reads **Reveal: …** for each award in ceremony
   order (design awards from the judges, den champions, 3rd, 2nd, 1st). When
   the judges shortlisted two or more cars for an award, the button first reads
   **Show nominees** and the projector shows "And the nominees are…" before the
   winner. *Undo* on the Audience tab hides the last reveal again.

Other buttons on the strip: *Skip title card*, *Show standings now* (during a
round), *Unpin* (when a replay or intro was pinned from elsewhere), and
*Restart show* (welcome slide back up; results are kept). The Audience tab's
modes are a manual override for anything unusual; the strip says so while one
is active, with a *Back to the show* button.

**Keyboard shortcuts** work on the Race tab whenever you are not typing in a
box. Press `?` for the list on screen.

| Key | Does |
| --- | --- |
| A | Arm the timer for the current heat |
| Space or S | Start the countdown lights |
| G | Open the gate (simulator only) |
| 1 to the lane count | Mark that lane DNF while the heat is running |
| Enter | Confirm the DNF prompt after the timeout |
| Esc | Cancel the armed heat |
| N | Next step of the show (Start race, Next round, Reveal award) |
| M | Enter times manually for the current heat |
| F | Fix the times of the last heat |
| Z or Ctrl+Z | Undo the last action |
| Shift+Z or Ctrl+Y | Redo what was just undone |

**Undo and Redo.** Undo is on the "On the projector" strip and always says
what it will revert ("Undo: re-run", "Undo: timer result"). It steps back
through the snapshot history one meaningful action at a time: results, fixes,
re-runs, DNFs, round scheduling, roster edits, uploads, award picks and show
steps. Housekeeping such as arming the timer or changing the projector look is
skipped, and the current look and timing preferences are kept. Undo cancels an
armed heat first. Redo re-applies what was just undone until you make a
different change. Every snapshot also stays available under Setup › Events ›
*Restore an earlier state*.

**A car that does not finish.** The timer never reports that lane, so the
heat waits. While racing, every lane still out shows a *DNF* button; click
it as soon as you see the car stop. If nothing is clicked, after the heat
timeout (10 s by default) a prompt asks to *Record DNF* or *Keep waiting*.

**Other problems.** *Re-run this heat* voids it and puts an identical heat
next. *Fix times* corrects a recorded result, and each lane there has a car
picker for when the wrong car ran; the remaining heats re-plan so everyone
still gets their runs. *Enter times manually* records a heat the timer
missed. A dead lane is switched off on the Setup tab. Late arrivals are added
on the Roster tab and join the round.

To rehearse from scratch: Setup › Events › *Reset races, keep roster* clears
every round, result and award winner and puts the welcome slide back (roster,
check-ins, weights and photos stay; a snapshot remains in history). For a
completely fresh event use *Start a new race* on the Setup tab and load the
demo pack from the Roster tab.

## Audience screen

`/audience` has no controls. It opens each round with a full-screen title card
("Round 2 · Tigers", the cars in it parading along the bottom, fanfare) for a
few seconds, then shows the lineup of the current heat with the next two on
deck, the racer spotlight and light tree when a heat is armed, live times when
the gate opens, the result with the heat winner, the instant replay, and the
standings between rounds. The awards ceremony reveals one award at a time
(design awards, den champions, then 3rd, 2nd, 1st onto a podium), with the
scout's video beside their car. The Race tab's *Show round intro* pins a
round's card on screen until resumed, and the Audience tab can force the
welcome slide, standings for any round, or the ceremony.

**Looks.** The projector has four looks, picked on the Audience tab under
**Look**. The change is live, so try each one on the projector before the race.

| Look | Feel |
| --- | --- |
| Cartoon (default) | Sky blue with chunky white cards and thick outlines. Made for the scouts. |
| Broadcast | Black scoreboard, condensed type, lane colours and gold. Sports-TV feel. |
| Drag strip | Checkered flags, warm chrome and red, neon glow on the light tree. |
| Minimal | White with one orange accent. Best on a weak projector in a bright room. |

**Pack logo and sponsors.** On the Audience tab, add the pack logo and a
list of sponsors (name plus an optional logo). The pack logo goes on the
welcome slide, the sponsor screen and the award certificates. While the
welcome slide is up, a sponsor's thank-you card comes round after every
fourth car in the carousel, and the *Sponsors (intermission)* mode is a
full-screen thank-you with every sponsor for breaks. Logos are stored with
the event, so they travel with exports and backups; a PNG with a transparent
background looks best.

Contact sheets of every look are in `docs/themes/` (`<look>-sheet.png`);
`npm run theme-previews` rebuilds them with the server running.

Sounds are synthesised with the Web Audio API and confetti is a small canvas,
so the screen needs no asset downloads. Browsers only allow audio after a
click, so the page starts with a "Start the show" overlay that also enters
full screen. Sound can be turned off on the Audience tab.

## Pit crew and photos

`/pit` is built for a phone at the check-in table (scan the QR code on the home
page). Search or tap a car, check the scout in, type the weight (flagged when
over the limit), tap through the inspection checklist, mark passed / needs work
/ failed, and take the photos. Walk-up racers can be added right there.

**The car photo, to scale, background removed.** Tapping the photo tile opens
the live viewfinder with an outline drawn to scale from the kit block and
wheels (7 by 1.75 by 1.26 inch block, 1.185 inch wheels on a 4.37 inch
wheelbase); line the car up, nose to the left, and tap the shutter. The
wheels are then found in the picture, and the photo is scaled and placed so
that every car's wheels land on the same two spots of the standard 1200x500
crop: all the cars on the big screen are the same size and sit on the same
ground line, whoever took the picture and from however far. The editor says
"Wheels found" when it managed that; if the wheels could not be found (black
bodywork wrapping them, a dark table) you line them up with the circles by
hand. The frame holds 3 inches of height above the ground line and room past
both ends of the block, so spoilers, masts and figures stay in the picture.
The full frame is kept as the original.

Then the background is removed on the phone with no downloads: the backdrop
colour is read from the edges of the frame (per edge, so a lighting gradient
or a warm corner is followed), the car's own colours are learned from the
band just above the axles, which is wood on every car, and the backdrop is
flooded in from the edges without crossing anything that looks like the car
(so a decal in the middle of the car and bare pine on a cream cloth both
survive). Because the wheels fix where the block's bottom face is, everything
below it except the wheels is treated as table and shadow whatever its colour,
which is what removes the shadow a car casts under itself. Anything small or
detached on or above the car, such as a flag on a thin mast, is kept. The
edge is feathered. A tolerance slider and erase/restore brushes fix anything
it missed; "Keep photo, skip cutout" is there too. Detected wheels are never
cut away, whatever the tolerance.

**Welcome carousel.** While the welcome slide is up, the projector cycles
through every car, a few seconds each, with the car's name, racer and den.
Because every photo is placed by its wheels at the same pixels per inch, the
cars appear at one scale. A car with no photo yet shows the stock silhouette
with its number until the picture is taken at check-in. Roster changes and
new photos show up on the slide as they happen; the projector never needs a
refresh, and every open page reloads itself when a new build of the program
is installed.

**Scout video.** The racer card has *Record video*: the front camera, a 3-2-1
count-in, four seconds of the scout saying hi (with sound), preview, upload.
It plays in the racer spotlight beside the car, on the award reveal when that
scout wins, and as a still frame next to each row of the standings. Always
silent on the big screen.

**Phone setup (once per phone, within 30 days of the race).** Browsers only allow the camera on HTTPS, so
the server runs its own local certificate authority and serves HTTPS on port
8443 alongside HTTP on 8080. Open `/phone` on the http address, download the
certificate, install and trust it (the page has the iPhone and Android steps),
then open the https address it shows and add that to the home screen. The
server certificate covers the laptop's current addresses plus the Windows
hotspot address and is re-issued automatically when addresses change; the CA
root the phones trust stays the same for 30 days (it is limited to private
addresses, see Security notes); after that a new root is made and the phones
do this step again.

**Without setup.** On the http address, tapping a photo tile opens the phone's
own camera app, and the picture is lined up afterwards in the crop tool.

## Judges

Open `/judges` on a tablet or laptop at the judging table. The screen has the
design awards on the left (presets or custom, whole pack or one den, reordered
with the arrows) and a gallery of every checked-in car on the right.

**Walk the table.** Tick each car as **Seen** while looking at it; the header
counts seen cars and the "Not seen yet" filter lists the ones still to visit.
The camera button on a card takes or replaces that car's photo right there,
with the same guided shot as the pit crew page (secure address for a phone or
tablet camera).

**Shortlist, then pick.** Select an award, star the cars in the running with
**Shortlist**, and narrow the gallery to the shortlist. Tap a car to award it,
tap again to clear. Cards show any other award a car already holds so the
awards can be spread around. A shortlist of two or more becomes the "And the
nominees are…" moment in the ceremony.

**Scoring (optional).** Add rubric criteria under Scoring, from the presets
(paint and finish, creativity, craftsmanship, scout did the work) or custom
with any top score. Every card then has a **Score** button that opens a score
sheet with a row of numbers per criterion; the card shows the total and the
gallery can be sorted by score. Several judges can score at once: add them
under Scoring, and each device picks who it is under **Scoring as** in the
header (remembered per browser). Each judge has their own sheet, the sheet
shows the other judges' marks beside yours, and a car's total is the average
across the judges who scored each criterion. Scores are a guide for the
judges; winners are still picked by hand.

Speed awards are listed read-only; they come from the race results. Nominee
lists, scores and winners are all undoable from the coordinator screen.

## Instant replay

Three ways to put a camera on the finish line:

- **Webcam on the race PC.** Coordinator › Audience tab › tick *Use this
  computer's webcam for instant replay*. A thumbnail and state show there and
  a "replay cam" pill in the coordinator's top bar. Keep that browser tab in
  front while racing (background tabs slow their timers). Needs the
  coordinator opened at `localhost` or the https address.
- **Laptop at the other end of the track.** Open `/replay` on it at its
  `localhost` address.
- **Phone on a tripod.** Do the one-time certificate setup (`/phone`), then
  scan the *Replay camera* QR code shown on the home page and the coordinator.
  The page asks the phone to keep its screen on; if the phone still locks, set
  Auto-Lock to Never. Keep Safari in front; it pauses the camera otherwise.

Only one camera should be on at a time (the last clip uploaded wins). Whichever
you use, the capture follows the timer: when the gate opens it waits until just
before the fastest car of the day could reach the line (pre-roll, default 1 s),
records, and stops a tail (default 1.5 s) after the last car that actually
finishes, so a DNF never drags the clip out; then the clip is uploaded against
the heat. Both timings are on the Audience tab. Every uploaded clip is
recorded as H.264 MP4 wherever the browser can (Chrome and Edge from version
126, Safari), which every screen plays as is. Older browsers record WebM; the
audience screen plays that too, and a development checkout converts such
clips to MP4 with ffmpeg (the installer leaves the 80 MB converter out
unless built with `--with-ffmpeg`). The audience screen plays it in slow motion
(speed set on the Audience tab) during the result hold, with a compact results
row underneath. The coordinator can pin any heat's replay back on screen with
"Show replay on screen". Any USB webcam works; this is for the crowd, not for
judging, so the timer decides the results either way.

## Printing and exports

Under *Print* on the Race tab, each a plain page with a Print button; choose
"Save as PDF" in the browser's print dialog to keep a file:

- **Heat sheet** for the current round (lanes per heat, with times once run),
  **Standings** for the round, and the **Roster**.
- **Full results**: every round's standings and the awards list on one
  document.
- **Certificates**: one page per award with a winner, with the racer's name,
  car name and number, den, the car photo (the cutout when there is one), the
  place and time for speed awards, and signature lines. Speed awards get
  winners from *Fill winners from results* on the Audience tab; design awards
  from the Judges screen.

The Audience tab links the awards list on its own.

## Saving, backups and the next race

Everything saves to disk the moment it happens: every result, check-in, photo
and award pick goes into `data\derby.sqlite` next to the program, with a
snapshot after each change for Undo and *Restore an earlier state*. Restarting
the computer mid-race is safe: start the program again and the event opens
where it was. Only the timer's live state is lost, so re-arm the heat that was
running.

The Setup tab has a **Backup** panel:

- **Export** downloads the event as one zip (state, photos, scout videos,
  replay clips). Import it on any computer running this program.
- **Import** takes such a zip and either opens it as a separate event or
  replaces the saved event it came from.
- **USB stick**: while a removable drive is plugged in, the event is copied to
  `<drive>\Pinewood Derby Backups\<event>\<event>-latest.zip` about twenty
  seconds after every change, plus a dated copy every half hour. Nothing on
  the stick is deleted. Turn it off with the checkbox if you'd rather not.

**Start a new race** at the top of the Setup tab creates the next event,
optionally copying the roster from the current one (dens, names, car numbers
and names, with check-ins, weights, inspections, photos and results left
behind), then opens the setup wizard. The previous event stays in the Events
list.

## Tutorial video

`npm run tutorial` builds `docs/tutorial/tutorial.mp4` (about ten minutes,
captioned; the narration is `docs/tutorial/script.md`, which is kept in the
repository) with the server running. It walks through every screen: setup,
the wizard, network and phones, roster, pit crew check-in, running the race,
fixing problems, instant replay, judges and awards, printing and resets. The
generator (`tools/make-tutorial.mjs`) creates a throwaway demo event, drives it
through a race, captures each screen in a headless Edge or Chrome, narrates
with the Windows text-to-speech voice, and assembles the video with the
bundled ffmpeg. It restores the previously active event and timer setup when
done. The video itself is not committed; build it or share it separately.

## For developers

### Running

```bash
npm install
npm test
npm run typecheck
```

Development (API on 8080 with a hot-reloading UI on 5173):

```bash
npm run dev
```

`npm run dev:server` and `npm run dev:web` run the two halves separately.
Production-style (build the UI, then one server serves everything on 8080):

```bash
npm start
```

Requires Node 22 or newer. Other scripts: `npm run tutorial`,
`npm run theme-previews`, and `npm run screenshot -- "name|/path"` for
full-size page captures.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `DERBY_HOST` | `0.0.0.0` | Address to listen on |
| `DERBY_PORT` | `8080` | HTTP port |
| `DERBY_HTTPS_PORT` | `8443` | HTTPS port for phone cameras; `0` disables HTTPS |
| `DERBY_DATA_DIR` | `data/` (installed: `C:\ProgramData\Pinewood Derby`) | Database, photos, clips, headshots and certificates |
| `DERBY_PIN` | none | A PIN every POST must carry in the `x-derby-pin` header |
| `DERBY_TIMER` | `simulator` | `simulator` or `derby-magic` (the Setup tab's choice overrides this) |
| `DERBY_SERIAL_PORT` | auto | COM port of the timer |
| `DERBY_SIM_SPEED` | `1` | Simulator speed; `0` is instant |
| `DERBY_SIM_DNF` | `0.03` | Chance a simulated car never finishes |
| `DERBY_USB_BACKUP` | on | `0` disables the USB stick backup |
| `DERBY_WEB_DIST` | `packages/web/dist` | Built UI to serve |
| `DERBY_URL`, `DERBY_BROWSER`, `DERBY_VOICE` | | For the tools: server address, browser executable, narration voice |

### Layout

```
packages/
  core/     Pure domain logic. No I/O, no framework. Fully unit tested.
    src/model/      Data types (Derby, Group, Racer, Car, Round, Heat, Award, Judging ...)
    src/format/     Race format presets, format validation, award and inspection presets
    src/schedule/   Lane rotation charts and the greedy re-packer for mid-race changes
    src/scoring/    Places, scoring methods, standings with tie-breaks
    src/race/       DerbyEngine: every state change goes through here
    src/timer/      Derby Magic wire protocol, heat collector session, simulator
    src/roster/     CSV import with forgiving column detection
  server/   Node + Fastify. Owns the engine, snapshots every change to SQLite (node:sqlite,
            no native build), broadcasts state over WebSocket, drives the timer.
    src/app.ts            HTTP + WebSocket routes, undo/redo, event switching
    src/commands.ts       Every mutation a screen can request, dispatched by name
    src/archive.ts        Event export/import as one zip
    src/backup.ts         Automatic backup to USB sticks
    src/network.ts        LAN addresses, hotspot address, firewall check
    src/timer/service.ts  Arms the timer for a heat, streams live lanes, records the result
    src/timer/serial.ts   Derby Magic over USB serial: port listing, probe, line splitting, reconnect
    src/store.ts          SQLite: current state per event + change history
    src/media.ts          Photos, replay clips and headshots on disk; state holds keys only
    src/tls.ts            Local certificate authority and server certificate for HTTPS
    src/transcode.ts      Converts uploaded clips to H.264 MP4 when ffmpeg is present (optional)
    src/demo.ts           Demo pack for rehearsals
  web/      Vite + React. One app, one route per screen.
    src/screens/          Home, Coordinator (Race, Roster, Audience, Setup, Wizard tabs),
                          Audience, Pit, Judges, ReplayCam, PhoneSetup, Print
    src/audience/         Mode logic, views, looks (audience.css, themes.css), sounds, confetti
    src/pit/              Live camera with outlines, crop and mask editors, uploads, pit theme
    src/judges/           Judges' screen styles
    src/replay/           Replay capture hook shared by the coordinator and /replay
    src/print/            Print page styles
    src/components/       Modal, manual times dialog, notices, QR codes
    src/lib/              Server connection, state context, formatting helpers
tools/      Tutorial video generator, look previews, page screenshots, dry run
installer/  Windows installer (Inno Setup script, build script, icon)
drivers/    Windows driver for the timer's MCP2221 USB bridge (Windows 10+ installs it automatically)
```

### Screens and API

Pages: `/`, `/coordinator` (with `/roster`, `/audience`, `/setup`, `/wizard`),
`/audience`, `/pit` and `/pit/:carId`, `/judges`, `/replay`, `/phone`, and the
print pages `/print/heats/:roundId`, `/print/standings/:roundId`,
`/print/awards`, `/print/roster`, `/print/results`, `/print/certificates`.

Every page connects to `/ws` and receives the full state on every change plus
live timer and backup status, so nothing polls. Mutations go through
`POST /api/command` with `{ name, args }`; the names are the handlers in
`packages/server/src/commands.ts`. Uploads are raw bodies on
`POST /api/photos/:carId`, `/api/replays/:heatId` and `/api/headshots/:racerId`,
served back from the same paths by key. `GET /api/state`, `/api/info`,
`/api/diagnostics`, `/api/history` and `/api/export`; `POST /api/import`.

### Design notes

**State model.** The whole event is one plain JSON object (`Derby`). The engine
mutates it through commands and notifies listeners; the server snapshots it
after every command. That gives backup, undo and "rebuild any screen from
state" for free at derby scale.

**Scheduling.** With N cars and L lanes the chart runs each car in every lane
once per pass using a cyclic offset scheme. Offsets are chosen so that, where
possible, no car races in consecutive heats (the pit crew can stage) and
repeated opponent pairings are minimised. When a lane dies, a car withdraws or
a late arrival is added, the not-yet-run heats are rebuilt by a greedy packer
from what each car still owes.

**Open class.** Groups of kind *class* (siblings, parents, "outlaw") never race
against the scouts: every preset ends with an *Open Class* round, one per class
group, with its own champion award, and the combined rounds and finals take
dens only. The round only shows on the coordinator when such a group exists.

**Race formats.** A format is an ordered list of rounds. Each round is per-group
(one round per den) or combined, takes its entries from everyone eligible or by
advancing the top N per group and/or overall from an earlier round, and scores
by average time, total time, best time, place points or wins with configurable
tie-breaks. Five presets ship; the same structure supports custom formats.

**Re-runs.** Voiding a heat keeps its result for the audit trail and schedules
an identical heat, either immediately next or at the end of the round.

**Spotlight.** The racer spotlight before each heat picks the scout with the
fewest spotlights so far, then the fewest remaining heats; a den with fewer
heats than cars leaves some scouts without one.

**Timer.** The Derby Magic timer is a serial device (USB via MCP2221, shows up
as a COM port). Protocol, as documented by the DerbyNet project:

| Item | Value |
|---|---|
| Serial | 19200 8N1 (older firmware 9600 8N1) |
| Identify | send `V`, reply contains `Derby Magic` |
| Arm | send `R` |
| Remote start | send `S` (solenoid gate only) |
| Gate opened | timer sends `B` |
| Lane finished | `1=3.1234!` = lane 1, 3.1234 s, place `!`=1st `"`=2nd `#`=3rd `$`=4th |
| Never finished | no line; `0.0000` also means no finish |

`TimerSession` turns those lines into whole-heat results with a timeout for
lanes that never report. `SimulatedTimerPort` speaks the same protocol so the
whole app can be exercised without hardware.

**Connecting the real timer.** Plug it in, open the coordinator's Setup tab and
choose *Derby Magic (USB)*. With port and baud left on auto the server tries the
COM port whose USB vendor id is Microchip's (the MCP2221 bridge) first, at
19200 then 9600, and uses whichever answers the identify command. A specific
port and baud can be forced, in which case the port is opened even if the
timer stays quiet and the status says so. The choice is remembered across
restarts. If the cable is pulled mid-event the server keeps retrying every few
seconds and the coordinator sees the timer go offline. *Lane test* arms every
lane with no heat attached so the track can be checked before racing.

**Dry run.** `npm run dry-run` plays a whole derby against a server through
the coordinator's own commands: demo roster, every round and heat on the
simulated timer, DNFs, an undo and redo, the awards and ceremony, an export
and re-import, then Reset races, checking as it goes. Point it at a throwaway
server (it creates and switches to a new event), for example:

```bash
cd packages/server && DERBY_PORT=8090 DERBY_HTTPS_PORT=0 DERBY_DATA_DIR=/tmp/derby-dry DERBY_USB_BACKUP=0 DERBY_SIM_SPEED=0.02 DERBY_SIM_DNF=0.08 npx tsx src/index.ts
```

then `DERBY_URL=http://localhost:8090 npm run dry-run` from the repo root.

## License

MIT. Use it, change it, share it; see `LICENSE`. Built for Pack 316 and
free for any pack that wants it.
