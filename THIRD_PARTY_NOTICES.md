# Third-party notices

This program is MIT licensed (see `LICENSE`). It stands on other people's work:

## DerbyNet

The timer protocols in `packages/core/src/timer/profiles.ts`, and the way the
session in `packages/core/src/timer/session.ts` runs them (probing, lane
masks, gate watching, debouncing, forcing results when a car never arrives),
are ported from **DerbyNet** by Jeff Piazza, https://github.com/jeffpiazza/derbynet,
in particular the files under `timer/src/org/jeffpiazza/derby/profiles/` and
`timer/src/org/jeffpiazza/derby/timer/`. Jeff worked these out against real
hardware over many years and documents them in "DerbyNet Race Timer
Operation" and "Developers: Timer Messages" at https://derbynet.org. The idea
of scanning a barcode on a car tag at check-in is also his.

DerbyNet is licensed under the MIT License:

```
Copyright (c) 2014-2026 Jeff Piazza

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Node.js and npm packages

The installer carries a copy of Node.js (MIT, https://nodejs.org) and the
packages listed in `package-lock.json`, each under its own licence as stated
in its package.

## Timer hardware

Derby Magic, MicroWizard FastTrack, The Champ, SmartLine, BestTrack,
eTekGadget, The Judge, NewBold, DerbyStick, Derby Timer, PDT, JIT Racemaster
and SuperTimer are the names of their makers' products; this program is not
affiliated with any of them.
