/**
 * TAMTAP Export Routes
 * Generate XLSX and PDF attendance reports
 * 
 * GET /api/export/xlsx - Export attendance as XLSX
 * GET /api/export/pdf  - Export attendance as PDF
 * 
 * Query params:
 *   section  - Filter by section
 *   from     - Start date (YYYY-MM-DD)
 *   to       - End date (YYYY-MM-DD)
 *   date     - Single date (YYYY-MM-DD)
 */

const express = require('express');
const path = require('path');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');

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
    
    const records = await db.collection('attendance')
        .find(query)
        .sort({ date: -1, time: 1 })
        .toArray();
    
    return records;
}

// ========================================
// HELPER: Get student info
// ========================================
async function getStudentInfo(db, nfcId) {
    return await db.collection('students').findOne({ nfc_id: nfcId });
}

// ========================================
// GET /api/export/xlsx
// Export attendance as XLSX file
// ========================================
router.get('/xlsx', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Check if ExcelJS is available
        let ExcelJS;
        try {
            ExcelJS = require('exceljs');
        } catch (e) {
            return res.status(500).json({ 
                error: 'ExcelJS not installed. Run: npm install exceljs' 
            });
        }
        
        const { section, from, to, date } = req.query;
        
        // Get user's sections if teacher
        let sections = null;
        if (req.user.role === 'teacher') {
            sections = req.user.sections_handled || [];
            if (section && !sections.includes(section)) {
                return res.status(403).json({ error: 'Access denied to this section' });
            }
        }
        
        // Get attendance data
        const records = await getAttendanceForExport(db, {
            section: section,
            sections: req.user.role === 'teacher' ? sections : null,
            from, to, date
        });
        
        if (records.length === 0) {
            return res.status(404).json({ error: 'No attendance records found' });
        }
        
        // Create workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'TAMTAP Attendance System';
        workbook.created = new Date();
        
        const worksheet = workbook.addWorksheet('Attendance Report');
        
        // Define columns based on the format requested
        worksheet.columns = [
            { header: 'Student Name', key: 'name', width: 25 },
            { header: 'Student Email', key: 'email', width: 30 },
            { header: 'Section', key: 'section', width: 12 },
            { header: 'Date', key: 'date', width: 12 },
            { header: 'Status', key: 'status', width: 10 },
            { header: 'Time', key: 'time', width: 10 },
            { header: 'TAMTAP ID', key: 'tamtap_id', width: 12 },
            { header: 'NFC ID', key: 'nfc_id', width: 15 },
            { header: 'Photo', key: 'photo', width: 40 }
        ];
        
        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0A8249' } // FEU Green
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        
        // Add data rows
        for (const record of records) {
            // Get student info for email
            const student = await getStudentInfo(db, record.nfc_id);
            
            const dateOnly = record.date ? record.date.split(' ')[0] : '';
            const photoPath = record.photo ? `/photos/${dateOnly}/${record.photo}` : '';
            
            worksheet.addRow({
                name: record.name || '',
                email: student?.email || record.email || '',
                section: record.section || '',
                date: dateOnly,
                status: record.status || 'present',
                time: record.time || '',
                tamtap_id: record.tamtap_id || '',
                nfc_id: record.nfc_id || '',
                photo: photoPath
            });
        }
        
        // Auto-filter
        worksheet.autoFilter = {
            from: 'A1',
            to: `I${records.length + 1}`
        };
        
        // Generate filename
        const dateStr = date || `${from || 'all'}_to_${to || 'now'}`;
        const sectionStr = section || 'all-sections';
        const filename = `TAMTAP_Attendance_${sectionStr}_${dateStr}.xlsx`;
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
        console.log(`[INFO] XLSX export: ${records.length} records by ${req.user.username}`);
        
    } catch (error) {
        console.error('[ERROR] XLSX export error:', error.message);
        res.status(500).json({ error: 'Failed to generate XLSX export' });
    }
});

