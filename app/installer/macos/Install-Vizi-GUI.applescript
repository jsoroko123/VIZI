set scriptDir to POSIX path of (path to me)
set shellDir to do shell script "dirname " & quoted form of scriptDir
set installerPath to shellDir & "/install-vizi-macos.sh"

display dialog "Vizi Installer" with title "Vizi" buttons {"Continue", "Cancel"} default button "Continue"

set defaultFolder to POSIX path of (path to home folder) & "Applications/Vizi"
set installPrompt to display dialog "Install folder:" default answer defaultFolder buttons {"Continue", "Cancel"} default button "Continue"
set installRoot to text returned of installPrompt

set pgPrompt to display dialog "Install PostgreSQL for Vizi?" buttons {"Yes", "No", "Cancel"} default button "Yes"
if button returned of pgPrompt is "Cancel" then error number -128
set skipPostgresArg to ""
if button returned of pgPrompt is "No" then set skipPostgresArg to " --skip-postgres-install"

set ollamaPrompt to display dialog "Install Ollama for local AI features?" buttons {"Yes", "No", "Cancel"} default button "Yes"
if button returned of ollamaPrompt is "Cancel" then error number -128
set skipOllamaArg to ""
if button returned of ollamaPrompt is "No" then set skipOllamaArg to " --skip-ollama-install"

set cmd to "bash " & quoted form of installerPath & " --install-root " & quoted form of installRoot & skipPostgresArg & skipOllamaArg

try
	do shell script cmd
	display dialog "Vizi installation completed successfully." buttons {"OK"} default button "OK" with title "Vizi Installer"
on error errMsg number errNum
	display dialog "Installation failed:" & return & errMsg buttons {"OK"} default button "OK" with title "Vizi Installer"
end try
