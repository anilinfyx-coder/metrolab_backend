const { query } = require('./db');
async function run() {
    try {
        await query("UPDATE lab_test_category_report SET final_result = 'Negative' WHERE final_result = '1'");
        await query("UPDATE lab_test_category_report SET final_result = 'Positive' WHERE final_result = '2'");
        await query("UPDATE lab_test_category_report SET final_result = 'Test Cancelled' WHERE final_result = '3'");
        await query("UPDATE lab_test_category_report SET final_result = 'Refusal (Adulterated)' WHERE final_result = '4'");
        await query("UPDATE lab_test_category_report SET final_result = 'Refusal (Substituted)' WHERE final_result = '5'");
        await query("UPDATE lab_test_category_report SET final_result = 'Dilute' WHERE final_result = '6'");
        console.log('Updated db');
    } catch (e) { console.error(e); }
    finally { process.exit(); }
}
run();
