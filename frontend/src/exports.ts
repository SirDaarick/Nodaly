import * as XLSX from 'xlsx';

/**
 * Download an array of flat objects as a real .xlsx Excel file in the browser.
 */
export function exportRowsToExcel(rows: Record<string, string | number>[], filename: string, sheetName = 'Reporte'): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Mensaje: 'Sin datos para exportar' }]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/**
 * Open a clean, print-ready PDF view for a quote copy or owner report.
 */
export function exportPrintPdf(title: string, subtitle: string, lines: { label: string; value: string }[], body: string): void {
  const win = window.open('', '_blank', 'width=760,height=840');
  if (!win) return;

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const metaHtml = lines
    .map((l) => `<div class="meta-row"><span>${esc(l.label)}</span><strong>${esc(l.value)}</strong></div>`)
    .join('');

  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #1e293b; padding: 36px; max-width: 680px; margin: auto; }
    .head { border-bottom: 2px solid #6552df; padding-bottom: 14px; margin-bottom: 20px; }
    .kicker { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #6552df; font-weight: 700; }
    h1 { margin: 6px 0 4px; font-size: 22px; }
    .sub { color: #64748b; font-size: 13px; margin: 0; }
    .meta { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; display: grid; gap: 8px; }
    .meta-row { display: flex; justify-content: space-between; font-size: 13px; }
    .body { white-space: pre-wrap; line-height: 1.6; font-size: 14px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; }
    .foot { margin-top: 24px; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <div class="head">
    <div class="kicker">Nodaly · Documento generado</div>
    <h1>${esc(title)}</h1>
    <p class="sub">${esc(subtitle)}</p>
  </div>
  ${metaHtml ? `<div class="meta">${metaHtml}</div>` : ''}
  <div class="body">${esc(body)}</div>
  <div class="foot">Generado automáticamente desde el flujo de Nodaly.</div>
  <script>window.onload = () => { setTimeout(() => window.print(), 200); };</script>
</body>
</html>`);
  win.document.close();
}
