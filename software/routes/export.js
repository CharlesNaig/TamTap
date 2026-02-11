/**
 * TAMTAP Export Routes
 * Generate XLSX and PDF attendance reports
 * 
 * GET /api/export/xlsx - Export attendance as XLSX
 * GET /api/export/pdf  - Export attendance as PDF
 * GET /api/export/student/:nfcId/xlsx - Export single student as XLSX
 * GET /api/export/student/:nfcId/pdf  - Export single student as PDF
 * 
 * Query params:
 *   section  - Filter by section (optional)
 *   from     - Start date (YYYY-MM-DD)
 *   to       - End date (YYYY-MM-DD)
 *   date     - Single date (YYYY-MM-DD)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');

// FEU Brand Colors
const FEU_GREEN = { argb: 'FF0A8249' };
const FEU_GREEN_HEX = '#0A8249';
const FEU_GOLD = { argb: 'FFFFD700' };
const FEU_GOLD_HEX = '#FFD700';

// All export routes require authentication
router.use(requireAuth);

// ========================================
// HELPER: Get attendance data for export
// ========================================
async function getAttendanceForExport(db, options = {}) {
    const { section, sections, from, to, date } = options;
    
    let query = {};
    
    // Date filtering
    if (date) {
        query.date = { $regex: `^${date}` };
    } else if (from && to) {
        query.date = { $gte: from, $lte: to + ' 23:59:59' };
    } else if (from) {
        query.date = { $gte: from };
    } else if (to) {
        query.date = { $lte: to + ' 23:59:59' };
    }
    
    // Section filtering
    if (section) {
        query.section = section;
    } else if (sections && sections.length > 0) {
        query.section = { $in: sections };
    }
    
    console.log('[DEBUG] Export query:', JSON.stringify(query));
    
    const records = await db.collection('attendance')
        .find(query)
        .sort({ section: 1, date: -1, name: 1 }) // Sort by section first for grouping
        .toArray();
    
    console.log(`[DEBUG] Found ${records.length} records`);
    return records;
}

// ========================================
// HELPER: Get student info
// ========================================
async function getStudentInfo(db, nfcId) {
    if (!nfcId) return null;
    return await db.collection('students').findOne({ nfc_id: nfcId });
}

// ========================================
// HELPER: Group records by section
// ========================================
function groupBySection(records) {
    const grouped = {};
    for (const record of records) {
        const sec = record.section || 'Unknown';
        if (!grouped[sec]) grouped[sec] = [];
        grouped[sec].push(record);
    }
    return grouped;
}

// ========================================
// GET /api/export/xlsx
// Export attendance as XLSX file
// Format: FeuXTamTap logo, smart section grouping
// ========================================
router.get('/xlsx', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        let ExcelJS;
        try {
            ExcelJS = require('exceljs');
        } catch (e) {
            return res.status(500).json({ error: 'ExcelJS not installed' });
        }
        
        const { section, from, to, date } = req.query;
        console.log(`[INFO] XLSX export: section=${section || 'All'}, from=${from}, to=${to}`);
        
        // Get user's sections if teacher
        let sections = null;
        if (req.user.role === 'teacher') {
            sections = req.user.sections_handled || [];
            if (section && !sections.includes(section)) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }
        
        // Get attendance data
        const records = await getAttendanceForExport(db, {
            section,
            sections: req.user.role === 'teacher' ? sections : null,
            from, to, date
        });
        
        // Create workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'TAMTAP Attendance System';
        workbook.created = new Date();
        
        // Logo path
        const logoPath = path.resolve(__dirname, '../../assets/FeuXTamTap.png');
        let logoId = null;
        
        if (fs.existsSync(logoPath)) {
            logoId = workbook.addImage({
                filename: logoPath,
                extension: 'png'
            });
        }
        
        // Smart export: Group by section if "All Sections"
        const isAllSections = !section;
        const groupedRecords = isAllSections ? groupBySection(records) : { [section || 'All']: records };
        const sectionKeys = Object.keys(groupedRecords).sort();
        
        // Create worksheet for each section OR one combined sheet
        if (isAllSections && sectionKeys.length > 1) {
            // Multiple sheets - one per section
            for (const sec of sectionKeys) {
                const sectionRecords = groupedRecords[sec];
                await createAttendanceSheet(workbook, sec, sectionRecords, {
                    logoId, db, from, to, date, ExcelJS
                });
            }
            
            // Also create a summary sheet
            createSummarySheet(workbook, groupedRecords, { from, to, date });
        } else {
            // Single sheet
            const sheetName = section || 'All Sections';
            await createAttendanceSheet(workbook, sheetName, records, {
                logoId, db, from, to, date, ExcelJS
            });
        }
        
        // Generate filename
        const dateStr = date || `${from || 'all'}_to_${to || 'now'}`;
        const sectionStr = section || 'all-sections';
        const filename = `TAMTAP_Attendance_${sectionStr}_${dateStr}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        await workbook.xlsx.write(res);
        res.end();
        
        console.log(`[INFO] XLSX export complete: ${records.length} records by ${req.user.username}`);
        
    } catch (error) {
        console.error('[ERROR] XLSX export:', error.message, error.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Export failed', details: error.message });
        }
    }
});

// ========================================
// HELPER: Create attendance worksheet
// ========================================
async function createAttendanceSheet(workbook, sheetName, records, options) {
    const { logoId, db, from, to, date, ExcelJS } = options;
    
    // Sanitize sheet name (Excel limits)
    const safeName = sheetName.substring(0, 31).replace(/[*?:/\\[\]]/g, '-');
    const worksheet = workbook.addWorksheet(safeName, {
        pageSetup: { orientation: 'landscape', fitToPage: true }
    });
    
    // Set column widths
    worksheet.columns = [
        { width: 25 },  // A - Student Name
        { width: 30 },  // B - Student Email
        { width: 12 },  // C - Section
        { width: 12 },  // D - Date
        { width: 12 },  // E - Status
        { width: 10 },  // F - Time In
        { width: 15 },  // G - NFC ID
        { width: 40 }   // H - Photo Path
    ];
    
    // Row 1: Logo
    worksheet.addRow([]); // Empty row 1
    if (logoId !== null) {
        worksheet.addImage(logoId, {
            tl: { col: 0, row: 0 },
            ext: { width: 200, height: 60 }
        });
    }
    worksheet.getRow(1).height = 50;
    
    // Row 2-3: Merged Title
    worksheet.addRow(['STUDENT ATTENDANCE RECORD']);
    worksheet.addRow(['STUDENT ATTENDANCE RECORD']);
    worksheet.mergeCells('A2:H3');
    
    const titleCell = worksheet.getCell('A2');
    titleCell.value = 'STUDENT ATTENDANCE RECORD';
    titleCell.font = { bold: true, size: 20, color: FEU_GREEN };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8F9FA' }
    };
    
    // Row 4: Info line
    const dateRange = date || `${from || 'All Dates'} to ${to || 'Present'}`;
    const infoText = `School Year: S.Y. 2025-2026  |  Section: ${sheetName}  |  Date: ${dateRange}  |  Records: ${records.length}`;
    worksheet.addRow([infoText]);
    worksheet.mergeCells('A4:H4');
    worksheet.getCell('A4').font = { italic: true, size: 10, color: { argb: 'FF666666' } };
    worksheet.getCell('A4').alignment = { horizontal: 'center' };
    
    // Row 5: Column Headers
    const headers = ['Student Name', 'Student Email', 'Section', 'Date', 'Status', 'Time In', 'NFC ID', 'Photo Path'];
    const headerRow = worksheet.addRow(headers);
    
    headerRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: FEU_GREEN
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });
    headerRow.height = 22;
    
    // Row 6+: Data rows
    for (const record of records) {
        const student = await getStudentInfo(db, record.nfc_id);
        const dateOnly = record.date ? record.date.split(' ')[0] : '';
        const photoPath = record.photo ? `/photos/${dateOnly}/${record.photo}` : '';
        
        const statusText = (record.status || 'present').charAt(0).toUpperCase() + 
                          (record.status || 'present').slice(1);
        
        const dataRow = worksheet.addRow([
            record.name || '',
            student?.email || record.email || '',
            record.section || '',
            dateOnly,
            statusText,
            record.time || '',
            record.nfc_id || '',
            photoPath
        ]);
        
        // Style data row
        dataRow.eachCell((cell, colNumber) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
            };
            cell.alignment = { vertical: 'middle' };
        });
        
        // Color code status (column 5)
        const statusCell = dataRow.getCell(5);
        switch ((record.status || '').toLowerCase()) {
            case 'present':
                statusCell.font = { bold: true, color: { argb: 'FF22C55E' } };
                break;
            case 'late':
                statusCell.font = { bold: true, color: { argb: 'FFEAB308' } };
                break;
            case 'absent':
                statusCell.font = { bold: true, color: { argb: 'FFEF4444' } };
                break;
        }
    }
    
    // Empty state
    if (records.length === 0) {
        worksheet.addRow(['No attendance records found']);
        worksheet.mergeCells(`A6:H6`);
        worksheet.getCell('A6').alignment = { horizontal: 'center' };
        worksheet.getCell('A6').font = { italic: true, color: { argb: 'FF999999' } };
    }
    
    // Auto-filter
    if (records.length > 0) {
        worksheet.autoFilter = {
            from: 'A5',
            to: `H${5 + records.length}`
        };
    }
    
    // Freeze header rows
    worksheet.views = [{ state: 'frozen', ySplit: 5 }];
}

// ========================================
// HELPER: Create summary sheet
// ========================================
function createSummarySheet(workbook, groupedRecords, options) {
    const { from, to, date } = options;
    const worksheet = workbook.addWorksheet('Summary', {
        pageSetup: { orientation: 'portrait' }
    });
    
    worksheet.columns = [
        { width: 20 },  // Section
        { width: 12 },  // Total
        { width: 12 },  // Present
        { width: 12 },  // Late
        { width: 12 }   // Absent
    ];
    
    // Title
    worksheet.addRow(['ATTENDANCE SUMMARY']);
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').font = { bold: true, size: 16, color: FEU_GREEN };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    
    // Date info
    const dateRange = date || `${from || 'All'} to ${to || 'Present'}`;
    worksheet.addRow([`Date Range: ${dateRange}`]);
    worksheet.mergeCells('A2:E2');
    worksheet.getCell('A2').alignment = { horizontal: 'center' };
    
    worksheet.addRow([]); // Spacer
    
    // Headers
    const headerRow = worksheet.addRow(['Section', 'Total', 'Present', 'Late', 'Absent']);
    headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: FEU_GREEN };
        cell.alignment = { horizontal: 'center' };
    });
    
    // Data
    let grandTotal = 0, grandPresent = 0, grandLate = 0, grandAbsent = 0;
    
    for (const [sec, records] of Object.entries(groupedRecords)) {
        const present = records.filter(r => (r.status || 'present').toLowerCase() === 'present').length;
        const late = records.filter(r => (r.status || '').toLowerCase() === 'late').length;
        const absent = records.filter(r => (r.status || '').toLowerCase() === 'absent').length;
        
        worksheet.addRow([sec, records.length, present, late, absent]);
        
        grandTotal += records.length;
        grandPresent += present;
        grandLate += late;
        grandAbsent += absent;
    }
    
    // Grand total row
    const totalRow = worksheet.addRow(['TOTAL', grandTotal, grandPresent, grandLate, grandAbsent]);
    totalRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: FEU_GOLD };
    });
}

// ========================================
// GET /api/export/pdf
// Export attendance as PDF file
// Styled with FEU Green/Gold, TamTap-3D logo
// ========================================
router.get('/pdf', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        let PDFDocument;
        try {
            PDFDocument = require('pdfkit');
        } catch (e) {
            return res.status(500).json({ error: 'PDFKit not installed' });
        }
        
        const { section, from, to, date } = req.query;
        console.log(`[INFO] PDF export: section=${section || 'All'}, from=${from}, to=${to}`);
        
        // Get user's sections if teacher
        let sections = null;
        if (req.user.role === 'teacher') {
            sections = req.user.sections_handled || [];
            if (section && !sections.includes(section)) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }
        
        // Get attendance data
        const records = await getAttendanceForExport(db, {
            section,
            sections: req.user.role === 'teacher' ? sections : null,
            from, to, date
        });
        
        // Create PDF
        const doc = new PDFDocument({ 
            size: 'A4', 
            margin: 40,
            bufferPages: true,
            info: {
                Title: 'TAMTAP Attendance Report',
                Author: 'TAMTAP Attendance System',
                Subject: 'Attendance Report'
            }
        });
        
        const dateStr = date || `${from || 'all'}_to_${to || 'now'}`;
        const sectionStr = section || 'all-sections';
        const filename = `TAMTAP_Attendance_${sectionStr}_${dateStr}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        doc.pipe(res);
        
        const pageWidth = doc.page.width - 80;
        
        // ========================================
        // HEADER with FEU Colors
        // ========================================
        
        // Green header bar
        doc.rect(0, 0, doc.page.width, 60).fill(FEU_GREEN_HEX);
        
        // Address
        doc.fontSize(10).fillColor('#FFFFFF')
           .text('FEU Roosevelt Marikina', 40, 15)
           .fontSize(8)
           .text('504 J. P. Rizal St, Marikina, 1800 Metro Manila', 40, 30);
        
        // Date on right
        const genDate = new Date().toLocaleDateString('en-PH', {
            year: 'numeric', month: 'short', day: 'numeric'
        });
        doc.fontSize(9)
           .text(`Generated: ${genDate}`, doc.page.width - 150, 20, { width: 110, align: 'right' });
        
        // White section with logo
        doc.rect(0, 60, doc.page.width, 80).fill('#FFFFFF');
        
        // Logo
        const logoPath = path.resolve(__dirname, '../../assets/TamTap-3D.png');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 40, 68, { width: 55 });
        }
        
        // Title with FEU colors
        doc.fontSize(28)
           .fillColor(FEU_GREEN_HEX)
           .text('TAM', 105, 72, { continued: true })
           .fillColor(FEU_GOLD_HEX)
           .text('TAP');
        
        doc.fontSize(12)
           .fillColor('#666666')
           .text('Attendance Report', 105, 108);
        
        // Gold accent line
        doc.rect(0, 140, doc.page.width, 5).fill(FEU_GOLD_HEX);
        
        // ========================================
        // INFO CARDS
        // ========================================
        const cardY = 160;
        const cardHeight = 50;
        
        // Section card
        doc.roundedRect(40, cardY, 150, cardHeight, 5)
           .fillAndStroke('#F8F9FA', '#E0E0E0');
        doc.fontSize(9).fillColor('#666666').text('SECTION', 50, cardY + 10);
        doc.fontSize(14).fillColor(FEU_GREEN_HEX).text(section || 'All Sections', 50, cardY + 26);
        
        // Date card
        doc.roundedRect(200, cardY, 170, cardHeight, 5)
           .fillAndStroke('#F8F9FA', '#E0E0E0');
        doc.fontSize(9).fillColor('#666666').text('DATE RANGE', 210, cardY + 10);
        doc.fontSize(11).fillColor('#333333')
           .text(date || `${from || 'Start'} to ${to || 'Today'}`, 210, cardY + 26);
        
        // Records card
        doc.roundedRect(380, cardY, 140, cardHeight, 5)
           .fillAndStroke('#F8F9FA', '#E0E0E0');
        doc.fontSize(9).fillColor('#666666').text('TOTAL RECORDS', 390, cardY + 10);
        doc.fontSize(20).fillColor(FEU_GREEN_HEX).text(records.length.toString(), 390, cardY + 24);
        
        // ========================================
        // TABLE
        // ========================================
        const tableTop = 230;
        const colWidths = [120, 80, 70, 70, 80, 90];
        const colHeaders = ['Student Name', 'Section', 'Date', 'Status', 'Time', 'NFC ID'];
        const rowHeight = 20;
        
        // Header
        doc.rect(40, tableTop, pageWidth, 25).fill(FEU_GREEN_HEX);
        doc.fontSize(9).fillColor('#FFFFFF');
        
        let xPos = 45;
        colHeaders.forEach((header, i) => {
            doc.text(header, xPos, tableTop + 8, { width: colWidths[i] - 5 });
            xPos += colWidths[i];
        });
        
        // Rows
        let rowTop = tableTop + 30;
        doc.fontSize(9);
        
        // Smart grouping: add section headers if all sections
        const isAllSections = !section;
        let currentSection = null;
        
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            
            // Section header for grouped view
            if (isAllSections && record.section !== currentSection) {
                currentSection = record.section;
                
                // Check page break
                if (rowTop > doc.page.height - 100) {
                    doc.addPage();
                    rowTop = 50;
                    // Redraw table header
                    doc.rect(40, 30, pageWidth, 25).fill(FEU_GREEN_HEX);
                    doc.fontSize(9).fillColor('#FFFFFF');
                    xPos = 45;
                    colHeaders.forEach((h, j) => {
                        doc.text(h, xPos, 38, { width: colWidths[j] - 5 });
                        xPos += colWidths[j];
                    });
                    rowTop = 60;
                }
                
                // Section header row
                doc.rect(40, rowTop - 2, pageWidth, rowHeight + 2).fill(FEU_GOLD_HEX);
                doc.fontSize(10).fillColor(FEU_GREEN_HEX)
                   .text(`Section: ${currentSection || 'Unknown'}`, 45, rowTop + 2);
                rowTop += rowHeight + 5;
            }
            
            // Check page break
            if (rowTop > doc.page.height - 80) {
                doc.addPage();
                rowTop = 50;
                doc.rect(40, 30, pageWidth, 25).fill(FEU_GREEN_HEX);
                doc.fontSize(9).fillColor('#FFFFFF');
                xPos = 45;
                colHeaders.forEach((h, j) => {
                    doc.text(h, xPos, 38, { width: colWidths[j] - 5 });
                    xPos += colWidths[j];
                });
                rowTop = 60;
            }
            
            // Alternate rows
            if (i % 2 === 0) {
                doc.rect(40, rowTop - 2, pageWidth, rowHeight).fill('#F8F9FA');
            }
            
            const dateOnly = record.date ? record.date.split(' ')[0] : '';
            const status = (record.status || 'present').charAt(0).toUpperCase() + 
                          (record.status || 'present').slice(1);
            
            xPos = 45;
            const rowData = [
                (record.name || 'Unknown').substring(0, 20),
                record.section || '-',
                dateOnly,
                status,
                record.time || '-',
                (record.nfc_id || '-').substring(0, 12)
            ];
            
            rowData.forEach((cell, j) => {
                // Status color
                if (j === 3) {
                    switch (cell.toLowerCase()) {
                        case 'present': doc.fillColor('#22C55E'); break;
                        case 'late': doc.fillColor('#EAB308'); break;
                        case 'absent': doc.fillColor('#EF4444'); break;
                        default: doc.fillColor('#333333');
                    }
                } else {
                    doc.fillColor('#333333');
                }
                doc.text(cell, xPos, rowTop + 3, { width: colWidths[j] - 5 });
                xPos += colWidths[j];
            });
            
            rowTop += rowHeight;
        }
        
        // Empty state
        if (records.length === 0) {
            doc.fillColor('#999999').fontSize(11)
               .text('No attendance records found.', 40, rowTop + 20, { 
                   align: 'center', width: pageWidth 
               });
        }
        
        // ========================================
        // FOOTER on all pages
        // ========================================
        const totalPages = doc.bufferedPageRange().count;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);
            
            doc.rect(40, doc.page.height - 50, pageWidth, 1).fill('#E0E0E0');
            
            doc.fontSize(8).fillColor('#999999')
               .text(
                   'TAMTAP Attendance System | NFC-Based Attendance | FEU Roosevelt Marikina',
                   40, doc.page.height - 40,
                   { align: 'center', width: pageWidth }
               )
               .text(
                   `Page ${i + 1} of ${totalPages} | Capstone by group 5 of Grade 12 ICT B
 S.Y. 2025-2026`,
                   40, doc.page.height - 28,
                   { align: 'center', width: pageWidth }
               );
        }
        
        doc.end();
        console.log(`[INFO] PDF export complete: ${records.length} records by ${req.user.username}`);
        
    } catch (error) {
        console.error('[ERROR] PDF export:', error.message, error.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Export failed', details: error.message });
        }
    }
});

// ========================================
// HELPER: Get single student's attendance
// ========================================
async function getStudentAttendance(db, nfcId) {
    const student = await db.collection('students').findOne({ nfc_id: nfcId });
    const records = await db.collection('attendance')
        .find({ nfc_id: nfcId })
        .sort({ date: -1 })
        .toArray();
    return { student, records };
}

// ========================================
// HELPER: Compute student summary stats
// ========================================
function computeStudentSummary(records) {
    const total = records.length;
    const present = records.filter(r => (r.status || 'present') === 'present').length;
    const late = records.filter(r => (r.status || '') === 'late').length;
    const absent = records.filter(r => (r.status || '') === 'absent').length;
    const excused = records.filter(r => (r.status || '') === 'excused').length;
    const attended = present + late;
    const rate = total > 0 ? Math.round((attended / total) * 100) : 0;
    return { total, present, late, absent, excused, rate };
}

// ========================================
// GET /api/export/student/:nfcId/xlsx
// Export single student attendance as XLSX
// ========================================
router.get('/student/:nfcId/xlsx', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ error: 'Database not available' });

        let ExcelJS;
        try { ExcelJS = require('exceljs'); } catch (e) {
            return res.status(500).json({ error: 'ExcelJS not installed' });
        }

        const { nfcId } = req.params;
        const { student, records } = await getStudentAttendance(db, nfcId);

        if (!student) return res.status(404).json({ error: 'Student not found' });

        console.log(`[INFO] Student XLSX export: ${student.name} (${nfcId}), ${records.length} records by ${req.user.username}`);

        const summary = computeStudentSummary(records);

        // Create workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'TAMTAP Attendance System';
        workbook.created = new Date();

        const logoPath = path.resolve(__dirname, '../../assets/FeuXTamTap.png');
        let logoId = null;
        if (fs.existsSync(logoPath)) {
            logoId = workbook.addImage({ filename: logoPath, extension: 'png' });
        }

        const safeName = (student.name || 'Student').substring(0, 31).replace(/[*?:/\\[\]]/g, '-');
        const worksheet = workbook.addWorksheet(safeName, {
            pageSetup: { orientation: 'landscape', fitToPage: true }
        });

        // Column widths
        worksheet.columns = [
            { width: 14 },  // A - Date
            { width: 10 },  // B - Time
            { width: 12 },  // C - Status
            { width: 10 },  // D - Session
            { width: 14 },  // E - Section
            { width: 40 }   // F - Photo Path
        ];

        // Row 1: Logo
        worksheet.addRow([]);
        if (logoId !== null) {
            worksheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 200, height: 60 } });
        }
        worksheet.getRow(1).height = 50;

        // Row 2-3: Title — student name
        worksheet.addRow([`ATTENDANCE RECORD — ${student.name}`]);
        worksheet.addRow([`ATTENDANCE RECORD — ${student.name}`]);
        worksheet.mergeCells('A2:F3');
        const titleCell = worksheet.getCell('A2');
        titleCell.value = `ATTENDANCE RECORD — ${student.name}`;
        titleCell.font = { bold: true, size: 18, color: FEU_GREEN };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };

        // Row 4: Student info line
        const sectionText = `${student.grade || ''} ${student.section || ''}`.trim() || 'N/A';
        const infoText = `Section: ${sectionText}  |  TAMTAP ID: ${student.tamtap_id || 'N/A'}  |  NFC ID: ${nfcId}  |  Records: ${records.length}`;
        worksheet.addRow([infoText]);
        worksheet.mergeCells('A4:F4');
        worksheet.getCell('A4').font = { italic: true, size: 10, color: { argb: 'FF666666' } };
        worksheet.getCell('A4').alignment = { horizontal: 'center' };

        // Row 5: Summary stats
        const summaryText = `Present: ${summary.present}  |  Late: ${summary.late}  |  Absent: ${summary.absent}  |  Excused: ${summary.excused}  |  Rate: ${summary.rate}%`;
        worksheet.addRow([summaryText]);
        worksheet.mergeCells('A5:F5');
        const summaryCell = worksheet.getCell('A5');
        summaryCell.font = { bold: true, size: 10, color: FEU_GREEN };
        summaryCell.alignment = { horizontal: 'center' };
        summaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF7F1' } };

        // Row 6: Column Headers
        const headers = ['Date', 'Time', 'Status', 'Session', 'Section', 'Photo Path'];
        const headerRow = worksheet.addRow(headers);
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: FEU_GREEN };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin' }, left: { style: 'thin' },
                bottom: { style: 'thin' }, right: { style: 'thin' }
            };
        });
        headerRow.height = 22;

        // Row 7+: Data
        for (const record of records) {
            const dateOnly = record.date ? record.date.split(' ')[0] : '';
            const photoPath = record.photo ? `/photos/${dateOnly}/${record.photo}` : '';
            const statusText = (record.status || 'present').charAt(0).toUpperCase() + (record.status || 'present').slice(1);

            const dataRow = worksheet.addRow([
                dateOnly,
                record.time || '',
                statusText,
                record.session || '',
                record.section || '',
                photoPath
            ]);

            dataRow.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                    left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                    right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
                };
                cell.alignment = { vertical: 'middle' };
            });

            // Color code status (column 3)
            const statusCell = dataRow.getCell(3);
            switch ((record.status || '').toLowerCase()) {
                case 'present': statusCell.font = { bold: true, color: { argb: 'FF22C55E' } }; break;
                case 'late': statusCell.font = { bold: true, color: { argb: 'FFEAB308' } }; break;
                case 'absent': statusCell.font = { bold: true, color: { argb: 'FFEF4444' } }; break;
                case 'excused': statusCell.font = { bold: true, color: { argb: 'FF3B82F6' } }; break;
            }
        }

        // Empty state
        if (records.length === 0) {
            worksheet.addRow(['No attendance records found']);
            worksheet.mergeCells('A7:F7');
            worksheet.getCell('A7').alignment = { horizontal: 'center' };
            worksheet.getCell('A7').font = { italic: true, color: { argb: 'FF999999' } };
        }

        // Auto-filter & freeze
        if (records.length > 0) {
            worksheet.autoFilter = { from: 'A6', to: `F${6 + records.length}` };
        }
        worksheet.views = [{ state: 'frozen', ySplit: 6 }];

        // Send
        const safeFname = student.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
        const filename = `TAMTAP_${safeFname}_Attendance.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('[ERROR] Student XLSX export:', error.message, error.stack);
        if (!res.headersSent) res.status(500).json({ error: 'Export failed', details: error.message });
    }
});

// ========================================
// GET /api/export/student/:nfcId/pdf
// Export single student attendance as PDF
// ========================================
router.get('/student/:nfcId/pdf', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(503).json({ error: 'Database not available' });

        let PDFDocument;
        try { PDFDocument = require('pdfkit'); } catch (e) {
            return res.status(500).json({ error: 'PDFKit not installed' });
        }

        const { nfcId } = req.params;
        const { student, records } = await getStudentAttendance(db, nfcId);

        if (!student) return res.status(404).json({ error: 'Student not found' });

        console.log(`[INFO] Student PDF export: ${student.name} (${nfcId}), ${records.length} records by ${req.user.username}`);

        const summary = computeStudentSummary(records);

        const doc = new PDFDocument({
            size: 'A4', margin: 40, bufferPages: true,
            info: {
                Title: `TAMTAP - ${student.name} Attendance`,
                Author: 'TAMTAP Attendance System',
                Subject: 'Student Attendance Report'
            }
        });

        const safeFname = student.name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
        const filename = `TAMTAP_${safeFname}_Attendance.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        const pageWidth = doc.page.width - 80;

        // ---- HEADER ----
        doc.rect(0, 0, doc.page.width, 60).fill(FEU_GREEN_HEX);
        doc.fontSize(10).fillColor('#FFFFFF').text('FEU Roosevelt Marikina', 40, 15)
           .fontSize(8).text('504 J. P. Rizal St, Marikina, 1800 Metro Manila', 40, 30);

        const genDate = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
        doc.fontSize(9).text(`Generated: ${genDate}`, doc.page.width - 150, 20, { width: 110, align: 'right' });

        // White section with logo
        doc.rect(0, 60, doc.page.width, 80).fill('#FFFFFF');
        const logoPath = path.resolve(__dirname, '../../assets/TamTap-3D.png');
        if (fs.existsSync(logoPath)) doc.image(logoPath, 40, 68, { width: 55 });

        doc.fontSize(28).fillColor(FEU_GREEN_HEX).text('TAM', 105, 72, { continued: true })
           .fillColor(FEU_GOLD_HEX).text('TAP');
        doc.fontSize(12).fillColor('#666666').text('Student Attendance Report', 105, 108);

        // Gold accent
        doc.rect(0, 140, doc.page.width, 5).fill(FEU_GOLD_HEX);

        // ---- STUDENT INFO CARDS ----
        const cardY = 160;
        const cardH = 55;

        // Student Name card
        doc.roundedRect(40, cardY, 180, cardH, 5).fillAndStroke('#F8F9FA', '#E0E0E0');
        doc.fontSize(9).fillColor('#666666').text('STUDENT', 50, cardY + 8);
        doc.fontSize(13).fillColor(FEU_GREEN_HEX).text(student.name.substring(0, 25), 50, cardY + 24);

        // Section card
        const sectionText = `${student.grade || ''} ${student.section || ''}`.trim() || 'N/A';
        doc.roundedRect(230, cardY, 130, cardH, 5).fillAndStroke('#F8F9FA', '#E0E0E0');
        doc.fontSize(9).fillColor('#666666').text('SECTION', 240, cardY + 8);
        doc.fontSize(13).fillColor('#333333').text(sectionText, 240, cardY + 24);

        // Records card
        doc.roundedRect(370, cardY, 100, cardH, 5).fillAndStroke('#F8F9FA', '#E0E0E0');
        doc.fontSize(9).fillColor('#666666').text('RECORDS', 380, cardY + 8);
        doc.fontSize(18).fillColor(FEU_GREEN_HEX).text(records.length.toString(), 380, cardY + 22);

        // Rate card
        doc.roundedRect(480, cardY, 75, cardH, 5).fillAndStroke('#F8F9FA', '#E0E0E0');
        doc.fontSize(9).fillColor('#666666').text('RATE', 490, cardY + 8);
        doc.fontSize(18).fillColor(FEU_GREEN_HEX).text(`${summary.rate}%`, 490, cardY + 22);

        // ---- SUMMARY BAR ----
        const barY = cardY + cardH + 12;
        doc.roundedRect(40, barY, pageWidth, 22, 3).fill('#EDF7F1');
        const summaryStr = `Present: ${summary.present}   Late: ${summary.late}   Absent: ${summary.absent}   Excused: ${summary.excused}`;
        doc.fontSize(9).fillColor(FEU_GREEN_HEX).text(summaryStr, 50, barY + 6, { width: pageWidth - 20, align: 'center' });

        // ---- TABLE ----
        const tableTop = barY + 35;
        const colWidths = [85, 65, 75, 65, 80, 140];
        const colHeaders = ['Date', 'Time', 'Status', 'Session', 'Section', 'Photo'];
        const rowHeight = 20;

        // Header row
        doc.rect(40, tableTop, pageWidth, 25).fill(FEU_GREEN_HEX);
        doc.fontSize(9).fillColor('#FFFFFF');
        let xPos = 45;
        colHeaders.forEach((h, i) => {
            doc.text(h, xPos, tableTop + 8, { width: colWidths[i] - 5 });
            xPos += colWidths[i];
        });

        // Data rows
        let rowTop = tableTop + 30;
        doc.fontSize(9);

        for (let i = 0; i < records.length; i++) {
            const record = records[i];

            // Page break check
            if (rowTop > doc.page.height - 80) {
                doc.addPage();
                rowTop = 50;
                doc.rect(40, 30, pageWidth, 25).fill(FEU_GREEN_HEX);
                doc.fontSize(9).fillColor('#FFFFFF');
                xPos = 45;
                colHeaders.forEach((h, j) => {
                    doc.text(h, xPos, 38, { width: colWidths[j] - 5 });
                    xPos += colWidths[j];
                });
                rowTop = 60;
            }

            // Alternate rows
            if (i % 2 === 0) doc.rect(40, rowTop - 2, pageWidth, rowHeight).fill('#F8F9FA');

            const dateOnly = record.date ? record.date.split(' ')[0] : '';
            const status = (record.status || 'present').charAt(0).toUpperCase() + (record.status || 'present').slice(1);
            const photoPath = record.photo ? `/photos/${dateOnly}/${record.photo}` : '';

            xPos = 45;
            const rowData = [dateOnly, record.time || '-', status, record.session || '-', record.section || '-', photoPath.substring(0, 25)];

            rowData.forEach((cell, j) => {
                if (j === 2) {
                    switch (cell.toLowerCase()) {
                        case 'present': doc.fillColor('#22C55E'); break;
                        case 'late': doc.fillColor('#EAB308'); break;
                        case 'absent': doc.fillColor('#EF4444'); break;
                        case 'excused': doc.fillColor('#3B82F6'); break;
                        default: doc.fillColor('#333333');
                    }
                } else { doc.fillColor('#333333'); }
                doc.text(cell, xPos, rowTop + 3, { width: colWidths[j] - 5 });
                xPos += colWidths[j];
            });

            rowTop += rowHeight;
        }

        // Empty state
        if (records.length === 0) {
            doc.fillColor('#999999').fontSize(11)
               .text('No attendance records found.', 40, rowTop + 20, { align: 'center', width: pageWidth });
        }

        // ---- FOOTER ----
        const totalPages = doc.bufferedPageRange().count;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);
            doc.rect(40, doc.page.height - 50, pageWidth, 1).fill('#E0E0E0');
            doc.fontSize(8).fillColor('#999999')
               .text('TAMTAP Attendance System | NFC-Based Attendance | FEU Roosevelt Marikina',
                   40, doc.page.height - 40, { align: 'center', width: pageWidth })
               .text(`Page ${i + 1} of ${totalPages} | Capstone by group 5 of Grade 12 ICT B
 S.Y. 2025-2026`,
                   40, doc.page.height - 28, { align: 'center', width: pageWidth });
        }

        doc.end();
    } catch (error) {
        console.error('[ERROR] Student PDF export:', error.message, error.stack);
        if (!res.headersSent) res.status(500).json({ error: 'Export failed', details: error.message });
    }
});

module.exports = router;
