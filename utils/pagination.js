const { query, queryOne } = require('../db');

function wantsPagination(query) {
    return query.page !== undefined || query.limit !== undefined;
}

function parsePagination(query, { defaultLimit = 25, maxLimit = 100 } = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

function paginatedResult(items, total, { page, limit }) {
    const totalNum = Number(total) || 0;
    return {
        items,
        total: totalNum,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalNum / limit) || 1),
    };
}

/**
 * Run a list query with optional server-side pagination.
 * When page/limit query params are absent, returns the full result (legacy array).
 */
async function executeListQuery(req, {
    dataSql,
    countSql,
    params = [],
    orderBy = 'ORDER BY id DESC',
    legacyLimit,
    defaultLimit = 25,
    mapRow = (row) => row,
}) {
    if (!wantsPagination(req.query)) {
        const limitClause = legacyLimit ? ` LIMIT ${legacyLimit}` : '';
        const { rows } = await query(`${dataSql} ${orderBy}${limitClause}`, params);
        return { paginated: false, data: rows.map(mapRow) };
    }

    const pg = parsePagination(req.query, { defaultLimit });
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const dataParams = [...params, pg.limit, pg.offset];

    const [countRow, dataResult] = await Promise.all([
        queryOne(countSql, params),
        query(
            `${dataSql} ${orderBy} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            dataParams,
        ),
    ]);

    return {
        paginated: true,
        data: paginatedResult(dataResult.rows.map(mapRow), countRow?.total ?? 0, pg),
    };
}

async function respondListQuery(req, res, resp, options) {
    const result = await executeListQuery(req, options);
    return resp(res, '200', result.data);
}

module.exports = {
    wantsPagination,
    parsePagination,
    paginatedResult,
    executeListQuery,
    respondListQuery,
};
