/**
 * Minimal GraphQL client for the Graft API (Phase 7.2).
 */

export type GraftSuggestion = {
  recipeId: string;
  rank: number;
  score: number;
  matchPath: string;
  title: string;
  rationale: string;
  support: number;
  confidence: string;
  patch: string;
  evidence: Array<{ prNumber: number; commentUrl: string; episodeId: string }>;
};

export type GraftFreshness = {
  stale: boolean;
  reason: string | null;
  recipes: number;
  episodes: number;
};

export type ApplyPreviewResult = {
  recipeId: string;
  title: string;
  rationale: string;
  matchPath: string;
  unifiedDiff: string;
  warnings: string[];
};

export class GraftApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private async query<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.token !== undefined && this.token.trim() !== "") {
      headers.authorization = `Bearer ${this.token.trim()}`;
    }

    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/graphql`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });

    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };

    if (!res.ok || json.errors !== undefined) {
      const code = json.errors?.[0]?.extensions?.code;
      const message = json.errors?.[0]?.message ?? `HTTP ${res.status}`;
      const err = new Error(message) as Error & { code?: string };
      if (code !== undefined) {
        err.code = code;
      }
      throw err;
    }

    return json.data as T;
  }

  async health(): Promise<{ status: string; repo?: string }> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/health`);
    if (!res.ok) {
      throw new Error(`Graft API unreachable (${res.status})`);
    }
    return (await res.json()) as { status: string; repo?: string };
  }

  async freshness(): Promise<GraftFreshness> {
    const data = await this.query<{ freshness: GraftFreshness }>(
      `query { freshness { stale reason recipes episodes } }`,
    );
    return data.freshness;
  }

  async suggestGrafts(args: {
    diff?: string;
    code?: string;
    path?: string;
    limit?: number;
  }): Promise<GraftSuggestion[]> {
    const data = await this.query<{ suggestGrafts: GraftSuggestion[] }>(
      `query($diff: String, $code: String, $path: String, $limit: Int) {
        suggestGrafts(diff: $diff, code: $code, path: $path, limit: $limit) {
          recipeId rank score matchPath title rationale support confidence patch
          evidence { prNumber commentUrl episodeId }
        }
      }`,
      args,
    );
    return data.suggestGrafts;
  }

  async applyPreview(args: {
    recipeId: string;
    path: string;
    startLine?: number;
    endLine?: number;
  }): Promise<ApplyPreviewResult> {
    const data = await this.query<{ applyPreview: ApplyPreviewResult }>(
      `query($recipeId: ID!, $path: String!, $startLine: Int, $endLine: Int) {
        applyPreview(recipeId: $recipeId, path: $path, startLine: $startLine, endLine: $endLine) {
          recipeId title rationale matchPath unifiedDiff warnings
        }
      }`,
      args,
    );
    return data.applyPreview;
  }
}
