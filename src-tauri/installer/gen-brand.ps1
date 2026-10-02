# Generate installer branding BMPs (24-bit):
#   header.bmp 150x57 / sidebar.bmp 164x314 / splash.bmp 480x300 (advsplash intro frame)
# Dark navy gradient + green arc + app icon. Run from anywhere (paths relative to this script).
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '..\icons\icon-256.png'))

function RoundedPath {
  param([int]$x, [int]$y, [int]$w, [int]$h, [int]$r)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $r*2, $r*2, 180, 90)
  $p.AddArc($x+$w-$r*2, $y, $r*2, $r*2, 270, 90)
  $p.AddArc($x+$w-$r*2, $y+$h-$r*2, $r*2, $r*2, 0, 90)
  $p.AddArc($x, $y+$h-$r*2, $r*2, $r*2, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-BrandBmp {
  param([int]$w, [int]$h, [string]$out, [string]$title, [int]$titleSize, [bool]$withTagline, [string]$layout)
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(15,23,42), [System.Drawing.Color]::FromArgb(30,41,59), 55)
  $g.FillRectangle($brush, $rect)
  $g.FillEllipse(([System.Drawing.SolidBrush][System.Drawing.Color]::FromArgb(52,211,153)), ($w - [int]($h*0.9)), (-$h*0.35), ($h*1.1), ($h*1.1))
  $g.FillEllipse(([System.Drawing.SolidBrush][System.Drawing.Color]::FromArgb(15,23,42)), ($w - [int]($h*0.72)), (-$h*0.28), ($h*0.95), ($h*0.95))

  if ($layout -eq 'side') {
    $iw = [int]($w * 0.42); $ih = $iw
    $ix = [int](($w - $iw) / 2); $iy = [int]($h * 0.08)
    $platePath = RoundedPath ($ix-6) ($iy-6) ($iw+12) ($ih+12) 14
    $g.FillPath((New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(51,65,85))), $platePath)
    $g.DrawImage($icon, $ix, $iy, $iw, $ih)
    $fc = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', $titleSize, ([System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString('Agent', $font, $fc, (New-Object System.Drawing.RectangleF -ArgumentList 0, ($iy+$ih+[int]($h*0.04)), $w, 30), $sf)
    $g.DrawString('Quota', $font, $fc, (New-Object System.Drawing.RectangleF -ArgumentList 0, ($iy+$ih+[int]($h*0.04)+27), $w, 30), $sf)
    $accent = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(52,211,153))
    $g.FillRectangle($accent, [int]($w*0.2), ($iy+$ih+[int]($h*0.04)+58), [int]($w*0.6), 3)
    $fc2 = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(148,163,184))
    $f2 = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', 8, ([System.Drawing.FontStyle]::Regular)
    $g.DrawString('AI Usage Monitor', $f2, $fc2, (New-Object System.Drawing.RectangleF -ArgumentList 0, ($iy+$ih+[int]($h*0.04)+72), $w, 20), $sf)
  } elseif ($layout -eq 'header') {
    $fc = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', $titleSize, ([System.Drawing.FontStyle]::Bold)
    $g.DrawString($title, $font, $fc, 10, 6)
    $accent = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(52,211,153))
    $g.FillRectangle($accent, 10, ($h - 12), [int]($w*0.45), 3)
  } else {
    $iw = [int]($h * 0.52); $ih = $iw
    $ix = [int]($w * 0.05); $iy = [int](($h - $ih) / 2)
    $platePath = RoundedPath ($ix-8) ($iy-8) ($iw+16) ($ih+16) 18
    $g.FillPath((New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(51,65,85))), $platePath)
    $g.DrawImage($icon, $ix, $iy, $iw, $ih)
    $fc = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', $titleSize, ([System.Drawing.FontStyle]::Bold)
    $tx = $ix + $iw + [int]($w * 0.06)
    $ty = [int]($h * 0.20)
    $g.DrawString($title, $font, $fc, $tx, $ty)
    $accent = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(52,211,153))
    $g.FillRectangle($accent, $tx, ($ty + [int]($h*0.30)), [int]($w - $tx - $w*0.04), [int]($h*0.035))
    if ($withTagline) {
      $fc2 = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(148,163,184))
      $f2 = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', 11, ([System.Drawing.FontStyle]::Regular)
      $g.DrawString('AI Usage Monitor', $f2, $fc2, $tx, ($ty + [int]($h*0.42)))
    }
  }

  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ('saved ' + $out)
}

$installerDir = $PSScriptRoot
New-BrandBmp 150 57 (Join-Path $installerDir 'header.bmp') 'Agent Quota Monitor' 9 $false 'header'
New-BrandBmp 164 314 (Join-Path $installerDir 'sidebar.bmp') 'Agent Quota' 14 $true 'side'
New-BrandBmp 480 300 (Join-Path $installerDir 'splash.bmp') 'Agent Quota Monitor' 15 $true 'splash'
$icon.Dispose()
Write-Output 'done'
