/** Production frontend URL for email links (login / password reset). No trailing slash. */
const FRONTEND_BASE_URL = 'https://lab.metrolabdc.biz';

function getFrontendBaseUrl() {
    return FRONTEND_BASE_URL;
}

function getLoginUrl() {
    return `${getFrontendBaseUrl()}/`;
}

module.exports = {
    FRONTEND_BASE_URL,
    getFrontendBaseUrl,
    getLoginUrl,
};
