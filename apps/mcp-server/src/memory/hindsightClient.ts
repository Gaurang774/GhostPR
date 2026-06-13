import { URL } from 'url';

export interface HindsightClientOptions {
  bankUrl: string; // e.g. https://api.hindsight.vectorize.io/mcp/YOUR_BANK/
  apiKey: string;
}

export interface MemoryItem {
  content: string;
  metadata?: Record<string, string>;
  tags?: string[];
}

export class HindsightClient {
  private baseUrl: string;
  private bankId: string;
  private apiKey: string;

  constructor(options: HindsightClientOptions) {
    if (!options.bankUrl) {
      throw new Error('Hindsight bankUrl is required');
    }
    this.apiKey = options.apiKey;

    try {
      const parsedUrl = new URL(options.bankUrl);
      this.baseUrl = parsedUrl.origin;
      
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      if (segments.length === 0) {
        throw new Error('No bank ID found in bankUrl pathname');
      }
      this.bankId = segments[segments.length - 1];
    } catch (err: any) {
      throw new Error(`Failed to parse HINDSIGHT_BANK_URL: ${err.message}`);
    }
  }

  /**
   * Sync a single memory item to the Hindsight bank
   */
  async retain(content: string, metadata?: Record<string, string>, tags?: string[]): Promise<void> {
    const url = `${this.baseUrl}/v1/default/banks/${this.bankId}/memories`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'GhostPR-hindsight-client/0.1.0'
      },
      body: JSON.stringify({
        action: 'retain',
        items: [
          {
            content,
            metadata,
            tags
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hindsight retain failed with status ${response.status}: ${errorText}`);
    }
  }

  /**
   * Recall relevant memories from the Hindsight bank
   */
  async recall(query: string, options?: { tags?: string[]; limit?: number }): Promise<any> {
    const url = `${this.baseUrl}/v1/default/banks/${this.bankId}/memories`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'GhostPR-hindsight-client/0.1.0'
      },
      body: JSON.stringify({
        action: 'recall',
        query,
        tags: options?.tags,
        max_tokens: options?.limit ? options.limit * 100 : undefined
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hindsight recall failed with status ${response.status}: ${errorText}`);
    }

    return response.json();
  }
}
