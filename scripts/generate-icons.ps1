# 生成 Tauri 需要的图标资源（32x32 / 128x128 / 256x256 / icon.ico / icon.icns）
param(
    [string]$OutDir = (Join-Path $PSScriptRoot "..\src-tauri\icons")
)

Add-Type -AssemblyName System.Drawing

$OutDir = [System.IO.Path]::GetFullPath($OutDir)
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-TaskIcon {
    param([int]$Size)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    $unit = $Size / 16.0
    $radius = 3.2 * $unit
    $rect = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc((New-Object System.Drawing.RectangleF(0, 0, $d, $d)), 180, 90)
    $path.AddArc((New-Object System.Drawing.RectangleF(($Size - $d), 0, $d, $d)), 270, 90)
    $path.AddArc((New-Object System.Drawing.RectangleF(($Size - $d), ($Size - $d), $d, $d)), 0, 90)
    $path.AddArc((New-Object System.Drawing.RectangleF(0, ($Size - $d), $d, $d)), 90, 90)
    $path.CloseFigure()

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF($Size, $Size)),
        [System.Drawing.Color]::FromArgb(255, 30, 90, 180),
        [System.Drawing.Color]::FromArgb(255, 0, 160, 190)
    )
    $g.FillPath($brush, $path)

    # 时钟圆盘
    $cx = $Size / 2.0
    $cy = $Size / 2.0
    $r = $Size * 0.30
    $white = [System.Drawing.Color]::FromArgb(255, 250, 252, 255)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush($white)), ($cx - $r), ($cy - $r), ($r * 2), ($r * 2))

    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 30, 90, 180)), ([Math]::Max(1.0, $Size * 0.035))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawEllipse($pen, ($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
    $g.DrawLine($pen, $cx, $cy, $cx, ($cy - $r * 0.62))
    $g.DrawLine($pen, $cx, $cy, ($cx + $r * 0.52), $cy)

    $g.Dispose()
    return $bmp
}

function Save-Png {
    param($Bmp, [string]$File)
    $Bmp.Save($File, [System.Drawing.Imaging.ImageFormat]::Png)
}

$sizes = @(32, 128, 256)
foreach ($s in $sizes) {
    $bmp = New-TaskIcon $s
    if ($s -eq 256) {
        Save-Png $bmp (Join-Path $OutDir "128x128@2x.png")
    } else {
        Save-Png $bmp (Join-Path $OutDir ("{0}x{0}.png" -f $s))
    }
    $bmp.Dispose()
}

# ICO：多尺寸打包
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$ms = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($ms)
$writer.Write([uint16]0)      # reserved
$writer.Write([uint16]1)      # type: icon
$writer.Write([uint16]$icoSizes.Count)

$pngBlobs = @()
foreach ($s in $icoSizes) {
    $bmp = New-TaskIcon $s
    $tmp = New-Object System.IO.MemoryStream
    $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBlobs += , @($s, $tmp.ToArray())
    $tmp.Dispose()
    $bmp.Dispose()
}

$offset = 6 + 16 * $icoSizes.Count
foreach ($item in $pngBlobs) {
    $s = [int]$item[0]
    $bytes = [byte[]]$item[1]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $writer.Write([byte]$dim)
    $writer.Write([byte]$dim)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $bytes.Length
}
foreach ($item in $pngBlobs) {
    $writer.Write([byte[]]$item[1])
}
$writer.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $OutDir "icon.ico"), $ms.ToArray())
$writer.Dispose()
$ms.Dispose()

# ICNS：容器 + ic08 (256x256 PNG)
$png256 = [System.IO.File]::ReadAllBytes((Join-Path $OutDir "128x128@2x.png"))
$icns = New-Object System.IO.MemoryStream
$iw = New-Object System.IO.BinaryWriter($icns)
$iw.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes("icns"))
$iw.Write([uint32](8 + 8 + $png256.Length))
function Write-BE([System.IO.BinaryWriter]$w, [string]$s) {
    $w.Write([byte[]][System.Text.Encoding]::ASCII.GetBytes($s))
}
Write-BE $iw "ic08"
$iw.Write([uint32](8 + $png256.Length))
$iw.Write($png256)
$iw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $OutDir "icon.icns"), $icns.ToArray())
$iw.Dispose()
$icns.Dispose()

Get-ChildItem $OutDir | Select-Object Name, Length | Format-Table -AutoSize | Out-String
