<#
.SYNOPSIS
  Set up a JMac Memory OS memory repo on Windows (x64 or ARM64).

.DESCRIPTION
  Checks for Git and Python 3.8+, creates the memory repo with memos-init,
  installs the pre-commit format check, and optionally connects it to a
  private GitHub repo.

  Works in Windows PowerShell 5.1 and PowerShell 7+. Nothing is installed
  system-wide; missing prerequisites are reported with the winget command
  that installs them.

.PARAMETER Path
  Where the memory repo goes. Default: $HOME\my-memory

.PARAMETER Remote
  Optional. A GitHub URL (https://github.com/<you>/my-memory.git) to add as
  origin and push to. Create the repo on GitHub first, and make it PRIVATE.

.EXAMPLE
  .\windows\Setup-Memory.ps1
.EXAMPLE
  .\windows\Setup-Memory.ps1 -Path D:\memory -Remote https://github.com/me/my-memory.git
#>
[CmdletBinding()]
param(
    [string]$Path = (Join-Path $HOME 'my-memory'),
    [string]$Remote
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "  ok   $msg" -ForegroundColor Green }

Write-Host "JMac Memory OS - Windows setup" -ForegroundColor Cyan
Write-Host "  OS   $([Environment]::OSVersion.VersionString), $env:PROCESSOR_ARCHITECTURE"

# --- Git -------------------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail "Git not found. Install it with:  winget install --id Git.Git -e"
}
Ok (git --version)

$gitName  = git config --global user.name
$gitEmail = git config --global user.email
if (-not $gitName -or -not $gitEmail) {
    Fail ("Git has no identity yet. Run:`n" +
          "  git config --global user.name  `"Your Name`"`n" +
          "  git config --global user.email you@example.com")
}
Ok "git identity $gitName <$gitEmail>"

# --- Python ----------------------------------------------------------------
# `python3`/`python` may be the Microsoft Store stub (on PATH, runs nothing),
# so each candidate is probed by actually running it.
$python = $null
foreach ($cand in @(@('py', '-3'), @('python'), @('python3'))) {
    $exe = $cand[0]
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    $args_ = @($cand | Select-Object -Skip 1) + @('-c', 'import sys; sys.exit(sys.version_info < (3, 8))')
    & $exe @args_ 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $python = $cand; break }
}
if (-not $python) {
    Fail "Python 3.8+ not found. Install it with:  winget install --id Python.Python.3.12 -e"
}
$pyExe  = $python[0]
$pyArgs = @($python | Select-Object -Skip 1)
Ok ("python " + (& $pyExe @pyArgs --version 2>&1))

# --- Create the repo -------------------------------------------------------
$init = Join-Path $repoRoot 'bin\memos-init'
& $pyExe @pyArgs $init $Path --git
if ($LASTEXITCODE -ne 0) { Fail "memos-init failed" }

$reader = Join-Path $Path '.memos\read.py'
& $pyExe @pyArgs $reader --dir $Path check
if ($LASTEXITCODE -ne 0) { Fail "format check failed on the new repo" }

# --- Optional: connect to GitHub -------------------------------------------
if ($Remote) {
    Push-Location $Path
    try {
        $existing = git remote 2>$null
        if ($existing -contains 'origin') { git remote set-url origin $Remote }
        else { git remote add origin $Remote }
        git push -u origin main
        if ($LASTEXITCODE -ne 0) { Fail "push failed - check the repo exists and you are signed in to GitHub" }
        Ok "pushed to $Remote"
    } finally { Pop-Location }
}

Write-Host ""
Write-Host "Done. Memory repo: $Path" -ForegroundColor Cyan
Write-Host "Try:  $pyExe $($pyArgs -join ' ') `"$reader`" --dir `"$Path`" list"
if (-not $Remote) {
    Write-Host "Next: create a PRIVATE repo on GitHub, then re-run with -Remote <url>."
}
Write-Host "Then connect your tools: see clients\windows.md"
