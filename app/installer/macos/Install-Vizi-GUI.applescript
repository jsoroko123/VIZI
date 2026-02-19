use AppleScript version "2.4"
use scripting additions

on trimText(v)
	set s to (v as text)
	repeat while s is not "" and character 1 of s is in {" ", tab}
		set s to text 2 thru -1 of s
	end repeat
	repeat while s is not "" and character -1 of s is in {" ", tab}
		set s to text 1 thru -2 of s
	end repeat
	return s
end trimText

on valueForKey(configText, keyName, defaultValue)
	set keyPrefix to keyName & "="
	set oldTID to AppleScript's text item delimiters
	set AppleScript's text item delimiters to return
	set linesList to text items of configText
	set AppleScript's text item delimiters to oldTID
	repeat with oneLine in linesList
		set rawLine to contents of oneLine
		set cleanLine to my trimText(rawLine)
		if cleanLine starts with keyPrefix then
			return my trimText(text ((length of keyPrefix) + 1) thru -1 of cleanLine)
		end if
	end repeat
	return defaultValue
end valueForKey

on isEnabled(rawValue)
	set v to my trimText(rawValue)
	ignoring case
		if v is "1" or v is "true" or v is "yes" or v is "y" then return true
	end ignoring
	return false
end isEnabled

on run argv
	if (count of argv) < 1 then error "Missing installer directory."
	set installerShellDir to item 1 of argv
	set installerPath to installerShellDir & "/install-mesora-macos.sh"

	set defaultFolder to (do shell script "echo $HOME") & "/Applications/Mesora"
	set configDefault to "install_root=" & defaultFolder & return & ¬
		"install_postgres=yes" & return & ¬
		"postgres_super_user=postgres" & return & ¬
		"postgres_super_password=postgres" & return & ¬
		"install_ollama=yes"
	set promptText to "Mesora Installer Configuration" & return & return & ¬
		"Edit values below, then click Install." & return & ¬
		"Use yes/no for install_postgres and install_ollama."
	set formPrompt to display dialog promptText default answer configDefault buttons {"Install", "Cancel"} default button "Install"
	set configText to text returned of formPrompt

	set installRoot to my valueForKey(configText, "install_root", defaultFolder)
	if installRoot is "" then set installRoot to defaultFolder
	set installPostgres to my isEnabled(my valueForKey(configText, "install_postgres", "yes"))
	set pgUser to my valueForKey(configText, "postgres_super_user", "postgres")
	set pgPassword to my valueForKey(configText, "postgres_super_password", "postgres")
	set installOllama to my isEnabled(my valueForKey(configText, "install_ollama", "yes"))

	set cmd to "bash " & quoted form of installerPath & " --install-root " & quoted form of installRoot
	if installPostgres is false then
		set cmd to cmd & " --skip-postgres-install"
	else
		if pgUser is not "" then set cmd to cmd & " --postgres-super-user " & quoted form of pgUser
		if pgPassword is not "" then set cmd to cmd & " --postgres-super-password " & quoted form of pgPassword
	end if
	if installOllama is false then set cmd to cmd & " --skip-ollama-install"
	
	try
		do shell script cmd
		display notification "Mesora installation completed successfully." with title "Mesora Installer"
	on error errMsg number errNum
		display dialog "Installation failed:" & return & errMsg buttons {"OK"} default button "OK"
	end try
end run
