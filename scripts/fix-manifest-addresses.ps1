# Re-derive the Address column in the OneNote "Sales Audio" manifests.
#
# The original export (process.ps1/process2.ps1) set Address to the single line
# immediately after the company name, which was frequently the wrong thing - a
# contact ("Leonardo DRS - George Olson"), a LinkedIn/Salesforce link, pipe
# garbage, or blank. This reads the OneNote pages again and, for each recording,
# scans the lines in that stop (nearest above the audio first, then below as a
# fallback) and picks the nearest line that actually looks like a US mailing
# address - rejecting names, links, emails, phones, and pipe junk.
#
# It rewrites ONLY the Address column of each existing manifest.csv in place.
# Every other column, every row, and the row order are preserved (re-serialized
# with the same minimal-quoting rule the export used). Audio files are untouched.
# A recording is matched back to its OneNote audio by (Section, Page,
# OriginalName), the columns the manifest already stores. Rows that no longer
# match a OneNote audio are left exactly as-is.
#
# Requires the OneNote desktop app running with the visits notebook available
# (same COM requirement as the original export). Dry-run by default.
#
#   powershell -ExecutionPolicy Bypass -File scripts\fix-manifest-addresses.ps1           # preview
#   powershell -ExecutionPolicy Bypass -File scripts\fix-manifest-addresses.ps1 -Write    # apply

param(
  [switch]$Write,
  [string]$Base = "C:\Users\justin.king\Downloads\Sales Audio",
  [string]$Group = "Completed Trips in 2026"
)
$ErrorActionPreference = "Stop"
$nsUri = "http://schemas.microsoft.com/office/onenote/2013/onenote"
$audioExt = @('.mp4','.m4a','.3gp','.wma','.mp3','.aac','.wav','.amr','.opus','.ogg')
$driveRe = '^\d+\s*min'
$captionRe = '^Audio recording started:'

# --- address qualification (mirrors seed-customer-addresses.mjs isUsableAddress) ---
function Test-RejectTokens($s) {
  return ($s -match '(?i)linkedin' -or $s -match '(?i)https?://' -or $s -match '(?i)salesforce' -or $s.Contains('@') -or $s.Contains('|'))
}
function Test-PhoneOnly($s) {
  # Mostly punctuation + >=7 digits and no letters => a phone number, not an address.
  return ($s -notmatch '[A-Za-z]' -and (($s -replace '\D','').Length -ge 7))
}
function Test-Address($s) {
  $s = $s.Trim()
  if ($s.Length -lt 6) { return $false }
  if (Test-RejectTokens $s) { return $false }        # linkedin / http / salesforce / @ / |
  if ($s -notmatch '\d') { return $false }           # must contain a digit
  if ($s -notmatch ',') { return $false }            # a US mailing address has a comma (…City, ST)
  if (Test-PhoneOnly $s) { return $false }           # bare phone number
  # Require real address STRUCTURE, not just any 5-digit run (a stray "10500"
  # demo-unit number in a sentence must NOT read as a ZIP). Qualify on:
  #   a) ", City, ST 91325"  — a state abbrev immediately followed by a ZIP, or
  #   b) a street-number-led line ending in ", ST", or
  #   c) a street-number-led line that also carries a ZIP.
  $hasCityStateZip = [regex]::IsMatch($s, ',\s*[A-Z]{2}\.?\s+\d{5}(-\d{4})?\b')
  $hasStreetState = (Test-Street $s) -and [regex]::IsMatch($s, ',\s*[A-Z]{2}\b')
  $hasStreetZip = (Test-Street $s) -and [regex]::IsMatch($s, '\b\d{5}(-\d{4})?\b')
  return ($hasCityStateZip -or $hasStreetState -or $hasStreetZip)
}
# A line that starts with a street number ("123 Main St").
function Test-Street($s) { return [regex]::IsMatch($s.Trim(), '^\d{1,6}\s+\S') }

