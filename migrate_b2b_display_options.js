require('dotenv').config();
const { query } = require('./db');
const { DISPLAY_OPTION_FIELDS } = require('./utils/labTestDisplayOptions');

async function migrate() {
    const columns = [
        'display_options_customized BOOLEAN DEFAULT FALSE',
        ...DISPLAY_OPTION_FIELDS.map((field) => `${field} BOOLEAN`),
    ];

    for (const column of columns) {
        await query(`ALTER TABLE b2b_client_lab_test_access ADD COLUMN IF NOT EXISTS ${column};`);
    }

    console.log('B2B display options migration successful');
    process.exit(0);
}

migrate().catch((err) => {
    console.error(err);
    process.exit(1);
});
