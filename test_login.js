const { queryOne } = require('./db');

(async () => {
    try {
        const client = await queryOne(
            `SELECT * FROM corporate_clients WHERE email = $1 AND deleted = false AND status = true LIMIT 1`,
            ['corporate@metrolab.com']
        );
        console.log("Client found:", !!client);
        if (client) {
            console.log("DB password:", JSON.stringify(client.password));
            const inputPassword = "admin@123";
            console.log("Input password:", JSON.stringify(inputPassword));
            console.log("isMatch =", (inputPassword === client.password));
        }
    } catch (e) {
        console.error(e);
    }
    process.exit();
})();
