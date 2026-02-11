#!/usr/bin/env node
/**
 * TAMTAP - Photo Filename Migration Script
 * 
 * Renames existing attendance photos to use the sanitized filename format.
 * Specifically handles Filipino names with ñ/Ñ that were previously
 * stripped entirely instead of mapped to n/N.
 * 
 * Also updates the corresponding MongoDB attendance records (photo_path field).
 * 
 * Usage:
 *   node scripts/migrate_photo_filenames.js           # Dry run
 *   node scripts/migrate_photo_filenames.js --apply    # Actually rename
 * 
 * Run from the project root: cd /path/to/TamTap && node scripts/migrate_photo_filenames.js
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------
let config;
try {
    config = require('../software/config');
} catch (e) {
    // Fallback defaults matching tamtap config
    config = {
        MONGODB_URI: 'mongodb://localhost:27017',
        MONGODB_DB: 'tamtap'
    };
}

const MONGO_URI = config.MONGODB_URI || 'mongodb://localhost:27017';
const MONGO_DB = config.MONGODB_DB || 'tamtap';

// Photo directories to scan
const PHOTO_DIRS = [
    path.resolve(__dirname, '..', 'assets', 'attendance_photos'),
    path.resolve(__dirname, '..', 'test', 'attendance_photos'),
    '/home/admin/tamtap-external/attendance_photos'    // External SD on Pi
];

// ------------------------------------------------------------------
// Sanitizer (mirrors hardware/tamtap.py and software/utils/filenameSanitizer.js)
// ------------------------------------------------------------------
const CHAR_MAP = {
    'ñ': 'n', 'Ñ': 'N',
    'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
    'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U'
};

function sanitizePart(text) {
    if (!text) return 'Unknown';
    let normalized = text.normalize('NFC');
    let mapped = '';
    for (const ch of normalized) {
        mapped += CHAR_MAP[ch] || ch;
    }
    let sanitized = mapped.replace(/ /g, '_').replace(/[^A-Za-z0-9_]/g, '_');
    sanitized = sanitized.replace(/_+/g, '_');
    return sanitized.replace(/^_+|_+$/g, '').slice(0, 30);
}

// ------------------------------------------------------------------
// Migration Logic
// ------------------------------------------------------------------
const DRY_RUN = !process.argv.includes('--apply');

async function scanDirectory(dirPath) {
    const renames = [];
    if (!fs.existsSync(dirPath)) return renames;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            // Recurse into date subdirectories (e.g., 2026-01-17/)
            const sub = await scanDirectory(fullPath);
            renames.push(...sub);
            continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.jpg')) continue;

        const original = entry.name;
        const sanitized = sanitizePart(path.basename(original, '.jpg')) + '.jpg';

        if (original !== sanitized) {
            renames.push({
                dir: dirPath,
                oldName: original,
                newName: sanitized,
                oldPath: fullPath,
                newPath: path.join(dirPath, sanitized)
            });
        }
    }
    return renames;
}

async function migrateFiles(renames) {
    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const r of renames) {
        if (DRY_RUN) {
            console.log(`[DRY] ${r.oldName} → ${r.newName}`);
            success++;
            continue;
        }

        try {
            if (fs.existsSync(r.newPath)) {
                console.log(`[SKIP] ${r.newName} already exists`);
                skipped++;
                continue;
            }
            fs.renameSync(r.oldPath, r.newPath);
            console.log(`[OK]   ${r.oldName} → ${r.newName}`);
            success++;
        } catch (err) {
            console.error(`[FAIL] ${r.oldName}: ${err.message}`);
            failed++;
        }
    }
    return { success, skipped, failed };
}

async function updateMongoDB(renames) {
    if (renames.length === 0) return { updated: 0 };

    let client;
    try {
        client = new MongoClient(MONGO_URI);
        await client.connect();
        const db = client.db(MONGO_DB);
        const attendance = db.collection('attendance');

        let updated = 0;
        for (const r of renames) {
            if (DRY_RUN) continue;

            // Match by old filename substring in photo_path
            const result = await attendance.updateMany(
                { photo_path: { $regex: r.oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } },
                [{ $set: { photo_path: { $replaceOne: { input: '$photo_path', find: r.oldName, replacement: r.newName } } } }]
            );
            updated += result.modifiedCount;
        }
        return { updated };
    } catch (err) {
        console.error(`[MONGO] Connection error: ${err.message}`);
        return { updated: 0, error: err.message };
    } finally {
        if (client) await client.close();
    }
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
    console.log('========================================');
    console.log('TAMTAP Photo Filename Migration');
    console.log(DRY_RUN ? '  MODE: DRY RUN (add --apply to rename)' : '  MODE: APPLYING CHANGES');
    console.log('========================================\n');

    let allRenames = [];
    for (const dir of PHOTO_DIRS) {
        console.log(`Scanning: ${dir}`);
        const renames = await scanDirectory(dir);
        console.log(`  Found ${renames.length} file(s) to rename\n`);
        allRenames.push(...renames);
    }

    if (allRenames.length === 0) {
        console.log('No files need renaming. All filenames are already clean.');
        return;
    }

    console.log(`\nTotal: ${allRenames.length} file(s) to rename\n`);

    const fileResult = await migrateFiles(allRenames);
    console.log(`\n--- File Results ---`);
    console.log(`  Renamed: ${fileResult.success}`);
    console.log(`  Skipped: ${fileResult.skipped}`);
    console.log(`  Failed:  ${fileResult.failed}`);

    if (!DRY_RUN) {
        console.log('\nUpdating MongoDB photo_path records...');
        const dbResult = await updateMongoDB(allRenames);
        console.log(`  Updated: ${dbResult.updated} attendance record(s)`);
        if (dbResult.error) console.log(`  Error: ${dbResult.error}`);
    }

    console.log('\nDone.');
}

main().catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
});
