#define MyAppName "Clash Switchboard"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Clash Switchboard"
#define MyAppExeName "clash-switchboard-host.exe"
#define ExtensionId "aggoidfhenhmcjdahailamnlingebmem"
#define NativeHostName "com.clash_switchboard.mihomo"

[Setup]
AppId={{7D5EB355-D829-49B9-B5DD-CLASHSWITCH01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\ClashSwitchboard
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=ClashSwitchboardSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayName={#MyAppName}

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面说明快捷方式"; GroupDescription: "附加选项:"; Flags: unchecked

[Files]
Source: "..\manifest.json"; DestDir: "{app}\extension"; Flags: ignoreversion
Source: "..\background.js"; DestDir: "{app}\extension"; Flags: ignoreversion
Source: "..\clash-api.js"; DestDir: "{app}\extension"; Flags: ignoreversion
Source: "..\popup.html"; DestDir: "{app}\extension"; Flags: ignoreversion
Source: "..\popup.js"; DestDir: "{app}\extension"; Flags: ignoreversion
Source: "..\options.html"; DestDir: "{app}\extension"; Flags: ignoreversion
Source: "..\options.js"; DestDir: "{app}\extension"; Flags: ignoreversion
Source: "..\styles.css"; DestDir: "{app}\extension"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\icons\*"; DestDir: "{app}\extension\icons"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\native-host\clash-switchboard-host.exe"; DestDir: "{app}\native-host"; Flags: ignoreversion
Source: "..\core\nb-mihomo.exe"; DestDir: "{app}\core"; Flags: ignoreversion
Source: "..\core\config.yaml"; DestDir: "{app}\core"; Flags: ignoreversion onlyifdoesntexist

[Icons]
Name: "{group}\使用说明"; Filename: "{app}\README.md"
Name: "{autodesktop}\Clash Switchboard 使用说明"; Filename: "{app}\README.md"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\{#NativeHostName}"; ValueType: string; ValueName: ""; ValueData: "{app}\native-host\{#NativeHostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Google\Chrome\Extensions\{#ExtensionId}"; ValueType: string; ValueName: "path"; ValueData: "{app}\extension\manifest.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Google\Chrome\Extensions\{#ExtensionId}"; ValueType: string; ValueName: "version"; ValueData: "{#MyAppVersion}"; Flags: uninsdeletekey

[Run]
Filename: "{cmd}"; Parameters: "/c taskkill /IM chrome.exe /F"; Description: "重启 Chrome 以加载插件"; Flags: runhidden skipifdoesntexist unchecked
Filename: "chrome.exe"; Parameters: "chrome://extensions/"; Description: "打开 Chrome 扩展管理页"; Flags: postinstall nowait skipifsilent unchecked

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  NativeJsonPath: String;
  NativeExePath: String;
  JsonText: String;
begin
  if CurStep = ssPostInstall then
  begin
    NativeJsonPath := ExpandConstant('{app}\native-host\{#NativeHostName}.json');
    NativeExePath := ExpandConstant('{app}\native-host\{#MyAppExeName}');
    StringChangeEx(NativeExePath, '\', '\\', True);
    JsonText := '{' + #13#10 +
      '  "name": "{#NativeHostName}",' + #13#10 +
      '  "description": "Mihomo launcher for Clash Switchboard",' + #13#10 +
      '  "path": "' + NativeExePath + '",' + #13#10 +
      '  "type": "stdio",' + #13#10 +
      '  "allowed_origins": [' + #13#10 +
      '    "chrome-extension://{#ExtensionId}/"' + #13#10 +
      '  ]' + #13#10 +
      '}';
    SaveStringToFile(NativeJsonPath, JsonText, False);
  end;
end;
