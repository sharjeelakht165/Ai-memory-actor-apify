/**
 * TF-IDF Search Engine for memory search.
 * Implements term frequency-inverse document frequency scoring with
 * additional relevance modifiers (recency, confidence, memoryType, tags).
 * Zero external dependencies.
 */

/** @typedef {import('./memory-store.js').MemoryRecord} MemoryRecord */

/**
 * @typedef {object} SearchOptions
 * @property {number} [limit=20]
 * @property {string} [memoryType]
 * @property {boolean} [includeArchived=false]
 * @property {number} [minScore=0]
 * @property {string | null} [projectId]
 */

/**
 * @typedef {object} SearchResult
 * @property {MemoryRecord} memory
 * @property {number} score
 * @property {string[]} matchedTerms
 */

const STOPWORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'between',
    'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
    'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
]);

export class SearchEngine {
    /**
     * Tokenize text into lowercase terms.
     * Lowercase, split on non-alphanumeric, remove stopwords and single chars.
     * @param {string} text
     * @returns {string[]}
     */
    tokenize(text) {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((term) => term.length > 1 && !STOPWORDS.has(term));
    }

    /**
     * Calculate term frequency for a single document.
     * TF(t,d) = count(t in d) / total_terms_in_d
     * @param {string[]} terms
     * @returns {Map<string, number>}
     */
    calculateTF(terms) {
        const tf = new Map();
        const total = terms.length;
        if (total === 0) return tf;

        for (const term of terms) {
            tf.set(term, (tf.get(term) || 0) + 1);
        }
        for (const [term, count] of tf) {
            tf.set(term, count / total);
        }
        return tf;
    }

    /**
     * Calculate inverse document frequency across all documents.
     * IDF(t) = log(N / df(t)) where df = number of docs containing term
     * @param {string[][]} documents - array of tokenized documents
     * @returns {Map<string, number>}
     */
    calculateIDF(documents) {
        const idf = new Map();
        const N = documents.length;
        if (N === 0) return idf;

        const df = new Map();
        for (const docTerms of documents) {
            const uniqueTerms = new Set(docTerms);
            for (const term of uniqueTerms) {
                df.set(term, (df.get(term) || 0) + 1);
            }
        }

        for (const [term, freq] of df) {
            idf.set(term, Math.log(N / freq));
        }
        return idf;
    }

    /**
     * Calculate recency boost using exponential decay.
     * boost = e^(-daysSinceUpdate / 30)
     * Range: 0 to 1 (1 = updated today)
     * @param {MemoryRecord} memory
     * @returns {number}
     */
    recencyBoost(memory) {
        const lastUpdate = memory.updatedAt || memory.createdAt;
        const daysSince = (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60 * 24);
        return Math.exp(-daysSince / 30);
    }

    /**
     * Search memories with TF-IDF scoring and relevance modifiers.
     * @param {string} query
     * @param {MemoryRecord[]} memories
     * @param {SearchOptions} [options]
     * @returns {SearchResult[]}
     */
    search(query, memories, options = {}) {
        const {
            limit = 20,
            memoryType,
            includeArchived = false,
            minScore = 0,
            projectId,
        } = options;

        // Filter memories
        let candidates = memories.filter((m) => {
            if (!includeArchived && m.archived) return false;
            if (memoryType && m.memoryType !== memoryType) return false;
            if (projectId && m.projectId && m.projectId !== projectId) return false;
            return true;
        });

        if (candidates.length === 0) return [];

        // Tokenize all documents and the query
        const docTerms = candidates.map(
            (m) => this.tokenize(`${m.title} ${m.content} ${m.tags.join(' ')} ${m.memoryType}`),
        );
        const queryTerms = this.tokenize(query);

        if (queryTerms.length === 0) return [];

        // Calculate IDF across all candidate documents
        const idf = this.calculateIDF(docTerms);

        // Score each memory
        /** @type {SearchResult[]} */
        const results = candidates.map((memory, idx) => {
            const tf = this.calculateTF(docTerms[idx]);
            let tfidfScore = 0;
            /** @type {string[]} */
            const matchedTerms = [];

            for (const queryTerm of queryTerms) {
                const termTF = tf.get(queryTerm) || 0;
                const termIDF = idf.get(queryTerm) || 0;
                const termScore = termTF * termIDF;

                if (termTF > 0) {
                    tfidfScore += termScore;
                    matchedTerms.push(queryTerm);
                }

                // Partial match bonus: check if query term is a substring of any doc term
                if (termTF === 0) {
                    for (const docTerm of docTerms[idx]) {
                        if (docTerm.includes(queryTerm) || queryTerm.includes(docTerm)) {
                            tfidfScore += 0.05;
                            if (!matchedTerms.includes(queryTerm)) {
                                matchedTerms.push(queryTerm);
                            }
                            break;
                        }
                    }
                }
            }

            // Apply relevance modifiers
            const confidenceBoost = (memory.confidence || 0.5) * 0.3; // confidence contributes 30%
            const recency = this.recencyBoost(memory) * 0.2;           // recency contributes 20%
            const typeBoost = memoryType && memory.memoryType === memoryType ? 0.1 : 0;

            // Tag exact match bonus
            const tagBoost = memory.tags.some((tag) =>
                queryTerms.some((qt) => tag.toLowerCase().includes(qt)),
            ) ? 0.15 : 0;

            // URL/site relevance bonus
            const urlBoost = memory.url && queryTerms.some((qt) =>
                memory.url && memory.url.toLowerCase().includes(qt),
            ) ? 0.1 : 0;

            const finalScore = tfidfScore + confidenceBoost + recency + typeBoost + tagBoost + urlBoost;

            return { memory, score: finalScore, matchedTerms };
        });

        // Filter by minScore, sort by score descending, apply limit
        return results
            .filter((r) => r.score > minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
}
