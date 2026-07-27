const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const { encryptPII } = require('./utils/cryptoUtils');

async function runDataMigration() {
    const csvPath = path.join(__dirname, 'decrypted_patients.csv');
    const donePath = path.join(__dirname, 'decrypted_patients.done.csv');

    if (!fs.existsSync(csvPath)) {
        return; // Nothing to migrate or already done
    }

    console.log("🔄 Found decrypted_patients.csv, running data migration...");

    const data = fs.readFileSync(csvPath, 'utf8');
    const lines = data.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length < 1) {
        console.log("CSV is empty. Renaming to .done");
        fs.renameSync(csvPath, donePath);
        return;
    }

    const idIdx = 0;
    const ssnIdx = 2;
    const dobIdx = 3;
    const dlIdx = 4;

    const client = await pool.connect();
    let updatedCount = 0;
    
    console.log(`Found ${lines.length} records to process...`);

    try {
        await client.query('BEGIN');
        
        for (let i = 0; i < lines.length; i++) {
            const cols = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
            const cleanCols = cols.map(s => s.trim().replace(/^"|"$/g, ''));
            
            const id = cleanCols[idIdx];
            let ssn = ssnIdx !== -1 ? cleanCols[ssnIdx] : null;
            let dob = dobIdx !== -1 ? cleanCols[dobIdx] : null;
            let dl = dlIdx !== -1 ? cleanCols[dlIdx] : null;

            if (ssn === 'NULL' || ssn === '') ssn = null;
            if (dob === 'NULL' || dob === '') dob = null;
            if (dl === 'NULL' || dl === '') dl = null;

            if (!id || isNaN(id)) continue;

            const encSsn = ssn ? encryptPII(ssn) : null;
            const encDob = dob ? encryptPII(dob) : null;
            const encDl = dl ? encryptPII(dl) : null;

            if (encSsn || encDob || encDl) {
                await client.query(
                    `UPDATE patient 
                     SET ssn = COALESCE($1, ssn), 
                         dob = COALESCE($2, dob), 
                         driving_license = COALESCE($3, driving_license) 
                     WHERE id = $4`,
                    [encSsn, encDob, encDl, id]
                );
                updatedCount++;
            }
        }
        
        await client.query('COMMIT');
        console.log(`✅ Success! Updated ${updatedCount} patients with Node.js encrypted data.`);
        
        // Rename file so it doesn't run again on next restart
        fs.renameSync(csvPath, donePath);
        console.log(`Renamed CSV to decrypted_patients.done.csv`);

    } catch(e) {
        await client.query('ROLLBACK');
        console.error("❌ Error during data migration, transaction rolled back:", e);
    } finally {
        client.release();
    }
}

module.exports = { runDataMigration };

// If executed directly from command line
if (require.main === module) {
    runDataMigration().then(() => process.exit(0));
}
