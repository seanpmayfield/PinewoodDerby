@echo off
rem Opens the audience display full screen in Microsoft Edge (kiosk mode).
rem Drag the window to the projector first if it opens on the wrong screen,
rem or set the projector as the main display. Press Alt+F4 to close.
start "" msedge --kiosk "http://localhost:8080/audience" --edge-kiosk-type=fullscreen --no-first-run
