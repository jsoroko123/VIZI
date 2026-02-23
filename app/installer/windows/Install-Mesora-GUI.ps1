Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installScript = Join-Path $scriptDir "install-mesora.ps1"

function Quote-Arg {
  param([string]$Value)
  $text = [string]$Value
  if ($text -match '[\s"]') {
    return '"' + $text.Replace('"', '\"') + '"'
  }
  return $text
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Mesora Installer"
$form.Size = New-Object System.Drawing.Size(820, 720)
$form.MinimumSize = New-Object System.Drawing.Size(820, 720)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Install Mesora"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 14)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Configure options and run install. Live installer output appears below."
$subtitle.AutoSize = $true
$subtitle.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(70, 70, 70)
$subtitle.Location = New-Object System.Drawing.Point(22, 52)
$form.Controls.Add($subtitle)

$grpInstall = New-Object System.Windows.Forms.GroupBox
$grpInstall.Text = "Install Options"
$grpInstall.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$grpInstall.Location = New-Object System.Drawing.Point(20, 82)
$grpInstall.Size = New-Object System.Drawing.Size(780, 270)
$form.Controls.Add($grpInstall)

$lblRoot = New-Object System.Windows.Forms.Label
$lblRoot.Text = "Install folder"
$lblRoot.AutoSize = $true
$lblRoot.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblRoot.Location = New-Object System.Drawing.Point(16, 30)
$grpInstall.Controls.Add($lblRoot)

$txtRoot = New-Object System.Windows.Forms.TextBox
$txtRoot.Size = New-Object System.Drawing.Size(610, 24)
$txtRoot.Location = New-Object System.Drawing.Point(16, 50)
$txtRoot.Font = New-Object System.Drawing.Font("Consolas", 9)
$txtRoot.Text = "$env:LOCALAPPDATA\Mesora"
$grpInstall.Controls.Add($txtRoot)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Browse..."
$btnBrowse.Size = New-Object System.Drawing.Size(130, 28)
$btnBrowse.Location = New-Object System.Drawing.Point(636, 48)
$btnBrowse.Add_Click({
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = "Choose Mesora install folder"
  if (Test-Path $txtRoot.Text) { $dlg.SelectedPath = $txtRoot.Text }
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $txtRoot.Text = $dlg.SelectedPath
  }
})
$grpInstall.Controls.Add($btnBrowse)

$chkSkipPostgres = New-Object System.Windows.Forms.CheckBox
$chkSkipPostgres.Text = "Skip PostgreSQL install/config"
$chkSkipPostgres.AutoSize = $true
$chkSkipPostgres.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$chkSkipPostgres.Location = New-Object System.Drawing.Point(16, 90)
$grpInstall.Controls.Add($chkSkipPostgres)

$chkUseInstall = New-Object System.Windows.Forms.CheckBox
$chkUseInstall.Text = "Use npm install (instead of npm ci)"
$chkUseInstall.AutoSize = $true
$chkUseInstall.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$chkUseInstall.Location = New-Object System.Drawing.Point(16, 116)
$grpInstall.Controls.Add($chkUseInstall)

$lblPgPort = New-Object System.Windows.Forms.Label
$lblPgPort.Text = "PostgreSQL port"
$lblPgPort.AutoSize = $true
$lblPgPort.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblPgPort.Location = New-Object System.Drawing.Point(16, 150)
$grpInstall.Controls.Add($lblPgPort)

$txtPgPort = New-Object System.Windows.Forms.TextBox
$txtPgPort.Size = New-Object System.Drawing.Size(120, 24)
$txtPgPort.Location = New-Object System.Drawing.Point(16, 170)
$txtPgPort.Text = "5432"
$grpInstall.Controls.Add($txtPgPort)

$lblAiPort = New-Object System.Windows.Forms.Label
$lblAiPort.Text = "Mesora web/API port"
$lblAiPort.AutoSize = $true
$lblAiPort.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblAiPort.Location = New-Object System.Drawing.Point(160, 150)
$grpInstall.Controls.Add($lblAiPort)

