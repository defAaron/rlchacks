/**
 * GraphQL schema (Phase 6.3 / DEV-5).
 */

export const typeDefs = /* GraphQL */ `
  enum Confidence {
    high
    medium
    low
  }

  type Evidence {
    episodeId: ID!
    prNumber: Int!
    commentUrl: String!
    linkConfidence: String!
    linkReason: String!
    path: String!
    commentBody: String!
  }

  type Recipe {
    id: ID!
    title: String!
    rationale: String!
    before: String!
    after: String!
    support: Int!
    confidence: Confidence!
    pathPrefixes: [String!]!
    suppressed: Boolean!
    evidenceCount: Int!
    evidence: [Evidence!]!
  }

  type SuggestionEvidence {
    prNumber: Int!
    commentUrl: String!
    episodeId: ID!
  }

  type Suggestion {
    recipeId: ID!
    rank: Int!
    score: Float!
    matchPath: String!
    title: String!
    rationale: String!
    support: Int!
    confidence: Confidence!
    patch: String!
    evidence: [SuggestionEvidence!]!
  }

  type Freshness {
    repo: String!
    ingestAt: String
    linkAt: String
    compileAt: String
    episodes: Int!
    recipes: Int!
    stale: Boolean!
    reason: String
  }

  type ApplyPreview {
    recipeId: ID!
    title: String!
    rationale: String!
    matchPath: String!
    unifiedDiff: String!
    warnings: [String!]!
  }

  type Query {
    health: String!
    recipes(path: String, language: String, q: String, limit: Int): [Recipe!]!
    recipe(id: ID!): Recipe
    suggestGrafts(
      diff: String
      code: String
      path: String
      limit: Int
    ): [Suggestion!]!
    freshness: Freshness!
    applyPreview(
      recipeId: ID!
      path: String!
      startLine: Int
      endLine: Int
    ): ApplyPreview!
  }

  type Mutation {
    suppressRecipe(id: ID!, suppressed: Boolean!): Recipe!
  }
`;
