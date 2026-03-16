import { LiveScenario, LiveToolManager } from "./live-eval-harness.js";
import { ToolDefinition, ToolResponse } from "../../../tools/mcp/types/tools.js";

/**
 * Live eval scenarios.
 *
 * Real LLM, real engine, real decisions.
 * Tools return realistic canned data — the LLM doesn't know this.
 * It has to decide WHAT to call, HOW to interpret results, and WHEN to stop.
 * Grading is programmatic: did the answer contain the correct facts?
 */

// ===== Tool definitions =====

const TOOL_SEARCH: ToolDefinition = {
  name: "web_search",
  description: "Search the web and return relevant results with titles, snippets, and URLs.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
};

const TOOL_KNOWLEDGE_BASE: ToolDefinition = {
  name: "knowledge_base_lookup",
  description: "Look up information in a structured knowledge base. Returns factual entries about companies, people, technologies, and concepts.",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "The topic to look up" },
      category: { type: "string", description: "Optional category filter: 'company', 'person', 'technology'" },
    },
    required: ["topic"],
  },
};

const TOOL_DATA_ANALYSIS: ToolDefinition = {
  name: "analyze_data",
  description: "Analyze structured data — compute statistics, comparisons, rankings from a dataset. Supports operations: 'compare', 'rank', 'summarize'.",
  inputSchema: {
    type: "object",
    properties: {
      dataset: { type: "string", description: "Name of the dataset to analyze" },
      operation: { type: "string", description: "Operation: 'compare', 'rank', or 'summarize'" },
      parameters: { type: "string", description: "Additional parameters for the operation" },
    },
    required: ["dataset", "operation"],
  },
};

// ===== Canned tool responses =====

function searchHandler(args: { query: string }): ToolResponse {
  const q = (args.query || "").toLowerCase();

  if (q.includes("solana") && q.includes("found")) {
    return {
      success: true,
      data: [
        {
          title: "Solana: History and Founders",
          snippet: "Solana was founded by Anatoly Yakovenko in 2017. Yakovenko, a former Qualcomm engineer, published the Solana whitepaper describing Proof of History. Co-founder Raj Gokal serves as COO.",
          url: "https://solana.com/about",
        },
        {
          title: "Anatoly Yakovenko - Solana Labs",
          snippet: "Anatoly Yakovenko is the CEO and co-founder of Solana Labs. Before Solana, he worked at Qualcomm on operating systems and at Dropbox.",
          url: "https://linkedin.com/in/yakovenko",
        },
      ],
    };
  }

  if (q.includes("typescript") && (q.includes("vs") || q.includes("rust"))) {
    return {
      success: true,
      data: [
        {
          title: "TypeScript vs Rust: Performance Comparison 2026",
          snippet: "Rust outperforms TypeScript by 10-50x in CPU-bound tasks. TypeScript excels in rapid prototyping and web development. Rust has zero-cost abstractions and no garbage collector.",
          url: "https://benchmark.dev/ts-vs-rust",
        },
        {
          title: "When to use Rust vs TypeScript",
          snippet: "Use TypeScript for web apps, APIs, and tooling. Use Rust for systems programming, performance-critical services, and WebAssembly. Both have strong type systems.",
          url: "https://dev.to/comparison-guide",
        },
      ],
    };
  }

  if (q.includes("react") && q.includes("angular")) {
    return {
      success: true,
      data: [
        {
          title: "React vs Angular in 2026",
          snippet: "React remains the most popular with 62% market share. Angular holds 22%. React uses a virtual DOM and one-way data binding. Angular is a full framework with two-way data binding, dependency injection, and built-in routing.",
          url: "https://stateofjs.com/2026",
        },
      ],
    };
  }

  // Generic fallback
  return {
    success: true,
    data: [
      {
        title: `Search results for: ${args.query}`,
        snippet: `Multiple results found for "${args.query}". The topic is well-documented with various perspectives and sources available.`,
        url: "https://example.com/results",
      },
    ],
  };
}

