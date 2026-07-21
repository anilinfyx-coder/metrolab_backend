// Generic CRUD route factory using raw pg SQL
// Usage: app.use('/api/SomeModel', crudRoutes('some_table'));
const express = require('express');
const { query, queryOne } = require('../db');

const resp = (res, code, obj) => res.json({ response_code: code, obj });

/**
 * Creates standard CRUD routes for a given PostgreSQL table.
 * @param {string} table - The exact PostgreSQL table name
 * @param {string[]} insertFields - Array of column names for INSERT
 */
const crudRoutes = (table, insertFields = []) => {
    const router = express.Router();

    // GET all (with optional simple filtering)
    router.get('/', async (req, res) => {
        try {
            let whereClause = "WHERE deleted = false";
            const values = [];
            let index = 1;

            // Dropdown/consumer lists: ?status=true → only enabled rows.
            // Management lists omit status and still receive all non-deleted rows.
            if (req.query.status !== undefined && String(req.query.status).trim() !== '') {
                const raw = String(req.query.status).trim().toLowerCase();
                const wantActive = raw === 'true' || raw === '1' || raw === 'active';
                const wantInactive = raw === 'false' || raw === '0' || raw === 'inactive';
                if (wantActive) {
                    whereClause += ` AND status IS DISTINCT FROM false`;
                } else if (wantInactive) {
                    whereClause += ` AND status = false`;
                }
            }
            
            // Allow basic filtering by known keys
            const filterable = ['lab_test_id', 'drug_id', 'b2b_client_id', 'corporate_client_id', 'specimen_type_id', 'country_id', 'state_id', 'city_id', 'district_id'];
            for (const key of filterable) {
                if (req.query[key] !== undefined) {
                    if (key === 'b2b_client_id') {
                        whereClause += ` AND (${key} = $${index++} OR ${key} IS NULL)`;
                    } else {
                        whereClause += ` AND ${key} = $${index++}`;
                    }
                    values.push(req.query[key]);
                }
            }

            const { rows } = await query(
                `SELECT * FROM ${table} ${whereClause} ORDER BY id DESC`, values
            );
            return resp(res, '200', rows);
        } catch (err) { return resp(res, '500', err.message); }
    });

    // GET by id
    router.get('/:id', async (req, res) => {
        try {
            const row = await queryOne(
                `SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [req.params.id]
            );
            if (!row) return resp(res, '404', `${table} not found`);
            return resp(res, '200', row);
        } catch (err) { return resp(res, '500', err.message); }
    });

    // POST create (dynamic — uses whatever keys are in req.body)
    router.post('/', async (req, res) => {
        try {
            const body = { ...req.body };
            delete body.id; // never allow client to set id
            // These are always set by the server on create
            delete body.status;
            delete body.deleted;
            delete body.creation_timestamp;
            delete body.deleted_timestamp;
            const fields = Object.keys(body);
            if (fields.length === 0) return resp(res, '400', 'No data provided');
            const cols   = fields.join(', ');
            const vals   = fields.map((_, i) => `$${i + 1}`).join(', ');
            const values = fields.map(f => body[f]);
            const row = await queryOne(
                `INSERT INTO ${table} (${cols}, status, deleted, creation_timestamp)
                 VALUES (${vals}, true, false, NOW()) RETURNING *`,
                values
            );
            return resp(res, '200', row);
        } catch (err) { return resp(res, '500', err.message); }
    });

    // PUT update (dynamic)
    router.put('/:id', async (req, res) => {
        try {
            const body = { ...req.body };
            delete body.id;
            const fields = Object.keys(body);
            if (fields.length === 0) return resp(res, '400', 'No data to update');
            const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
            const values    = fields.map(f => body[f]);
            values.push(req.params.id);
            const row = await queryOne(
                `UPDATE ${table} SET ${setClause} WHERE id = $${values.length} RETURNING *`,
                values
            );
            return resp(res, '200', row);
        } catch (err) { return resp(res, '500', err.message); }
    });

    // DELETE (soft delete)
    router.delete('/:id', async (req, res) => {
        try {
            const row = await queryOne(
                `UPDATE ${table} SET deleted = true, deleted_timestamp = NOW() WHERE id = $1 RETURNING *`,
                [req.params.id]
            );
            return resp(res, '200', row);
        } catch (err) { return resp(res, '500', err.message); }
    });

    return router;
};

module.exports = { crudRoutes };