# Given item indices in nearest-first order, choose the best address line.
# Prefer a line with a street number; else the nearest qualifying line, and if
# that is a bare city/state/zip line, stitch on a street line sitting just above.
function Pick-Address($items, $idxList) {
  $qualified = @($idxList | Where-Object { Test-Address $items[$_].text })
  if ($qualified.Count -eq 0) { return '' }
  $street = @($qualified | Where-Object { Test-Street $items[$_].text })
  if ($street.Count -gt 0) { $pick = $street[0] } else { $pick = $qualified[0] }
  $addr = $items[$pick].text.Trim()
  if (-not (Test-Street $addr) -and ($pick - 1) -ge 0 -and $items[$pick - 1].kind -eq 'T') {
    $prev = $items[$pick - 1].text.Trim()
    if ((Test-Street $prev) -and -not (Test-RejectTokens $prev) -and ($prev -notmatch ',\s*[A-Z]{2}\b')) {
      $addr = "$prev, $addr"
    }
  }
  return $addr
}

# --- read OneNote: build map "Section|Page|OriginalName" -> address -----------
$on = New-Object -ComObject OneNote.Application
$xml = ""; $ok = $false
for ($i = 1; $i -le 5 -and -not $ok; $i++) { try { $on.GetHierarchy("", 4, [ref]$xml); $ok = $true } catch { Start-Sleep 4 } }
if (-not $ok) { Write-Error "Could not reach OneNote. Open the OneNote desktop app (with the visits notebook) and retry."; exit 1 }
[xml]$h = $xml
$nsm = New-Object System.Xml.XmlNamespaceManager($h.NameTable); $nsm.AddNamespace("one", $nsUri)

$addrByKey = @{}
$sections = $h.SelectNodes("//one:SectionGroup[@name='$Group']//one:Section", $nsm)
foreach ($sec in $sections) {
  $secName = $sec.name
  foreach ($p in $sec.SelectNodes("one:Page", $nsm)) {
    $pxml = ""; $g = $false
    for ($j = 1; $j -le 4 -and -not $g; $j++) { try { $on.GetPageContent($p.ID, [ref]$pxml, 0); $g = $true } catch { Start-Sleep 3 } }
    if (-not $g) { continue }
    [xml]$doc = $pxml; $dm = New-Object System.Xml.XmlNamespaceManager($doc.NameTable); $dm.AddNamespace("one", $nsUri)
    $seq = $doc.SelectNodes("//one:T | //one:MediaFile | //one:InsertedFile", $dm)

    # Ordered items tagged with a "block" (a stop). A block starts at each
    # "N min" drive-time line, so an address can't bleed across stops.
    $items = New-Object System.Collections.ArrayList
    $block = 0
    foreach ($node in $seq) {
      if ($node.LocalName -eq 'T') {
        $t = [regex]::Replace($node.InnerText, '<[^>]+>', '')
        $t = $t -replace '&nbsp;', ' ' -replace '&amp;', '&' -replace '&#39;', "'" -replace '&quot;', '"'
        $t = $t.Trim()
        if (-not $t) { continue }
        if ($t -match $driveRe) { $block++; continue }
        if ($t -match $captionRe) { continue }
        [void]$items.Add([pscustomobject]@{ kind = 'T'; text = $t; block = $block })
      } else {
        $ext = [System.IO.Path]::GetExtension($node.preferredName).ToLower()
        if ($audioExt -notcontains $ext) { continue }
        [void]$items.Add([pscustomobject]@{ kind = 'A'; orig = $node.preferredName; block = $block })
      }
    }

    # For each audio: nearest qualifying address above (within its block), else below.
    for ($i = 0; $i -lt $items.Count; $i++) {
      if ($items[$i].kind -ne 'A') { continue }
      $b = $items[$i].block
      $above = New-Object System.Collections.ArrayList
      for ($j = $i - 1; $j -ge 0 -and $items[$j].block -eq $b; $j--) { if ($items[$j].kind -eq 'T') { [void]$above.Add($j) } }
      $addr = Pick-Address $items $above
      if (-not $addr) {
        $below = New-Object System.Collections.ArrayList
        for ($j = $i + 1; $j -lt $items.Count -and $items[$j].block -eq $b; $j++) { if ($items[$j].kind -eq 'T') { [void]$below.Add($j) } }
        $addr = Pick-Address $items $below
      }
      $key = ($secName.Trim() + '|' + ("" + $p.name).Trim() + '|' + ("" + $items[$i].orig).Trim())
      $addrByKey[$key] = $addr
    }
  }
}
Write-Output ("OneNote: mapped {0} recording(s) across {1} section(s)." -f $addrByKey.Count, $sections.Count)