function knowledgeBaseHandler(args: { topic: string; category?: string }): ToolResponse {
  const t = (args.topic || "").toLowerCase();

  if (t.includes("solana")) {
    return {
      success: true,
      data: {
        name: "Solana",
        type: "blockchain",
        founded: 2017,
        founder: "Anatoly Yakovenko",
        cofounder: "Raj Gokal",
        consensus: "Proof of History + Proof of Stake",
        tps: "65,000 theoretical, ~3,000 sustained",
        token: "SOL",
        language: "Rust",
        headquarters: "San Francisco, CA",
      },
    };
  }

  if (t.includes("ethereum")) {
    return {
      success: true,
      data: {
        name: "Ethereum",
        type: "blockchain",
        founded: 2015,
        founder: "Vitalik Buterin",
        consensus: "Proof of Stake (post-Merge)",
        tps: "~30 on L1, thousands on L2s",
        token: "ETH",
        language: "Solidity",
      },
    };
  }

  return {
    success: true,
    data: {
      name: args.topic,
      info: `Information about ${args.topic} is available in the knowledge base.`,
    },
  };
}

function dataAnalysisHandler(args: { dataset: string; operation: string; parameters?: string }): ToolResponse {
  const ds = (args.dataset || "").toLowerCase();

  if (ds.includes("blockchain") && args.operation === "compare") {
    return {
      success: true,
      data: {
        comparison: [
          { name: "Solana", tps: 3000, avgFee: "$0.00025", consensus: "PoH+PoS", language: "Rust" },
          { name: "Ethereum", tps: 30, avgFee: "$2.50", consensus: "PoS", language: "Solidity" },
          { name: "Bitcoin", tps: 7, avgFee: "$1.50", consensus: "PoW", language: "C++" },
        ],
        summary: "Solana leads in throughput (3000 TPS) and lowest fees ($0.00025). Ethereum has the largest ecosystem. Bitcoin is the most decentralized.",
      },
    };
  }

  if (ds.includes("blockchain") && args.operation === "rank") {
    return {
      success: true,
      data: {
        ranking: [
          { rank: 1, name: "Solana", score: 92, reason: "Highest TPS, lowest fees" },
          { rank: 2, name: "Ethereum", score: 88, reason: "Largest ecosystem, most DeFi TVL" },
          { rank: 3, name: "Bitcoin", score: 85, reason: "Most decentralized, store of value" },
        ],
        metric: args.parameters || "overall performance",
      },
    };
  }

  return {
    success: true,
    data: { result: `Analysis of ${args.dataset} with operation ${args.operation} completed.` },
  };
}

// ===== Scenarios =====

export const searchAndSynthesize: LiveScenario = {
  name: "Search and synthesize: who founded Solana?",
  description: "Agent must search, extract the founder name, and present it. Tests basic tool use + answer grounding.",
  userMessage: "Who founded Solana and when?",
  maxIterations: 5,
  setupTools: (tm) => {
    tm.register(TOOL_SEARCH, searchHandler as any);
    tm.register(TOOL_KNOWLEDGE_BASE, knowledgeBaseHandler as any);
  },
  grade: (answer, meta) => {
    const lower = answer.toLowerCase();
    const hasFounder = lower.includes("anatoly") || lower.includes("yakovenko");
    const hasYear = answer.includes("2017");
    const usedTool = meta.toolCallCount > 0;

    if (!usedTool) return { pass: false, reason: "Agent used no tools" };
    if (!hasFounder) return { pass: false, reason: `Missing founder name. Got: "${answer.substring(0, 200)}"` };
    if (!hasYear) return { pass: false, reason: `Missing founding year 2017. Got: "${answer.substring(0, 200)}"` };

    return { pass: true, reason: "Correct: Anatoly Yakovenko, 2017" };
  },
};

export const multiToolResearch: LiveScenario = {
  name: "Multi-tool research: compare Solana vs Ethereum",
  description: "Agent should use multiple tools to build a comparison. Tests multi-step reasoning and synthesis.",
  userMessage: "Compare Solana and Ethereum — which is faster and which has lower fees?",
  maxIterations: 6,
  setupTools: (tm) => {
    tm.register(TOOL_SEARCH, searchHandler as any);
    tm.register(TOOL_KNOWLEDGE_BASE, knowledgeBaseHandler as any);
    tm.register(TOOL_DATA_ANALYSIS, dataAnalysisHandler as any);
  },
  grade: (answer, meta) => {
    const lower = answer.toLowerCase();

    const mentionsSolanaFaster = lower.includes("solana") && (lower.includes("faster") || lower.includes("tps") || lower.includes("throughput"));
    const mentionsFees = lower.includes("fee") || lower.includes("cost") || lower.includes("cheaper");
    const usedMultipleTools = meta.toolCallCount >= 1;

    if (!usedMultipleTools) return { pass: false, reason: "Agent should have used at least one tool" };
    if (!mentionsSolanaFaster) return { pass: false, reason: `Answer should mention Solana is faster. Got: "${answer.substring(0, 250)}"` };
    if (!mentionsFees) return { pass: false, reason: `Answer should discuss fees. Got: "${answer.substring(0, 250)}"` };

    return { pass: true, reason: "Correct: Solana faster, lower fees, used tools" };
  },
};

