$ErrorActionPreference = 'Stop'
$rfqDocx = 'C:\git\ai-orchestrations-lp\output\docx\AIOrchestration_石川県AIデータセンター概算見積依頼書_20260928.docx'
$rfqPdf = 'C:\git\ai-orchestrations-lp\output\pdf\AIOrchestration_石川県AIデータセンター概算見積依頼書_20260928.pdf'
$rfqWord = $null
$rfqDocument = $null
try {
    $rfqWord = New-Object -ComObject Word.Application
    $rfqWord.Visible = $false
    $rfqWord.DisplayAlerts = 0
    $rfqDocument = $rfqWord.Documents.Open($rfqDocx, $false, $true)
    $rfqDocument.Repaginate()
    $rfqDocument.Fields.Update() | Out-Null
    $rfqDocument.ExportAsFixedFormat($rfqPdf, 17)
    Write-Output ('Pages: ' + $rfqDocument.ComputeStatistics(2))
    Get-Item -LiteralPath $rfqPdf | Select-Object FullName, Length
}
finally {
    if ($null -ne $rfqDocument) { $rfqDocument.Close(0) }
    if ($null -ne $rfqWord) { $rfqWord.Quit() }
}