$txtAiPort = New-Object System.Windows.Forms.TextBox
$txtAiPort.Size = New-Object System.Drawing.Size(120, 24)
$txtAiPort.Location = New-Object System.Drawing.Point(160, 170)
$txtAiPort.Text = "5055"
$grpInstall.Controls.Add($txtAiPort)

$lblOpcUaPort = New-Object System.Windows.Forms.Label
$lblOpcUaPort.Text = "OPC UA port"
$lblOpcUaPort.AutoSize = $true
$lblOpcUaPort.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblOpcUaPort.Location = New-Object System.Drawing.Point(304, 150)
$grpInstall.Controls.Add($lblOpcUaPort)

$txtOpcUaPort = New-Object System.Windows.Forms.TextBox
$txtOpcUaPort.Size = New-Object System.Drawing.Size(120, 24)
$txtOpcUaPort.Location = New-Object System.Drawing.Point(304, 170)
$txtOpcUaPort.Text = "4840"
$grpInstall.Controls.Add($txtOpcUaPort)

$lblPgUser = New-Object System.Windows.Forms.Label
$lblPgUser.Text = "PostgreSQL admin username"
$lblPgUser.AutoSize = $true
$lblPgUser.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblPgUser.Location = New-Object System.Drawing.Point(16, 204)
$grpInstall.Controls.Add($lblPgUser)

$txtPgUser = New-Object System.Windows.Forms.TextBox
$txtPgUser.Size = New-Object System.Drawing.Size(360, 24)
$txtPgUser.Location = New-Object System.Drawing.Point(16, 224)
$txtPgUser.Text = "postgres"
$grpInstall.Controls.Add($txtPgUser)

$lblPgPassword = New-Object System.Windows.Forms.Label
$lblPgPassword.Text = "PostgreSQL admin password"
$lblPgPassword.AutoSize = $true
$lblPgPassword.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$lblPgPassword.Location = New-Object System.Drawing.Point(396, 204)
$grpInstall.Controls.Add($lblPgPassword)

$txtPgPassword = New-Object System.Windows.Forms.TextBox
$txtPgPassword.Size = New-Object System.Drawing.Size(360, 24)
$txtPgPassword.Location = New-Object System.Drawing.Point(396, 224)
$txtPgPassword.Text = "postgres"
$txtPgPassword.UseSystemPasswordChar = $true
$grpInstall.Controls.Add($txtPgPassword)

$grpLog = New-Object System.Windows.Forms.GroupBox
$grpLog.Text = "Installer Output (PowerShell)"
$grpLog.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$grpLog.Location = New-Object System.Drawing.Point(20, 362)
$grpLog.Size = New-Object System.Drawing.Size(780, 250)
$form.Controls.Add($grpLog)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.WordWrap = $false
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(20, 24, 31)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(222, 235, 247)
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 9)
$txtLog.Location = New-Object System.Drawing.Point(12, 24)
$txtLog.Size = New-Object System.Drawing.Size(754, 190)
$grpLog.Controls.Add($txtLog)

$btnCopyLog = New-Object System.Windows.Forms.Button
$btnCopyLog.Text = "Copy Log"
$btnCopyLog.Size = New-Object System.Drawing.Size(100, 28)
$btnCopyLog.Location = New-Object System.Drawing.Point(666, 218)
$btnCopyLog.Add_Click({
  [System.Windows.Forms.Clipboard]::SetText($txtLog.Text)
})
$grpLog.Controls.Add($btnCopyLog)

$status = New-Object System.Windows.Forms.Label
$status.Text = "Ready."
$status.AutoSize = $true
$status.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$status.ForeColor = [System.Drawing.Color]::FromArgb(30, 85, 30)
$status.Location = New-Object System.Drawing.Point(22, 624)
$form.Controls.Add($status)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = "Blocks"
$progress.Location = New-Object System.Drawing.Point(22, 648)
$progress.Size = New-Object System.Drawing.Size(548, 10)
$form.Controls.Add($progress)

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = "Install"
$btnInstall.Size = New-Object System.Drawing.Size(110, 34)
$btnInstall.Location = New-Object System.Drawing.Point(580, 631)
$btnInstall.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnInstall)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "Close"
$btnCancel.Size = New-Object System.Drawing.Size(110, 34)
$btnCancel.Location = New-Object System.Drawing.Point(690, 631)
$btnCancel.Add_Click({ $form.Close() })
$form.Controls.Add($btnCancel)

