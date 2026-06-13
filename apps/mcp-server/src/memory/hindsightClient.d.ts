export interface HindsightClientOptions {
    bankUrl: string;
    apiKey: string;
}
export interface MemoryItem {
    content: string;
    metadata?: Record<string, string>;
    tags?: string[];
}
export declare class HindsightClient {
    private baseUrl;
    private bankId;
    private apiKey;
    constructor(options: HindsightClientOptions);
    /**
     * Sync a single memory item to the Hindsight bank
     */
    retain(content: string, metadata?: Record<string, string>, tags?: string[]): Promise<void>;
    /**
     * Recall relevant memories from the Hindsight bank
     */
    recall(query: string, options?: {
        tags?: string[];
        limit?: number;
    }): Promise<any>;
}
//# sourceMappingURL=hindsightClient.d.ts.map