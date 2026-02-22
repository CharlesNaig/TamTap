/**
 * TAMTAP - Bulk Register 50 RFID Cards (DATA GATHER)
 * One-time script: reads rfid_registry.xlsx and inserts 50 students
 * 
 * Names:   Tamaraw 001 - Tamaraw 050
 * Grade:   Grade 11
 * Section: DATA GATHER
 * 
 * Usage: node scripts/bulk_register_datagather.js
 */

const path = require('path');

// Resolve modules from software/node_modules
const softwareDir = path.join(__dirname, '..', 'software');
require(path.join(softwareDir, 'node_modules', 'dotenv')).config({ 
    path: path.join(__dirname, '..', '.env') 
});
const { MongoClient } = require(path.join(softwareDir, 'node_modules', 'mongodb'));
const xlsx = require(path.join(softwareDir, 'node_modules', 'xlsx'));

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_NAME = process.env.MONGODB_NAME || 'tamtap';
const XLSX_PATH = path.join(__dirname, '..', 'rfid_registry.xlsx');

const GRADE = 'Grade 11';
const SECTION = 'DATA GATHER';
const NAME_PREFIX = 'Tamaraw';
const TOTAL_CARDS = 50;

async function main() {
    console.log('='.repeat(55));
    console.log('  TAMTAP - Bulk Register DATA GATHER Cards');
    console.log('='.repeat(55));
    console.log(`  Grade:   ${GRADE}`);
    console.log(`  Section: ${SECTION}`);
    console.log(`  Names:   ${NAME_PREFIX} 001 → ${NAME_PREFIX} ${String(TOTAL_CARDS).padStart(3, '0')}`);
    console.log('='.repeat(55));

    // 1. Read Excel
    console.log('\n[1/4] Reading rfid_registry.xlsx...');
    const wb = xlsx.readFile(XLSX_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allRows = xlsx.utils.sheet_to_json(ws);

    // Filter to only valid rows (001-050 with nfc_Id)
    const cards = allRows.filter(r => r.tamtap_Id && r.nfc_Id && !isNaN(parseInt(r.tamtap_Id)));
    
    if (cards.length < TOTAL_CARDS) {
        console.error(`[ERROR] Expected ${TOTAL_CARDS} cards, found ${cards.length}`);
        process.exit(1);
    }

    console.log(`  Found ${cards.length} valid RFID entries`);

    // 2. Connect to MongoDB
    console.log('\n[2/4] Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_NAME);
    console.log(`  Connected to: ${MONGODB_NAME}`);

    // 3. Check existing students & get next tamtap_id
    console.log('\n[3/4] Checking for duplicates...');
    const existingNfcIds = await db.collection('students')
        .find({}, { projection: { nfc_id: 1 } })
        .toArray();
    const existingSet = new Set(existingNfcIds.map(s => String(s.nfc_id)));

    const lastStudent = await db.collection('students')
        .find({})
        .sort({ tamtap_id: -1 })
        .limit(1)
        .toArray();
    
    let nextId = lastStudent.length > 0
        ? (parseInt(lastStudent[0].tamtap_id) || 0) + 1
        : 1;

    console.log(`  Existing students in DB: ${existingNfcIds.length}`);
    console.log(`  Next tamtap_id: ${String(nextId).padStart(3, '0')}`);

    // 4. Insert students
    console.log('\n[4/4] Registering students...');
    let success = 0;
    let skipped = 0;
    const skippedList = [];

    for (let i = 0; i < TOTAL_CARDS; i++) {
        const card = cards[i];
        const nfcId = String(card.nfc_Id);
        const cardNum = String(i + 1).padStart(3, '0');
        const studentName = `${NAME_PREFIX} ${cardNum}`;

        if (existingSet.has(nfcId)) {
            skipped++;
            skippedList.push(`  ⊘ ${studentName} (NFC: ${nfcId}) — already exists`);
            continue;
        }

        const tamtapId = String(nextId++).padStart(3, '0');

        await db.collection('students').insertOne({
            nfc_id: nfcId,
            tamtap_id: tamtapId,
            name: studentName,
            first_name: NAME_PREFIX,
            last_name: cardNum,
            grade: GRADE,
            section: SECTION,
            registered: new Date().toISOString()
        });

        success++;
        console.log(`  ✓ ${tamtapId} | ${studentName} | NFC: ${nfcId}`);
    }

    // Summary
    console.log('\n' + '='.repeat(55));
    console.log('  REGISTRATION COMPLETE');
    console.log('='.repeat(55));
    console.log(`  ✓ Registered: ${success}`);
    console.log(`  ⊘ Skipped:    ${skipped}`);
    console.log(`  Total cards:  ${TOTAL_CARDS}`);
    
    if (skippedList.length > 0) {
        console.log('\n  Skipped (already in DB):');
        skippedList.forEach(s => console.log(s));
    }

    console.log('='.repeat(55));

    await client.close();
    process.exit(0);
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
});