# --- rewrite the Address column in each manifest.csv --------------------------
$cols = 'OriginalName','FileName','Date','Time','Rep','Customer','Address','Notebook','Section','Page'
$header = ($cols -join ',')
function CsvQ($v) { if ($null -eq $v) { return '' }; $v = "" + $v; if ($v -match '[",\r\n]') { return '"' + ($v -replace '"', '""') + '"' }; return $v }

$manifests = Get-ChildItem -Path $Base -Recurse -Filter 'manifest.csv' -ErrorAction SilentlyContinue
$tot = @{ filled = 0; changed = 0; blanked = 0; same = 0; unmatched = 0 }
$examples = New-Object System.Collections.ArrayList
foreach ($mf in $manifests) {
  $rows = @(Import-Csv -LiteralPath $mf.FullName)
  if ($rows.Count -eq 0) { continue }
  $lines = New-Object System.Collections.ArrayList
  $fileChanged = 0
  foreach ($r in $rows) {
    $key = ("" + $r.Section).Trim() + '|' + ("" + $r.Page).Trim() + '|' + ("" + $r.OriginalName).Trim()
    $old = "" + $r.Address
    if ($addrByKey.ContainsKey($key)) {
      $new = $addrByKey[$key]
      if ($new -eq $old) { $tot.same++ }
      elseif ($old -and -not $new) { $tot.blanked++; $fileChanged++ }
      elseif (-not $old -and $new) { $tot.filled++; $fileChanged++ }
      else { $tot.changed++; $fileChanged++ }
      if ($new -ne $old -and $examples.Count -lt 30) {
        [void]$examples.Add(("  [{0}] {1}`n      old: {2}`n      new: {3}" -f $r.Rep, $r.Customer, (("" + $old) -replace '\s+', ' '), $(if ($new) { $new } else { '(blank)' })))
      }
      $r.Address = $new
    } else {
      $tot.unmatched++
    }
    $line = (@($r.OriginalName, $r.FileName, $r.Date, $r.Time, $r.Rep, $r.Customer, $r.Address, $r.Notebook, $r.Section, $r.Page) | ForEach-Object { CsvQ $_ }) -join ','
    [void]$lines.Add($line)
  }
  if ($Write -and $fileChanged -gt 0) {
    Set-Content -LiteralPath $mf.FullName -Value (@($header) + $lines.ToArray()) -Encoding UTF8
  }
  $label = $mf.Directory.Parent.Name + '/' + $mf.Directory.Name
  Write-Output ("  {0,-30} {1,3} row(s), {2,3} change(s)" -f $label, $rows.Count, $fileChanged)
}
Write-Output ""
Write-Output ("Totals: {0} filled, {1} changed, {2} blanked, {3} unchanged, {4} unmatched." -f $tot.filled, $tot.changed, $tot.blanked, $tot.same, $tot.unmatched)
if ($examples.Count -gt 0) {
  Write-Output "`n--- sample changes ---"
  $examples | ForEach-Object { Write-Output $_ }
}
if (-not $Write) { Write-Output "`nDRY RUN - nothing written. Re-run with -Write to apply." }
