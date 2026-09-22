; Inno Setup script for the Framer .exe installer.
; Build with: iscc /DSourceRoot=..\.. framer-setup.iss
;
; Installs into the per-user CEP extension folder, so no admin rights and no
; UAC prompt. The panel shows up under Window > Extensions after a restart.

#ifndef SourceRoot
  #define SourceRoot "..\.."
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

#define AppName     "Framer"
#define AppPublisher "NiteRix"
#define ExtensionId "com.niterix.framer"

[Setup]
AppId={{21866D4D-118E-4CC3-A75C-818EAF05A1E0}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={userappdata}\Adobe\CEP\extensions\{#ExtensionId}
DisableDirPage=yes
DisableProgramGroupPage=yes
UsePreviousAppDir=no
PrivilegesRequired=lowest
OutputDir={#SourceRoot}\dist
OutputBaseFilename=Framer-{#AppVersion}-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName} for Premiere Pro
AppSupportURL=https://github.com/NiteRix/Framer
AppUpdatesURL=https://github.com/NiteRix/Framer/releases

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceRoot}\extension\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
; CEP refuses to load unsigned extensions unless debug mode is on. One key per
; CEP generation, covering Premiere Pro CC 2015 through current releases.
Root: HKCU; Subkey: "Software\Adobe\CSXS.6";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.7";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.8";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

[UninstallDelete]
Type: dirifempty; Name: "{app}"

[Code]
function InitializeSetup(): Boolean;
var
  Running: Boolean;
  ResultCode: Integer;
begin
  Result := True;
  Running := Exec('cmd.exe',
    '/c tasklist /fi "imagename eq Adobe Premiere Pro.exe" | find /i "Adobe Premiere Pro.exe"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
  if Running then
    MsgBox('Premiere Pro is currently open.' + #13#10 + #13#10 +
           'Framer will install fine, but the panel only appears after you ' +
           'restart Premiere Pro.', mbInformation, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    MsgBox('Framer is installed.' + #13#10 + #13#10 +
           'Restart Premiere Pro and open it from:' + #13#10 +
           '    Window  >  Extensions  >  Framer' + #13#10 + #13#10 +
           'One setting matters: Edit > Preferences > Media >' + #13#10 +
           'Default Media Scaling must be set to "None", or Premiere' + #13#10 +
           'rescales the clips Framer places and the layers will not' + #13#10 +
           'line up with the panel preview.',
           mbInformation, MB_OK);
end;