$setInputsEnabled = {
  param([bool]$Enabled)
  $txtRoot.Enabled = $Enabled
  $btnBrowse.Enabled = $Enabled
  $chkSkipPostgres.Enabled = $Enabled
  $chkUseInstall.Enabled = $Enabled
  $txtPgPort.Enabled = $Enabled
  $txtAiPort.Enabled = $Enabled
  $txtOpcUaPort.Enabled = $Enabled
  $txtPgUser.Enabled = $Enabled -and (-not $chkSkipPostgres.Checked)
  $txtPgPassword.Enabled = $Enabled -and (-not $chkSkipPostgres.Checked)
  $lblPgUser.Enabled = $Enabled -and (-not $chkSkipPostgres.Checked)
  $lblPgPassword.Enabled = $Enabled -and (-not $chkSkipPostgres.Checked)
}

$chkSkipPostgres.Add_CheckedChanged({
  & $setInputsEnabled $true
})
& $setInputsEnabled $true

$appendLog = {
  param([string]$Line)
  if ([string]::IsNullOrWhiteSpace($Line)) { return }
  if ($txtLog.IsDisposed) { return }
  $msg = $Line
  $write = [System.Windows.Forms.MethodInvoker]{
    if ($txtLog.IsDisposed) { return }
    $txtLog.AppendText($msg + [Environment]::NewLine)
    $txtLog.SelectionStart = $txtLog.TextLength
    $txtLog.ScrollToCaret()
  }
  if ($txtLog.InvokeRequired) {
    try {
      [void]$txtLog.Invoke($write)
    } catch {}
  } else {
    $write.Invoke()
  }
}

$onInstallFinished = {
  param([int]$ExitCode)
  if ($form.IsDisposed) { return }
  $code = [int]$ExitCode
  $finish = [System.Windows.Forms.MethodInvoker]{
    if ($form.IsDisposed) { return }
    $btnInstall.Enabled = $true
    $btnCancel.Enabled = $true
    $progress.Style = "Blocks"
    & $setInputsEnabled $true
    if ($code -eq 0) {
      $status.Text = "Install completed successfully."
      $status.ForeColor = [System.Drawing.Color]::FromArgb(30, 85, 30)
      [System.Windows.Forms.MessageBox]::Show(
        "Mesora installation completed successfully.",
        "Mesora Installer",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
      ) | Out-Null
    } else {
      $status.Text = "Install failed. Review installer output."
      $status.ForeColor = [System.Drawing.Color]::FromArgb(148, 16, 16)
      [System.Windows.Forms.MessageBox]::Show(
        "Installer failed. Review the output in this window and try again.",
        "Mesora Installer",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
      ) | Out-Null
    }
  }
  if ($form.InvokeRequired) {
    try {
      [void]$form.Invoke($finish)
    } catch {}
  } else {
    $finish.Invoke()
  }
}

