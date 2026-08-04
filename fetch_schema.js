const { Client } = require('pg');
const client = new Client({ user: 'postgres', host: 'localhost', database: 'metrolab', password: 'postgres', port: 5432 });
client.connect().then(() => Promise.all([
    client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'country'"),
    client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'state'"),
    client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'city'")
])).then(res => {
    console.log('Country:', res[0].rows);
    console.log('State:', res[1].rows);
    console.log('City:', res[2].rows);
    process.exit(0);
});
