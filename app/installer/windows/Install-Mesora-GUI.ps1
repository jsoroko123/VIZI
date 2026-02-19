Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installScript = Join-Path $scriptDir "install-vizi.ps1"

$form = New-Object System.Windows.Forms.Form
$form.Text = "Mesora Installer"
$form.Size = New-Object System.Drawing.Size(560, 470)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

$title = New-Object System.Windows.Forms.Label
$title.Text = "Install Mesora"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 18)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Choose install options and click Install."
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(22, 52)
$form.Controls.Add($subtitle)

$lblRoot = New-Object System.Windows.Forms.Label
$lblRoot.Text = "Install folder"
$lblRoot.AutoSize = $true
$lblRoot.Location = New-Object System.Drawing.Point(22, 92)
$form.Controls.Add($lblRoot)

$txtRoot = New-Object System.Windows.Forms.TextBox
$txtRoot.Size = New-Object System.Drawing.Size(410, 24)
$txtRoot.Location = New-Object System.Drawing.Point(22, 112)
$txtRoot.Text = "$env:LOCALAPPDATA\Mesora"
$form.Controls.Add($txtRoot)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Browse..."
$btnBrowse.Size = New-Object System.Drawing.Size(90, 26)
$btnBrowse.Location = New-Object System.Drawing.Point(442, 110)
$btnBrowse.Add_Click({
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = "Choose Mesora install folder"
  if (Test-Path $txtRoot.Text) { $dlg.SelectedPath = $txtRoot.Text }
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $txtRoot.Text = $dlg.SelectedPath
  }
})
$form.Controls.Add($btnBrowse)

$chkSkipPostgres = New-Object System.Windows.Forms.CheckBox
$chkSkipPostgres.Text = "Skip PostgreSQL install/config"
$chkSkipPostgres.AutoSize = $true
$chkSkipPostgres.Location = New-Object System.Drawing.Point(22, 160)
$form.Controls.Add($chkSkipPostgres)

$chkSkipOllama = New-Object System.Windows.Forms.CheckBox
$chkSkipOllama.Text = "Skip Ollama install/config"
$chkSkipOllama.AutoSize = $true
$chkSkipOllama.Location = New-Object System.Drawing.Point(22, 188)
$form.Controls.Add($chkSkipOllama)

$chkUseInstall = New-Object System.Windows.Forms.CheckBox
$chkUseInstall.Text = "Use npm install (instead of npm ci)"
$chkUseInstall.AutoSize = $true
$chkUseInstall.Location = New-Object System.Drawing.Point(22, 216)
$form.Controls.Add($chkUseInstall)

$lblPgUser = New-Object System.Windows.Forms.Label
$lblPgUser.Text = "PostgreSQL admin username"
$lblPgUser.AutoSize = $true
$lblPgUser.Location = New-Object System.Drawing.Point(22, 248)
$form.Controls.Add($lblPgUser)

$txtPgUser = New-Object System.Windows.Forms.TextBox
$txtPgUser.Size = New-Object System.Drawing.Size(250, 24)
$txtPgUser.Location = New-Object System.Drawing.Point(22, 268)
$txtPgUser.Text = "postgres"
$form.Controls.Add($txtPgUser)

$lblPgPassword = New-Object System.Windows.Forms.Label
$lblPgPassword.Text = "PostgreSQL admin password"
$lblPgPassword.AutoSize = $true
$lblPgPassword.Location = New-Object System.Drawing.Point(292, 248)
$form.Controls.Add($lblPgPassword)

$txtPgPassword = New-Object System.Windows.Forms.TextBox
$txtPgPassword.Size = New-Object System.Drawing.Size(240, 24)
$txtPgPassword.Location = New-Object System.Drawing.Point(292, 268)
$txtPgPassword.Text = "postgres"
$txtPgPassword.UseSystemPasswordChar = $true
$form.Controls.Add($txtPgPassword)

$hintPg = New-Object System.Windows.Forms.Label
$hintPg.Text = "Used only for PostgreSQL setup. For new installs, defaults are usually fine."
$hintPg.AutoSize = $true
$hintPg.Location = New-Object System.Drawing.Point(22, 296)
$form.Controls.Add($hintPg)

$status = New-Object System.Windows.Forms.Label
$status.Text = ""
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(22, 336)
$form.Controls.Add($status)

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = "Install"
$btnInstall.Size = New-Object System.Drawing.Size(110, 34)
$btnInstall.Location = New-Object System.Drawing.Point(322, 372)
$form.Controls.Add($btnInstall)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "Cancel"
$btnCancel.Size = New-Object System.Drawing.Size(110, 34)
$btnCancel.Location = New-Object System.Drawing.Point(442, 372)
$btnCancel.Add_Click({ $form.Close() })
$form.Controls.Add($btnCancel)

$updatePgFieldState = {
  $enabled = -not $chkSkipPostgres.Checked
  $lblPgUser.Enabled = $enabled
  $txtPgUser.Enabled = $enabled
  $lblPgPassword.Enabled = $enabled
  $txtPgPassword.Enabled = $enabled
  $hintPg.Enabled = $enabled
}
$chkSkipPostgres.Add_CheckedChanged($updatePgFieldState)
& $updatePgFieldState

$btnInstall.Add_Click({
  if ([string]::IsNullOrWhiteSpace($txtRoot.Text)) {
    [System.Windows.Forms.MessageBox]::Show("Please select an install folder.", "Mesora Installer", "OK", "Warning") | Out-Null
    return
  }
  if (-not (Test-Path $installScript)) {
    [System.Windows.Forms.MessageBox]::Show("Install script not found: $installScript", "Mesora Installer", "OK", "Error") | Out-Null
    return
  }
  if (-not $chkSkipPostgres.Checked) {
    if ([string]::IsNullOrWhiteSpace($txtPgUser.Text)) {
      [System.Windows.Forms.MessageBox]::Show("Please enter PostgreSQL admin username.", "Mesora Installer", "OK", "Warning") | Out-Null
      return
    }
    if ([string]::IsNullOrWhiteSpace($txtPgPassword.Text)) {
      [System.Windows.Forms.MessageBox]::Show("Please enter PostgreSQL admin password.", "Mesora Installer", "OK", "Warning") | Out-Null
      return
    }
  }

  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $installScript,
    "-InstallRoot", $txtRoot.Text
  )
  if ($chkSkipPostgres.Checked) { $args += "-SkipPostgresInstall" }
  if ($chkSkipOllama.Checked) { $args += "-SkipOllamaInstall" }
  if ($chkUseInstall.Checked) { $args += "-UseNpmInstall" }
  if (-not $chkSkipPostgres.Checked) {
    $args += @("-PostgresSuperUser", $txtPgUser.Text)
    $args += @("-PostgresSuperPassword", $txtPgPassword.Text)
  }

  $btnInstall.Enabled = $false
  $btnCancel.Enabled = $false
  $status.Text = "Installing... this can take several minutes."
  $form.Refresh()

  $proc = Start-Process -FilePath "powershell" -ArgumentList $args -Wait -PassThru
  if ($proc.ExitCode -eq 0) {
    [System.Windows.Forms.MessageBox]::Show("Mesora installation completed successfully.", "Mesora Installer", "OK", "Information") | Out-Null
    $form.Close()
  } else {
    [System.Windows.Forms.MessageBox]::Show("Installer failed. Please review the PowerShell output/log and try again.", "Mesora Installer", "OK", "Error") | Out-Null
    $status.Text = "Install failed."
    $btnInstall.Enabled = $true
    $btnCancel.Enabled = $true
  }
})

[void]$form.ShowDialog()
