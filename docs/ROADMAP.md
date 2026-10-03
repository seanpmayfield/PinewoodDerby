# Roadmap

What is built is in the README. This is what comes next, in the order that
makes sense for a first real derby.

## 1. Prove it on real hardware (before anything else)

None of this needs new code; it needs the timer, a phone and a projector in
the same room, and it will surface the bugs that matter.

- Derby Magic on USB: connect from the Setup tab, lane test, run a den with
  the real gate. Watch for: baud fallback, lines with several results, the
  DNF prompt timing, "B" arriving during a countdown.
- Any other timer anyone can bring (FastTrack, The Champ, The Judge, ...):
  the profiles are ported from DerbyNet and tested only against transcripts,
  so a lane test and a look at the timer log are the first job.
- iPhone as pit crew phone: certificate install, live camera outline, scout
  video with microphone prompt, uploads over the hotspot.
- iPhone as replay camera on a tripod: wake lock, clip timing, conversion.
- Projector laptop as the audience screen over the hotspot: sound after the
  first click, clock-independent countdown, replay playback.
- Windows hotspot with no internet at the venue (the Ethernet trick), or the
  small-router setup; firewall rule; QR codes from the printed sheet.
- A full dry run with the demo pack, then Reset races. (The software side
  of this is automated: `npm run dry-run`, see the README.)

## 2. Known limits

- The wizard cannot add the firewall rule itself (needs elevation); it
  watches for the rule and tells you how to add it.
- The installer is not code-signed, so SmartScreen shows its warning on
  first run; the README tells people what to click. Signing certificates
  cost money and this is a free project, so this stays.
