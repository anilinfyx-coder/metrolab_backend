const { pool } = require('./db.js');

async function fixAllSequences() {
    try {
        console.log('Fetching all sequences and fixing them...');
        
        // Find all sequences in the public schema
        const query = `
            SELECT
                t.relname AS table_name,
                c.attname AS column_name,
                s.relname AS sequence_name
            FROM pg_class s
            JOIN pg_depend d ON d.objid = s.oid
            JOIN pg_class t ON d.refobjid = t.oid
            JOIN pg_attribute c ON c.attrelid = t.oid AND c.attnum = d.refobjsubid
            WHERE s.relkind = 'S' AND d.deptype = 'a';
        `;

        const { rows } = await pool.query(query);

        for (const row of rows) {
            const { table_name, column_name, sequence_name } = row;
            try {
                // Get the max value
                const maxRes = await pool.query(`SELECT MAX("${column_name}") as max_val FROM "${table_name}"`);
                const maxVal = maxRes.rows[0].max_val || 1;
                
                // Set the sequence
                await pool.query(`SELECT setval('${sequence_name}', ${maxVal})`);
                console.log(`✅ Fixed sequence for ${table_name}.${column_name} -> ${sequence_name} (Max: ${maxVal})`);
            } catch (err) {
                console.error(`❌ Failed to fix sequence for ${table_name}: ${err.message}`);
            }
        }
        
        console.log('All sequences updated successfully!');
    } catch (err) {
        console.error('Error fixing sequences:', err);
    } finally {
        pool.end();
    }
}

fixAllSequences();
