@echo off
rem Lets phones and other laptops on the hotspot reach the race server (8080) and the
rem secure address the phone cameras use (8443). The installer offers to do this;
rem run this only if you skipped that step. Right-click, "Run as administrator".
for %%p in (8080 8443) do (
  netsh advfirewall firewall delete rule name="Pinewood Derby race server (TCP %%p)" >nul 2>&1
  netsh advfirewall firewall add rule name="Pinewood Derby race server (TCP %%p)" dir=in action=allow protocol=TCP localport=%%p profile=any
  if errorlevel 1 goto failed
)
echo.
echo Done. Ports 8080 and 8443 are open for incoming connections.
pause
exit /b 0
:failed
echo.
echo That did not work. Right-click this file and choose "Run as administrator".
pause
exit /b 1
