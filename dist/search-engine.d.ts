export class SearchEngine {
    /**
     * Tokenize text into lowercase terms.
     * Lowercase, split on non-alphanumeric, remove stopwords and single chars.
     * @param {string} text
     * @returns {string[]}
     */
    tokenize(text: string): string[];
    /**
     * Calculate term frequency for a single document.
     * TF(t,d) = count(t in d) / total_terms_in_d
     * @param {string[]} terms
     * @returns {Map<string, number>}
     */
    calculateTF(terms: string[]): Map<string, number>;
    /**
     * Calculate inverse document frequency across all documents.
     * IDF(t) = log(N / df(t)) where df = number of docs containing term
     * @param {string[][]} documents - array of tokenized documents
     * @returns {Map<string, number>}
     */
    calculateIDF(documents: string[][]): Map<string, number>;
    /**
     * Calculate recency boost using exponential decay.
     * boost = e^(-daysSinceUpdate / 30)
     * Range: 0 to 1 (1 = updated today)
     * @param {MemoryRecord} memory
     * @returns {number}
     */
    recencyBoost(memory: MemoryRecord): number;
    /**
     * Search memories with TF-IDF scoring and relevance modifiers.
     * @param {string} query
     * @param {MemoryRecord[]} memories
     * @param {SearchOptions} [options]
     * @returns {SearchResult[]}
     */
    search(query: string, memories: MemoryRecord[], options?: SearchOptions): SearchResult[];
}
export type MemoryRecord = import("./memory-store.js").MemoryRecord;
export type SearchOptions = {
    limit?: number | undefined;
    memoryType?: string | undefined;
    includeArchived?: boolean | undefined;
    minScore?: number | undefined;
    projectId?: string | null | undefined;
};
export type SearchResult = {
    memory: MemoryRecord;
    score: number;
    matchedTerms: string[];
};
