import axios from 'axios';

export interface PulseMCPServer {
  name: string;
  url: string;
  external_url?: string;
  short_description: string;
  source_code_url?: string;
  github_stars?: number;
  package_registry?: string;
  package_name?: string;
  package_download_count?: number;
  EXPERIMENTAL_ai_generated_description?: string;
}

export interface SearchResult {
  servers: PulseMCPServer[];
  next?: string;
  total_count: number;
}

export class PulseAPIService {
  private baseUrl = 'https://api.pulsemcp.com/v0beta';
  private userAgent = 'Them/0.5';

  /**
   * Search for MCP servers using the Pulse API
   * @param query Search term to filter servers
   * @param countPerPage Number of results per page (max 5000)
   * @param offset Number of results to skip for pagination
   * @returns Promise with search results
   */
  async searchServers(
    query?: string,
    countPerPage: number = 20,
    offset: number = 0
  ): Promise<SearchResult> {
    try {
      const params: Record<string, string | number> = {
        count_per_page: countPerPage,
        offset
      };

      if (query) {
        params.query = query;
      }

      const response = await axios.get(`${this.baseUrl}/servers`, {
        params,
        headers: {
          'User-Agent': this.userAgent
        }
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`[PulseAPIService] API error: ${error.response?.data?.error?.message || error.message}`);
        throw new Error(`Failed to search MCP servers: ${error.response?.data?.error?.message || error.message}`);
      }
      console.error(`[PulseAPIService] Unexpected error: ${error}`);
      throw new Error('Failed to search MCP servers due to an unexpected error');
    }
  }

  /**
   * Get all available servers with pagination
   * @returns Promise with all servers from all pages
   */
  async getAllServers(): Promise<PulseMCPServer[]> {
    let allServers: PulseMCPServer[] = [];
    let nextUrl: string | undefined;
    let offset = 0;
    const countPerPage = 100;
    let totalCount = 0;

    do {
      const result = await this.searchServers(undefined, countPerPage, offset);
      allServers = [...allServers, ...result.servers];
      nextUrl = result.next;
      offset += countPerPage;
      totalCount = result.total_count;
    } while (nextUrl && allServers.length < totalCount);

    return allServers;
  }
} 