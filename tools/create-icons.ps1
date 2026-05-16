# tools/create-icons.ps1
# Usage (from project root):
#   powershell -ExecutionPolicy Bypass -File tools\create-icons.ps1

Add-Type -AssemblyName System.Drawing

function New-Icon {
    param([int]$Size, [string]$OutPath)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $s = $Size

    # ---- 角丸背景クリッピング ----
    $r    = [int]($s * 0.16)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0,       0,       $r*2, $r*2, 180, 90)
    $path.AddArc($s-$r*2, 0,       $r*2, $r*2, 270, 90)
    $path.AddArc($s-$r*2, $s-$r*2, $r*2, $r*2,   0, 90)
    $path.AddArc(0,       $s-$r*2, $r*2, $r*2,  90, 90)
    $path.CloseFigure()
    $g.SetClip($path)

    # 背景 #1a1a2e
    $g.Clear([System.Drawing.Color]::FromArgb(26, 26, 46))

    $mg  = [int]($s * 0.06)   # 外マージン
    $pw  = [int]($s * 0.43)   # パネル幅
    $ph  = [int]($s * 0.30)   # パネル高

    # ---- YouTube パネル（赤） ----
    $br = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(204, 0, 0))
    $g.FillRectangle($br, $mg, $mg, $pw, $ph)
    $br.Dispose()

    # ▶ ボタン
    $tx = $mg + [int]($pw * 0.30)
    $ty = $mg + [int]($ph * 0.20)
    $th = [int]($ph * 0.60)
    $tri = @(
        [System.Drawing.PointF]::new($tx,            $ty),
        [System.Drawing.PointF]::new($tx,            $ty + $th),
        [System.Drawing.PointF]::new($tx + [int]($tw = $th * 0.80), $ty + $th/2)
    )
    $br = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillPolygon($br, $tri)
    $br.Dispose()

    # ---- Twitch パネル（紫） ----
    $twX = $s - $mg - $pw
    $br  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 65, 165))
    $g.FillRectangle($br, $twX, $mg, $pw, $ph)
    $br.Dispose()

    # デュアルバー
    $bw  = [int]($pw * 0.12)
    $bh  = [int]($ph * 0.48)
    $by  = $mg + [int]($ph * 0.25)
    $br  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillRectangle($br, $twX + [int]($pw * 0.27), $by, $bw, $bh)
    $g.FillRectangle($br, $twX + [int]($pw * 0.49), $by, $bw, $bh)
    $br.Dispose()

    # ---- 同期矢印（中央帯） ----
    $sy  = $mg + $ph + [int](($s - $mg*2 - $ph*2 - 4) / 2)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(167, 139, 250), [int]($s * 0.055))
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::ArrowAnchor
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pen, $mg, $sy, $s - $mg, $sy)
    $pen.Dispose()

    # ---- 下部バー（タイムライン） ----
    $bY = [int]($s * 0.68)
    $br = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(42, 42, 58))
    $g.FillRectangle($br, $mg, $bY, $s - $mg*2, $s - $bY - $mg)
    $br.Dispose()

    # タイムラインライン
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(74, 74, 122), [int]($s * 0.04))
    $pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $ly = $bY + [int](($s - $bY - $mg) * 0.4)
    $g.DrawLine($pen, $mg + [int]($s*0.04), $ly, $s - $mg - [int]($s*0.04), $ly)
    $pen.Dispose()

    $g.ResetClip()
    $g.Dispose()

    $dir = Split-Path $OutPath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Created: $OutPath"
}

$root = Split-Path $PSScriptRoot -Parent
New-Icon -Size  48 -OutPath (Join-Path $root "icons\icon-48.png")
New-Icon -Size  96 -OutPath (Join-Path $root "icons\icon-96.png")
Write-Host "Done."
