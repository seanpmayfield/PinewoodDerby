; Inno Setup script for the Pinewood Derby Race Manager.
; Compiled by installer/build.mjs, which stages the app in installer/stage first.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "Pinewood Derby Race Manager"
#define DataDir "{commonappdata}\Pinewood Derby"

[Setup]
AppId={{7C1D2E4A-5B9F-4C3E-9A2B-6D4F3A2B1C0E}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Sean Mayfield
AppPublisherURL=https://github.com/seanpmayfield/PinewoodDerby
AppSupportURL=https://github.com/seanpmayfield/PinewoodDerby#readme
DefaultDirName={autopf}\Pinewood Derby
DefaultGroupName=Pinewood Derby
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
OutputBaseFilename=PinewoodDerby-Setup-{#AppVersion}
SetupIconFile=derby.ico
UninstallDisplayIcon={app}\derby.ico
UninstallDisplayName={#AppName}
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
CloseApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel2=This installs [name/ver] on this computer: the race server, the coordinator, audience, pit crew and judges screens, and a private copy of Node.js.%n%nNothing else needs to be installed first, and the program runs with no internet on race day.

[Tasks]
Name: "desktopicon"; Description: "Put Start Pinewood Derby and Derby Audience Screen on the desktop"; GroupDescription: "Shortcuts:"
Name: "firewall"; Description: "Open Windows Firewall ports 8080 and 8443 so phones and the projector can connect"; GroupDescription: "Network:"

[Files]
Source: "stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "derby.ico"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
; Event data (database, photos, clips, certificates) lives outside Program Files so the program can write it.
Name: "{#DataDir}"; Permissions: users-modify

[Icons]
Name: "{group}\Start Pinewood Derby"; Filename: "{app}\Start Derby.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\derby.ico"; Comment: "Start the race server and open the home page"
Name: "{group}\Derby Audience Screen"; Filename: "{app}\Start Audience Screen.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\derby.ico"; Comment: "Open the projector display full screen"
Name: "{group}\Race day guide"; Filename: "https://github.com/seanpmayfield/PinewoodDerby#readme"; IconFilename: "{app}\derby.ico"
Name: "{group}\Race data folder"; Filename: "{#DataDir}"
Name: "{autodesktop}\Start Pinewood Derby"; Filename: "{app}\Start Derby.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\derby.ico"; Tasks: desktopicon
Name: "{autodesktop}\Derby Audience Screen"; Filename: "{app}\Start Audience Screen.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\derby.ico"; Tasks: desktopicon

[Run]
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""Pinewood Derby race server (TCP 8080)"""; Flags: runhidden; Tasks: firewall
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""Pinewood Derby race server (TCP 8080)"" dir=in action=allow protocol=TCP localport=8080 profile=any"; Flags: runhidden; Tasks: firewall
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""Pinewood Derby race server (TCP 8443)"""; Flags: runhidden; Tasks: firewall
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""Pinewood Derby race server (TCP 8443)"" dir=in action=allow protocol=TCP localport=8443 profile=any"; Flags: runhidden; Tasks: firewall
Filename: "{app}\Start Derby.cmd"; WorkingDir: "{app}"; Description: "Start Pinewood Derby now"; Flags: postinstall nowait skipifsilent shellexec

[UninstallRun]
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""Pinewood Derby race server (TCP 8080)"""; Flags: runhidden; RunOnceId: "fw8080"
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""Pinewood Derby race server (TCP 8443)"""; Flags: runhidden; RunOnceId: "fw8443"

[Code]
{ Stop a running race server (this install's node.exe) so its files can be replaced or removed. }
procedure StopServer();
var
  ResultCode: Integer;
begin
  Exec('powershell.exe',
    '-NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' + ExpandConstant('{app}') + '\runtime\*'' } | Stop-Process -Force"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopServer();
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    StopServer();
    DataDir := ExpandConstant('{#DataDir}');
    if (not UninstallSilent) and DirExists(DataDir) then
    begin
      if MsgBox('Also delete the race data (events, photos, replay clips, certificates) in' + #13#10 + DataDir + '?' + #13#10#13#10 +
                'Choose No to keep it for next year or for a reinstall.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
