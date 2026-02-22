/**
 * TAMTAP - Bulk Register 50 RFID Cards (DATA GATHER 1-5)
 * One-time script: reads rfid_registry.xlsx and inserts 50 students
 * Split into 5 sections of 10 students each
 * 
 * Section mapping:
 *   Cards 001-010 → DATA GATHER 1
 *   Cards 011-020 → DATA GATHER 2
 *   Cards 021-030 → DATA GATHER 3
 *   Cards 031-040 → DATA GATHER 4
 *   Cards 041-050 → DATA GATHER 5
 * 
 * TAMTAP IDs: 001-050 (forced)
 * Grade: 11
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

const GRADE = '11';
const NAME_PREFIX = 'Tam';
const TOTAL_CARDS = 50;
const BATCH_SIZE = 10;
const NUM_BATCHES = 5;

function getSectionName(cardIndex) {
    // 0-9 → DATA GATHER 1, 10-19 → DATA GATHER 2, etc.
    const batch = Math.floor(cardIndex / BATCH_SIZE) + 1;
    return `DATA GATHER ${batch}`;
}

async function main() {
    console.log('='.repeat(55));
    console.log('  TAMTAP - Bulk Register DATA GATHER Cards');
    console.log('='.repeat(55));
    console.log(`  Grade:     ${GRADE}`);
    console.log(`  Sections:  DATA GATHER 1 → DATA GATHER ${NUM_BATCHES}`);
    console.log(`  Per batch: ${BATCH_SIZE} students`);
    console.log(`  IDs:       001 → ${String(TOTAL_CARDS).padStart(3, '0')}`);
    console.log(`  Names:     ${NAME_PREFIX} 001 → ${NAME_PREFIX} ${String(TOTAL_CARDS).padStart(3, '0')}`);
    console.log('='.repeat(55));

    // 1. Read Excel
    console.log('\n[1/5] Reading rfid_registry.xlsx...');
    const wb = xlsx.readFile(XLSX_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allRows = xlsx.utils.sheet_to_json(ws);

    const cards = allRows.filter(r => r.tamtap_Id && r.nfc_Id && !isNaN(parseInt(r.tamtap_Id)));
    
    if (cards.length < TOTAL_CARDS) {
        console.error(`[ERROR] Expected ${TOTAL_CARDS} cards, found ${cards.length}`);
        process.exit(1);
    }

    console.log(`  Found ${cards.length} valid RFID entries`);

    // 2. Connect to MongoDB
    console.log('\n[2/5] Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_NAME);
    console.log(`  Connected to: ${MONGODB_NAME}`);

    // 3. Cleanup old DATA GATHER entries
    console.log('\n[3/5] Cleaning up old DATA GATHER entries...');
    const nfcIdsToInsert = cards.slice(0, TOTAL_CARDS).map(c => String(c.nfc_Id));
    
    // Remove from students (active)
    const activeDeleted = await db.collection('students').deleteMany({
        nfc_id: { $in: nfcIdsToInsert }
    });
    console.log(`  Removed ${activeDeleted.deletedCount} from active students`);

    // Remove from archived_students
    const archivedDeleted = await db.collection('archived_students').deleteMany({
        nfc_id: { $in: nfcIdsToInsert }
    });
    console.log(`  Removed ${archivedDeleted.deletedCount} from archived students`);

    // 4. Insert students
    console.log('\n[4/5] Registering students across 5 sections...');
    let success = 0;

    for (let i = 0; i < TOTAL_CARDS; i++) {
        const card = cards[i];
        const nfcId = String(card.nfc_Id);
        const cardNum = String(i + 1).padStart(3, '0');
        const tamtapId = cardNum;  // Forced: 001-050
        const studentName = `${NAME_PREFIX} ${cardNum}`;
        const section = getSectionName(i);

        await db.collection('students').insertOne({
            nfc_id: nfcId,
            tamtap_id: tamtapId,
            name: studentName,
            first_name: NAME_PREFIX,
            last_name: cardNum,
            grade: GRADE,
            section: section,
            registered: new Date().toISOString()
        });

        success++;
        console.log(`  ✓ ${tamtapId} | ${studentName} | ${section} | NFC: ${nfcId}`);
    }

    // 5. Summary
    console.log('\n[5/5] Summary');
    console.log('='.repeat(55));
    console.log('  REGISTRATION COMPLETE');
    console.log('='.repeat(55));
    console.log(`  ✓ Registered: ${success}`);
    console.log(`  Total cards:  ${TOTAL_CARDS}`);
    console.log('');
    for (let b = 1; b <= NUM_BATCHES; b++) {
        const start = String((b - 1) * BATCH_SIZE + 1).padStart(3, '0');
        const end = String(b * BATCH_SIZE).padStart(3, '0');
        console.log(`  DATA GATHER ${b}: ${NAME_PREFIX} ${start} → ${NAME_PREFIX} ${end}`);
    }
    console.log('='.repeat(55));

    await client.close();
    process.exit(0);
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
});
