# Generates Geek Space app icons (PNG set + PNG-in-ICO) without external tooling.
# Run: powershell -ExecutionPolicy Bypass -Scope Process -File make-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\icons'))
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$GREEN = [System.Drawing.Color]::FromArgb(255, 43, 201, 126)
$BG    = [System.Drawing.Color]::FromArgb(255, 10, 11, 13)
$ORBIT = [System.Drawing.Color]::FromArgb(115, 43, 201, 126)

function New-GeekIcon([int]$s) {
  $bmp = [System.Drawing.Bitmap]::new($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # rounded-square background
  $rad = [float]($s * 0.225)
  $d = [float]($rad * 2)
  $bgPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $bgPath.AddArc(0.0, 0.0, $d, $d, 180.0, 90.0)
  $bgPath.AddArc([float]($s - $d), 0.0, $d, $d, 270.0, 90.0)
  $bgPath.AddArc([float]($s - $d), [float]($s - $d), $d, $d, 0.0, 90.0)
  $bgPath.AddArc(0.0, [float]($s - $d), $d, $d, 90.0, 90.0)
  $bgPath.CloseFigure()
  $bgBrush = [System.Drawing.SolidBrush]::new($BG)
  $g.FillPath($bgBrush, $bgPath)

  $cx = [float]($s * 0.5)
  $cy = [float]($s * 0.5)

  # orbit ring (rotated ellipse, behind the letter)
  $st = $g.Save()
  $g.TranslateTransform($cx, $cy)
  $g.RotateTransform(-18.0)
  $orbitPen = [System.Drawing.Pen]::new($ORBIT, [float]($s * 0.040))
  $g.DrawEllipse($orbitPen, [float](-$s * 0.375), [float](-$s * 0.140), [float]($s * 0.750), [float]($s * 0.280))
  $g.Restore($st)

  # letter G
  $pen = [System.Drawing.Pen]::new($GREEN, [float]($s * 0.108))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $rad2 = [float]($s * 0.285)
  $g.DrawArc($pen, [float]($cx - $rad2), [float]($cy - $rad2), [float]($rad2 * 2), [float]($rad2 * 2), -38.0, 292.0)
  $g.DrawLine($pen, [float]($cx + $rad2 * 0.05), $cy, [float]($cx + $rad2 * 0.98), $cy)

  # sparkle (4-point star, top-right)
  $sx = [float]($s * 0.775)
  $sy = [float]($s * 0.225)
  $outer = [float]($s * 0.115)
  $inner = [float]($outer * 0.30)
  $star = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $pts = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($sx, [float]($sy - $outer)),
    [System.Drawing.PointF]::new([float]($sx + $inner), [float]($sy - $inner)),
    [System.Drawing.PointF]::new([float]($sx + $outer), $sy),
    [System.Drawing.PointF]::new([float]($sx + $inner), [float]($sy + $inner)),
    [System.Drawing.PointF]::new($sx, [float]($sy + $outer)),
    [System.Drawing.PointF]::new([float]($sx - $inner), [float]($sy + $inner)),
    [System.Drawing.PointF]::new([float]($sx - $outer), $sy),
    [System.Drawing.PointF]::new([float]($sx - $inner), [float]($sy - $inner))
  )
  $star.AddPolygon($pts)
  $starBrush = [System.Drawing.SolidBrush]::new($GREEN)
  $g.FillPath($starBrush, $star)

  $g.Dispose()
  return $bmp
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = [System.IO.MemoryStream]::new()
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  return $bytes
}

$targets = [ordered]@{
  '32x32.png'             = 32
  '128x128.png'           = 128
  '128x128@2x.png'        = 256
  'icon.png'              = 512
  'Square150x150Logo.png' = 150
  'Square44x44Logo.png'   = 44
  'StoreLogo.png'         = 50
}
foreach ($k in $targets.Keys) {
  $bmp = New-GeekIcon $targets[$k]
  $bmp.Save((Join-Path $outDir $k), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "wrote $k ($($targets[$k])px)"
}

$icoSizes = @(16, 32, 48, 64, 128, 256)
$entries = @()
foreach ($sz in $icoSizes) {
  $bmp = New-GeekIcon $sz
  $entries += , @{ size = $sz; bytes = (Get-PngBytes $bmp) }
  $bmp.Dispose()
}

$ms = [System.IO.MemoryStream]::new()
$bw = [System.IO.BinaryWriter]::new($ms)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$entries.Count)
$offset = 6 + (16 * $entries.Count)
foreach ($e in $entries) {
  $dim = 0
  if ($e.size -lt 256) { $dim = $e.size }
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$e.bytes.Length)
  $bw.Write([UInt32]$offset)
  $offset += $e.bytes.Length
}
foreach ($e in $entries) { $bw.Write($e.bytes) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.ico'), $ms.ToArray())
$bw.Dispose()
$ms.Dispose()
Write-Output "wrote icon.ico ($($entries.Count) sizes)"
Write-Output "DONE -> $outDir"
