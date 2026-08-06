/**
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let u = raw.trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) {
        u = `https://${u}`;
    }
    try {
        const parsed = new URL(u);
        parsed.hash = '';
        let pathname = parsed.pathname;
        if (pathname.length > 1 && pathname.endsWith('/')) {
            pathname = pathname.slice(0, -1);
        }
        parsed.pathname = pathname;
        return parsed.toString();
    } catch {
        return null;
    }
}

/**
 * @param {string | null} url
 * @returns {string | null}
 */
export function siteFromUrl(url) {
    if (!url) return null;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host.startsWith('www.') ? host.slice(4) : host;
    } catch {
        return null;
    }
}

/**
 * @param {string} url
 * @param {string} other
 */
export function urlMatches(url, other) {
    const a = normalizeUrl(url);
    const b = normalizeUrl(other);
    if (!a || !b) return false;
    if (a === b) return true;
    try {
        const ua = new URL(a);
        const ub = new URL(b);
        if (ua.origin !== ub.origin) return false;
        return ub.pathname.startsWith(ua.pathname) || ua.pathname.startsWith(ub.pathname);
    } catch {
        return false;
    }
}