$btnInstall.Add_Click({
  try {
    $pgPort = 0
    $aiPort = 0
    $opcUaPort = 0
    if (-not [int]::TryParse($txtPgPort.Text, [ref]$pgPort) -or $pgPort -lt 1 -or $pgPort -gt 65535) {
      [System.Windows.Forms.MessageBox]::Show(
        "PostgreSQL port must be a number between 1 and 65535.",
        "Mesora Installer",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      ) | Out-Null
      return
    }
    if (-not [int]::TryParse($txtAiPort.Text, [ref]$aiPort) -or $aiPort -lt 1 -or $aiPort -gt 65535) {
      [System.Windows.Forms.MessageBox]::Show(
        "Mesora web/API port must be a number between 1 and 65535.",
        "Mesora Installer",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      ) | Out-Null
      return
    }
    if (-not [int]::TryParse($txtOpcUaPort.Text, [ref]$opcUaPort) -or $opcUaPort -lt 1 -or $opcUaPort -gt 65535) {
      [System.Windows.Forms.MessageBox]::Show(
        "OPC UA port must be a number between 1 and 65535.",
        "Mesora Installer",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      ) | Out-Null
      return
    }

    if ([string]::IsNullOrWhiteSpace($txtRoot.Text)) {
      [System.Windows.Forms.MessageBox]::Show(
        "Please select an install folder.",
        "Mesora Installer",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      ) | Out-Null
      return
    }
    if (-not (Test-Path $installScript)) {
      [System.Windows.Forms.MessageBox]::Show(
        "Install script not found: $installScript",
        "Mesora Installer",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
      ) | Out-Null
      return
    }
    if (-not $chkSkipPostgres.Checked) {
      if ([string]::IsNullOrWhiteSpace($txtPgUser.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
          "Please enter PostgreSQL admin username.",
          "Mesora Installer",
          [System.Windows.Forms.MessageBoxButtons]::OK,
          [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
      }
      if ([string]::IsNullOrWhiteSpace($txtPgPassword.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
          "Please enter PostgreSQL admin password.",
          "Mesora Installer",
          [System.Windows.Forms.MessageBoxButtons]::OK,
          [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
      }
    }

    $argList = @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", $installScript,
      "-InstallRoot", $txtRoot.Text,
      "-PostgresPort", "$pgPort",
      "-AiServerPort", "$aiPort",
      "-OpcUaPort", "$opcUaPort"
    )
    if ($chkSkipPostgres.Checked) { $argList += "-SkipPostgresInstall" }
    if ($chkUseInstall.Checked) { $argList += "-UseNpmInstall" }
    if (-not $chkSkipPostgres.Checked) {
      $argList += @("-PostgresSuperUser", $txtPgUser.Text)
      $argList += @("-PostgresSuperPassword", $txtPgPassword.Text)
    }

    $cmdLine = ($argList | ForEach-Object { Quote-Arg $_ }) -join " "
    $txtLog.Clear()
    & $appendLog ("[" + (Get-Date).ToString("HH:mm:ss") + "] Starting installer...")
    & $appendLog ("powershell.exe " + $cmdLine)

    $btnInstall.Enabled = $false
    $btnCancel.Enabled = $false
    & $setInputsEnabled $false
    $status.Text = "Installing... this can take several minutes."
    $status.ForeColor = [System.Drawing.Color]::FromArgb(34, 73, 135)
    $progress.Style = "Marquee"
    $progress.MarqueeAnimationSpeed = 20
    $form.Refresh()

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = $cmdLine
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true
    $proc.SynchronizingObject = $form

    $proc.add_OutputDataReceived({
      param($sender, $eventArgs)
      try {
        if ($eventArgs.Data -ne $null) {
          & $appendLog $eventArgs.Data
        }
      } catch {}
    })
    $proc.add_ErrorDataReceived({
      param($sender, $eventArgs)
      try {
        if ($eventArgs.Data -ne $null) {
          & $appendLog ("[ERR] " + $eventArgs.Data)
        }
      } catch {}
    })
    $proc.add_Exited({
      param($sender, $eventArgs)
      try {
        $code = 1
        try { $code = [int]$sender.ExitCode } catch {}
        & $appendLog ("[" + (Get-Date).ToString("HH:mm:ss") + "] Installer exited with code " + $code + ".")
        & $onInstallFinished $code
      } catch {
        try { & $appendLog ("[ERR] GUI exit handler failed: " + $_.Exception.Message) } catch {}
        & $onInstallFinished 1
      } finally {
        try { $sender.Dispose() } catch {}
      }
    })

    if (-not $proc.Start()) {
      & $appendLog "[ERR] Failed to start installer process."
      & $onInstallFinished 1
      return
    }
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
  } catch {
    try {
      & $appendLog ("[ERR] Installer GUI exception: " + $_.Exception.Message)
    } catch {}
    & $onInstallFinished 1
  }
})

[void]$form.ShowDialog()
