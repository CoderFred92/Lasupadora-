import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export function exportToExcel(filename: string, sheetName: string, rows: Record<string, unknown>[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export function exportTableToPDF(
  filename: string,
  title: string,
  subtitle: string,
  headers: string[],
  rows: (string | number)[][]
) {
  const doc = new jsPDF({ orientation: headers.length > 6 ? 'landscape' : 'portrait' });
  doc.setFillColor(16, 36, 47); // #10242F Official Logo Ink
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('LASUPADORA MASQUERADERS SOCIETY', 14, 11);
  doc.setFontSize(9);
  doc.text(`LASUPADORA 360 — ${title}`, 14, 18);

  doc.setTextColor(16, 36, 47);
  doc.setFontSize(9);
  doc.text(`${subtitle} | Generated: ${new Date().toLocaleString('en-GB')}`, 14, 32);

  autoTable(doc, {
    startY: 37,
    head: [headers],
    body: rows,
    headStyles: { fillColor: [5, 53, 89], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: [16, 36, 47] },
    alternateRowStyles: { fillColor: [248, 249, 250] },
  });

  doc.save(`${filename}.pdf`);
}

export async function exportMembershipCardPDF(card: {
  full_name: string;
  membership_number: string;
  branch_name: string;
  category_name: string;
  membership_status: string;
  card_valid_until: string | null;
  qrDataUrl: string;
}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [86, 54] });
  // Card front border & header bar using official logo colors
  doc.setFillColor(16, 36, 47);
  doc.rect(0, 0, 86, 12, 'F');
  doc.setFillColor(189, 80, 22);
  doc.rect(0, 12, 86, 1.2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.text('LASUPADORA MASQUERADERS SOCIETY', 4, 5.5);
  doc.setFontSize(6);
  doc.text('Wear the Culture. Live the Tradition.', 4, 9.5);

  doc.setTextColor(16, 36, 47);
  doc.setFontSize(9.5);
  doc.text(card.full_name, 4, 21);

  doc.setFontSize(7.5);
  doc.setTextColor(173, 34, 11);
  doc.text(card.membership_number, 4, 26);

  doc.setTextColor(51, 65, 85);
  doc.setFontSize(6.8);
  doc.text(`Branch: ${card.branch_name}`, 4, 32);
  doc.text(`Category: ${card.category_name}`, 4, 36);
  doc.text(`Status: ${card.membership_status}`, 4, 40);
  doc.text(`Valid Until: ${card.card_valid_until || 'Ongoing'}`, 4, 44);

  if (card.qrDataUrl) {
    doc.addImage(card.qrDataUrl, 'PNG', 60, 17, 21, 21);
    doc.setFontSize(5);
    doc.setTextColor(100, 116, 139);
    doc.text('Scan to verify', 65.5, 41);
  }

  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Official Credential — Property of LASUPADORA Masqueraders Society', 4, 50.5);

  doc.save(`LASUPADORA-ID-${card.membership_number}.pdf`);
}
