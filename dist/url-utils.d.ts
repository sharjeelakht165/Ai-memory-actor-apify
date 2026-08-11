/**
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw: string): string | null;
/**
 * @param {string | null} url
 * @returns {string | null}
 */
export function siteFromUrl(url: string | null): string | null;
/**
 * @param {string} url
 * @param {string} other
 */
export function urlMatches(url: string, other: string): boolean;