// ========================================
// GET /api/export/pdf
// Export attendance as PDF file
// ========================================
router.get('/pdf', async (req, res) => {
    try {
        const db = req.db;
        if (!db) {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        // Check if PDFKit is available
        let PDFDocument;
        try {
            PDFDocument = require('pdfkit');
        } catch (e) {
            return res.status(500).json({ 
                error: 'PDFKit not installed. Run: npm install pdfkit' 
            });
        }
        
        const { section, from, to, date } = req.query;
        
        // Get user's sections if teacher
        let sections = null;
        if (req.user.role === 'teacher') {
            sections = req.user.sections_handled || [];
            if (section && !sections.includes(section)) {
                return res.status(403).json({ error: 'Access denied to this section' });
            }
        }
        
        // Get attendance data
        const records = await getAttendanceForExport(db, {
            section: section,
            sections: req.user.role === 'teacher' ? sections : null,
            from, to, date
        });
        
        if (records.length === 0) {
            return res.status(404).json({ error: 'No attendance records found' });
        }
        
        // Create PDF document
        const doc = new PDFDocument({ 
            size: 'A4', 
            margin: 40,
            info: {
                Title: 'TAMTAP Attendance Report',
                Author: 'TAMTAP Attendance System',
                Subject: 'Attendance Report'
            }
        });
        
        // Generate filename
        const dateStr = date || `${from || 'all'}_to_${to || 'now'}`;
        const sectionStr = section || 'all-sections';
        const filename = `TAMTAP_Attendance_${sectionStr}_${dateStr}.pdf`;
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Pipe PDF to response
        doc.pipe(res);
        
        // ========================================
        // PDF HEADER
        // ========================================
        const pageWidth = doc.page.width - 80; // margins
        
        // Try to add logo
        const logoPath = path.resolve(__dirname, '../../assets/logos/TamTap-3D.png');
        try {
            const fs = require('fs');
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 40, 30, { width: 50 });
            }
        } catch (e) {
            // Logo not available, continue without it
        }
        
        // Title
        doc.fontSize(20)
           .fillColor('#0A8249') // FEU Green
           .text('TAMTAP', 100, 35, { continued: true })
           .fillColor('#333333')
           .text(' Attendance Report');
        
        doc.fontSize(10)
           .fillColor('#666666')
           .text('FEU Roosevelt Marikina | Grade 12 ICT Capstone S.Y. 2025-2026', 100, 60);
        
        // Report info
        doc.moveDown(2);
        doc.fontSize(11)
           .fillColor('#333333');
        
        const reportDate = new Date().toLocaleDateString('en-PH', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        doc.text(`Section: ${section || 'All Sections'}`, 40);
        doc.text(`Date Range: ${date || `${from || 'Start'} to ${to || 'Present'}`}`);
        doc.text(`Generated: ${reportDate}`);
        doc.text(`Total Records: ${records.length}`);
        
        // ========================================
        // PDF TABLE
        // ========================================
        doc.moveDown(1);
        
        // Table header
        const tableTop = doc.y;
        const colWidths = [150, 70, 60, 60, 60, 80]; // Name, Section, Date, Status, Time, TamTap ID
        const colHeaders = ['Student Name', 'Section', 'Date', 'Status', 'Time', 'TAMTAP ID'];
        
        // Header background
        doc.fillColor('#0A8249')
           .rect(40, tableTop, pageWidth, 20)
           .fill();
        
        // Header text
        doc.fillColor('#FFFFFF')
           .fontSize(9);
        
        let xPos = 45;
        colHeaders.forEach((header, i) => {
            doc.text(header, xPos, tableTop + 5, { width: colWidths[i] - 5 });
            xPos += colWidths[i];
        });
        
        // Table rows
        let rowTop = tableTop + 25;
        doc.fillColor('#333333')
           .fontSize(8);
        
        for (let i = 0; i < Math.min(records.length, 30); i++) { // Limit to 30 per page for now
            const record = records[i];
            const dateOnly = record.date ? record.date.split(' ')[0] : '';
            
            // Alternate row background
            if (i % 2 === 0) {
                doc.fillColor('#F5F5F5')
                   .rect(40, rowTop - 3, pageWidth, 18)
                   .fill();
            }
            
            // Row data
            doc.fillColor('#333333');
            xPos = 45;
            
            const rowData = [
                record.name || 'Unknown',
                record.section || '-',
                dateOnly,
                record.status || 'present',
                record.time || '-',
                record.tamtap_id || '-'
            ];
            
            rowData.forEach((cell, j) => {
                // Truncate if too long
                const maxChars = Math.floor(colWidths[j] / 5);
                const text = cell.length > maxChars ? cell.substring(0, maxChars) + '...' : cell;
                doc.text(text, xPos, rowTop, { width: colWidths[j] - 5 });
                xPos += colWidths[j];
            });
            
            rowTop += 18;
            
            // Check if we need a new page
            if (rowTop > doc.page.height - 80) {
                doc.addPage();
                rowTop = 50;
            }
        }
        
        // More records indicator
        if (records.length > 30) {
            doc.moveDown(1);
            doc.fontSize(9)
               .fillColor('#666666')
               .text(`... and ${records.length - 30} more records. Use XLSX export for complete data.`, 40);
        }
        
        // ========================================
        // PDF FOOTER
        // ========================================
        const bottomY = doc.page.height - 50;
        
        doc.fontSize(8)
           .fillColor('#999999')
           .text('Generated by TAMTAP Attendance System', 40, bottomY, { align: 'center', width: pageWidth })
           .text('NFC-Based Attendance System | FEU Roosevelt Marikina', { align: 'center', width: pageWidth });
        
        // Finalize PDF
        doc.end();
        
        console.log(`[INFO] PDF export: ${records.length} records by ${req.user.username}`);
        
    } catch (error) {
        console.error('[ERROR] PDF export error:', error.message);
        res.status(500).json({ error: 'Failed to generate PDF export' });
    }
});

module.exports = router;
