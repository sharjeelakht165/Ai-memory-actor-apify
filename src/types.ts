export interface DecayConfig {
    enabled: boolean;
    halfLifeDays: number;      // default 30 - days for importance to halve
    minImportance: number;     // default 0.1 - minimum importance before archiving
    pruneThreshold: number;    // default 0.05 - importance threshold for pruning
    maxMemoriesPerUser: number; // default 1000 - max active memories
}

export interface SearchResult {
    memory: Memory;
    score: number;             // TF-IDF relevance score
    matchedTerms: string[];    // terms that matched
}

export interface SearchOptions {
    limit?: number;            // max results (default 20)
    category?: string;         // filter by category
    includeArchived?: boolean; // include archived memories (default false)
    minScore?: number;         // minimum score threshold
}

export interface MemoryDetails {
    content?: string;
    title?: string;
    url?: string;
    memoryType?: string;
    tags?: string[];
    confidence?: number;
    importance?: number;
    category?: string;
    source?: 'agent' | 'human' | 'crawl';
    relatedUrls?: string[];
    metadata?: Record<string, unknown>;
}

export interface Memory {
    id: string;
    url?: string | null;
    site?: string | null;
    title: string;
    content: string;
    memoryType: string;
    tags: string[];
    confidence: number;
    source: string;
    projectId?: string | null;
    relatedUrls: string[];
    createdAt: string;
    updatedAt: string;
    contentHash: string;
    archived?: boolean;         // defaults to false
    decayedImportance?: number; // current importance after decay
    importance?: number;
    category?: string;
}

export interface ActorInput {
    action: 'remember' | 'recall' | 'search' | 'forget' | 'context_pack' | 'update' | 'stats' | 'prune';
    memoryStoreId: string;
    url?: string;
    content?: string;
    query?: string;
    memoryId?: string;
    projectId?: string;
    maxResults?: number;
    maxTokens?: number;
    idempotencyKey?: string;
    memoryDetails?: MemoryDetails;
    decayConfig?: DecayConfig;
    searchOptions?: SearchOptions;
    updates?: Partial<MemoryDetails>;
}
