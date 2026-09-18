Option Explicit

Dim shell, fileSystem, scriptDirectory, workspace, powerShellPath, startScript, command, result

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
workspace = fileSystem.GetParentFolderName(scriptDirectory)
powerShellPath = "C:\Program Files\PowerShell\7\pwsh.exe"
startScript = fileSystem.BuildPath(scriptDirectory, "start-codex-panel.ps1")

shell.CurrentDirectory = workspace
command = """" & powerShellPath & """ -NoProfile -NonInteractive -File """ & startScript & """"
result = shell.Run(command, 0, True)

WScript.Quit result
