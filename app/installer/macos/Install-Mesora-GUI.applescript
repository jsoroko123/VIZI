use AppleScript version "2.4"
use scripting additions

on run argv
	if (count of argv) < 1 then error "Missing installer directory."
	set installerShellDir to item 1 of argv
	set installerPath to installerShellDir & "/install-vizi-macos.sh"
	
	display dialog "Mesora Installer" buttons {"Continue", "Cancel"} default button "Continue"
	
	set defaultFolder to POSIX path of (path to home folder) & "Applications/Mesora"
	set installPrompt to display dialog "Install folder:" default answer defaultFolder buttons {"Continue", "Cancel"} default button "Continue"
	set installRoot to text returned of installPrompt
	
	set pgPrompt to display dialog "Install PostgreSQL for Mesora?" buttons {"Yes", "No", "Cancel"} default button "Yes"
	if button returned of pgPrompt is "Cancel" then error number -128
	set skipPostgresArg to ""
	set pgUserArg to ""
	set pgPasswordArg to ""
	if button returned of pgPrompt is "No" then set skipPostgresArg to " --skip-postgres-install"
	if button returned of pgPrompt is "Yes" then
		set pgUserPrompt to display dialog "PostgreSQL admin username:" default answer "postgres" buttons {"Continue", "Cancel"} default button "Continue"
		set pgUser to text returned of pgUserPrompt
		if pgUser is "" then error "PostgreSQL username is required."
		set pgPassPrompt to display dialog "PostgreSQL admin password:" default answer "postgres" with hidden answer buttons {"Continue", "Cancel"} default button "Continue"
		set pgPassword to text returned of pgPassPrompt
		if pgPassword is "" then error "PostgreSQL password is required."
		set pgUserArg to " --postgres-super-user " & quoted form of pgUser
		set pgPasswordArg to " --postgres-super-password " & quoted form of pgPassword
	end if
	
	set ollamaPrompt to display dialog "Install Ollama for local AI features?" buttons {"Yes", "No", "Cancel"} default button "Yes"
	if button returned of ollamaPrompt is "Cancel" then error number -128
	set skipOllamaArg to ""
	if button returned of ollamaPrompt is "No" then set skipOllamaArg to " --skip-ollama-install"
	
	set cmd to "bash " & quoted form of installerPath & " --install-root " & quoted form of installRoot & skipPostgresArg & pgUserArg & pgPasswordArg & skipOllamaArg
	
	try
		do shell script cmd
		display dialog "Mesora installation completed successfully." buttons {"OK"} default button "OK"
	on error errMsg number errNum
		display dialog "Installation failed:" & return & errMsg buttons {"OK"} default button "OK"
	end try
end run
