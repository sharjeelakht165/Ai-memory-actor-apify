export interface DecayConfig {
    enabled: boolean;
    halfLifeDays: number;
    minImportance: number;
    pruneThreshold: number;
    maxMemoriesPerUser: number;
}
export interface SearchResult {
    memory: Memory;
    score: number;
    matchedTerms: string[];
}
export interface SearchOptions {
    limit?: number;
    category?: string;
    includeArchived?: boolean;
    minScore?: number;
}
export interface MemoryDetails {
    content?: string;
    title?: string;
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
    archived?: boolean;
    decayedImportance?: number;
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