export const directAnswerNoTools: LiveScenario = {
  name: "Direct answer: no tools needed for common knowledge",
  description: "Agent should answer a simple factual question without calling tools. Tests that it doesn't over-use tools.",
  userMessage: "What programming language is TypeScript based on?",
  maxIterations: 4,
  setupTools: (tm) => {
    tm.register(TOOL_SEARCH, searchHandler as any);
    tm.register(TOOL_KNOWLEDGE_BASE, knowledgeBaseHandler as any);
  },
  grade: (answer, _meta) => {
    const lower = answer.toLowerCase();
    const hasJS = lower.includes("javascript");

    if (!hasJS) return { pass: false, reason: `Expected "JavaScript". Got: "${answer.substring(0, 200)}"` };

    // We don't penalize tool use here — some models are cautious. But the answer must be right.
    return { pass: true, reason: `Correct: JavaScript. Tool calls: ${_meta.toolCallCount}` };
  },
};

export const synthesizeFromMultipleSources: LiveScenario = {
  name: "Multi-source synthesis: TypeScript vs Rust trade-offs",
  description: "Agent must search and present a balanced comparison with specific facts from the results.",
  userMessage: "Should I use TypeScript or Rust for a new backend service? Give me specific trade-offs.",
  maxIterations: 5,
  setupTools: (tm) => {
    tm.register(TOOL_SEARCH, searchHandler as any);
  },
  grade: (answer, meta) => {
    const lower = answer.toLowerCase();

    const mentionsBoth = lower.includes("typescript") && lower.includes("rust");
    const hasTradeoffs = (lower.includes("performance") || lower.includes("speed") || lower.includes("fast")) &&
      (lower.includes("prototyp") || lower.includes("web") || lower.includes("develop"));
    const usedSearch = meta.toolCalls.some(c => c.tool === "web_search");

    if (!usedSearch) return { pass: false, reason: "Agent should have searched for comparison data" };
    if (!mentionsBoth) return { pass: false, reason: `Should mention both languages. Got: "${answer.substring(0, 250)}"` };
    if (!hasTradeoffs) return { pass: false, reason: `Should discuss trade-offs. Got: "${answer.substring(0, 250)}"` };

    return { pass: true, reason: "Correct: balanced comparison with search data" };
  },
};

export const complexResearchTask: LiveScenario = {
  name: "Complex research: blockchain comparison with data analysis",
  description: "Agent must use knowledge base AND data analysis to produce a ranked comparison. Tests multi-tool orchestration.",
  userMessage: "Rank the top 3 blockchains by performance and explain why each ranks where it does.",
  maxIterations: 6,
  setupTools: (tm) => {
    tm.register(TOOL_KNOWLEDGE_BASE, knowledgeBaseHandler as any);
    tm.register(TOOL_DATA_ANALYSIS, dataAnalysisHandler as any);
    tm.register(TOOL_SEARCH, searchHandler as any);
  },
  grade: (answer, meta) => {
    const lower = answer.toLowerCase();

    const mentionsSolana = lower.includes("solana");
    const mentionsEthereum = lower.includes("ethereum");
    const mentionsBitcoin = lower.includes("bitcoin");
    const hasRanking = lower.includes("1") || lower.includes("first") || lower.includes("rank") || lower.includes("top");
    const usedTools = meta.toolCallCount >= 1;

    if (!usedTools) return { pass: false, reason: "Agent used no tools for a research task" };
    if (!mentionsSolana) return { pass: false, reason: `Missing Solana. Got: "${answer.substring(0, 250)}"` };
    if (!mentionsEthereum) return { pass: false, reason: `Missing Ethereum. Got: "${answer.substring(0, 250)}"` };
    if (!mentionsBitcoin) return { pass: false, reason: `Missing Bitcoin. Got: "${answer.substring(0, 250)}"` };
    if (!hasRanking) return { pass: false, reason: `Should include ranking. Got: "${answer.substring(0, 250)}"` };

    return { pass: true, reason: `Correct: all 3 blockchains ranked. Tools used: ${meta.toolCallCount}` };
  },
};

export const ALL_LIVE_SCENARIOS: LiveScenario[] = [
  searchAndSynthesize,
  multiToolResearch,
  directAnswerNoTools,
  synthesizeFromMultipleSources,
  complexResearchTask,
];
