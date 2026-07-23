/** Production frontend URL for email links (login / password reset). No trailing slash. */
const FRONTEND_BASE_URL = 'https://lab.metrolab.biz';

function getFrontendBaseUrl(custom_domain) {
    if (custom_domain) {
        return custom_domain.startsWith('http') ? custom_domain : `https://${custom_domain}`;
    }
    return FRONTEND_BASE_URL;
}

function getLoginUrl(custom_domain) {
    return `${getFrontendBaseUrl(custom_domain)}/`;
}

module.exports = {
    FRONTEND_BASE_URL,
    getFrontendBaseUrl,
    getLoginUrl,
};
