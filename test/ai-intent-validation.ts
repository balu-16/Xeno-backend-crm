/**
 * AI Intent Classification & Response Validation Suite
 *
 * Tests the full request lifecycle:
 * User Query → Intent Detection → Tool Selection → Response Generation
 *
 * Run: npx tsx test/ai-intent-validation.ts
 */

const API_URL = "http://localhost:3000/api";

type TestCase = {
  query: string;
  expectedIntent: string;
  expectedTool: string | null;
  description: string;
};

const TEST_CASES: TestCase[] = [
  // ── Greetings ──────────────────────────────────────────────────
  {
    query: "hello",
    expectedIntent: "greeting",
    expectedTool: null,
    description: "Simple greeting"
  },
  {
    query: "hi",
    expectedIntent: "greeting",
    expectedTool: null,
    description: "Short greeting"
  },
  {
    query: "hey",
    expectedIntent: "greeting",
    expectedTool: null,
    description: "Casual greeting"
  },
  {
    query: "good morning",
    expectedIntent: "greeting",
    expectedTool: null,
    description: "Time-based greeting"
  },
  {
    query: "how are you",
    expectedIntent: "greeting",
    expectedTool: null,
    description: "Status check greeting"
  },

  // ── Thanks ─────────────────────────────────────────────────────
  {
    query: "thanks",
    expectedIntent: "thanks",
    expectedTool: null,
    description: "Simple thanks"
  },
  {
    query: "thank you",
    expectedIntent: "thanks",
    expectedTool: null,
    description: "Formal thanks"
  },

  // ── Farewell ───────────────────────────────────────────────────
  {
    query: "bye",
    expectedIntent: "farewell",
    expectedTool: null,
    description: "Simple goodbye"
  },
  {
    query: "goodbye",
    expectedIntent: "farewell",
    expectedTool: null,
    description: "Formal goodbye"
  },

  // ── Help ───────────────────────────────────────────────────────
  {
    query: "help",
    expectedIntent: "help",
    expectedTool: null,
    description: "Help request"
  },
  {
    query: "what can you do",
    expectedIntent: "help",
    expectedTool: null,
    description: "Capability inquiry"
  },

  // ── Segments ───────────────────────────────────────────────────
  {
    query: "list all segments",
    expectedIntent: "listSegments",
    expectedTool: "listSegments",
    description: "List segments"
  },
  {
    query: "how many segments exist?",
    expectedIntent: "listSegments",
    expectedTool: "listSegments",
    description: "Segment count"
  },
  {
    query: "show all customer segments",
    expectedIntent: "listSegments",
    expectedTool: "listSegments",
    description: "Show segments"
  },
  {
    query: "total segments",
    expectedIntent: "listSegments",
    expectedTool: "listSegments",
    description: "Total segments"
  },
  {
    query: "segment names",
    expectedIntent: "listSegments",
    expectedTool: "listSegments",
    description: "Segment names"
  },
  {
    query: "largest segment",
    expectedIntent: "listSegments",
    expectedTool: "listSegments",
    description: "Largest segment query"
  },

  // ── Campaigns ──────────────────────────────────────────────────
  {
    query: "list all campaigns",
    expectedIntent: "listCampaigns",
    expectedTool: "listCampaigns",
    description: "List campaigns"
  },
  {
    query: "active campaigns",
    expectedIntent: "listCampaigns",
    expectedTool: "listCampaigns",
    description: "Active campaigns"
  },
  {
    query: "failed campaigns",
    expectedIntent: "listCampaigns",
    expectedTool: "listCampaigns",
    description: "Failed campaigns"
  },
  {
    query: "how many campaigns are there?",
    expectedIntent: "listCampaigns",
    expectedTool: "listCampaigns",
    description: "Campaign count"
  },
  {
    query: "campaign status",
    expectedIntent: "listCampaigns",
    expectedTool: "listCampaigns",
    description: "Campaign status"
  },

  // ── Campaign Performance ───────────────────────────────────────
  {
    query: "show campaign performance",
    expectedIntent: "campaignPerformance",
    expectedTool: "getCampaignPerformance",
    description: "Campaign performance"
  },
  {
    query: "campaign funnel metrics",
    expectedIntent: "campaignPerformance",
    expectedTool: "getCampaignPerformance",
    description: "Campaign funnel"
  },

  // ── Campaign Diagnosis ─────────────────────────────────────────
  {
    query: "why did Summer Sale fail?",
    expectedIntent: "campaignDiagnosis",
    expectedTool: "diagnoseCampaignFailure",
    description: "Campaign failure diagnosis"
  },
  {
    query: "what went wrong with the campaign?",
    expectedIntent: "campaignDiagnosis",
    expectedTool: "diagnoseCampaignFailure",
    description: "Campaign issue diagnosis"
  },

  // ── Customers ──────────────────────────────────────────────────
  {
    query: "total customers",
    expectedIntent: "customerStats",
    expectedTool: "getCustomerStats",
    description: "Total customers"
  },
  {
    query: "how many customers do we have?",
    expectedIntent: "customerStats",
    expectedTool: "getCustomerStats",
    description: "Customer count"
  },
  {
    query: "top spenders",
    expectedIntent: "customerStats",
    expectedTool: "getCustomerStats",
    description: "Top spenders"
  },
  {
    query: "customer breakdown by city",
    expectedIntent: "customerStats",
    expectedTool: "getCustomerStats",
    description: "Customer city breakdown"
  },
  {
    query: "recent customers",
    expectedIntent: "customerStats",
    expectedTool: "getCustomerStats",
    description: "Recent customers"
  },

  // ── Dashboard ──────────────────────────────────────────────────
  {
    query: "show dashboard",
    expectedIntent: "dashboard",
    expectedTool: "getDashboardMetrics",
    description: "Dashboard request"
  },
  {
    query: "business overview",
    expectedIntent: "dashboard",
    expectedTool: "getDashboardMetrics",
    description: "Business overview"
  },
  {
    query: "how is our business doing?",
    expectedIntent: "dashboard",
    expectedTool: "getDashboardMetrics",
    description: "Business status"
  },

  // ── Generate Segment ───────────────────────────────────────────
  {
    query: "find VIP customers who spent over 500",
    expectedIntent: "generateSegment",
    expectedTool: "generateSegmentRules",
    description: "Generate VIP segment"
  },
  {
    query: "create a segment for inactive customers",
    expectedIntent: "generateSegment",
    expectedTool: "generateSegmentRules",
    description: "Create inactive segment"
  },
  {
    query: "customers who haven't ordered in 30 days",
    expectedIntent: "generateSegment",
    expectedTool: "generateSegmentRules",
    description: "Find inactive customers"
  },

  // ── Mixed / Edge Cases ─────────────────────────────────────────
  {
    query: "help me create a campaign",
    expectedIntent: "help",
    expectedTool: null,
    description: "Campaign creation help"
  },
  {
    query: "summarize my CRM",
    expectedIntent: "dashboard",
    expectedTool: "getDashboardMetrics",
    description: "CRM summary"
  },
  {
    query: "revenue this month",
    expectedIntent: "customerStats",
    expectedTool: "getCustomerStats",
    description: "Revenue query"
  }
];

type TestResult = {
  query: string;
  description: string;
  expectedIntent: string;
  actualIntent: string;
  expectedTool: string | null;
  actualTool: string | null;
  responsePreview: string;
  pass: boolean;
  error?: string;
};

async function login(): Promise<string> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "admin@xeno.local",
      password: "XenoDemo123!"
    })
  });
  const cookies = response.headers.get("set-cookie") ?? "";
  const token = cookies.match(/xeno_access_token=([^;]+)/)?.[1];
  if (!token) throw new Error("Login failed");
  return token;
}

async function createConversation(token: string): Promise<string> {
  const response = await fetch(`${API_URL}/ai/conversations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `xeno_access_token=${token}`
    },
    body: JSON.stringify({ title: "Validation Test" })
  });
  const data = (await response.json()) as { data: { id: string } };
  return data.data.id;
}

async function sendMessage(
  token: string,
  conversationId: string,
  content: string
): Promise<{
  response: string;
  toolResult: unknown;
  grounding: { tool: string | null; sources: string[] };
}> {
  const response = await fetch(
    `${API_URL}/ai/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `xeno_access_token=${token}`
      },
      body: JSON.stringify({ content })
    }
  );
  const data = (await response.json()) as {
    data: {
      response: string;
      toolResult: unknown;
      grounding: { tool: string | null; sources: string[] };
    };
  };
  return data.data;
}

function inferIntentFromTool(tool: string | null): string {
  if (!tool) return "unknown";
  const mapping: Record<string, string> = {
    listSegments: "listSegments",
    generateSegmentRules: "generateSegment",
    listCampaigns: "listCampaigns",
    getCampaignPerformance: "campaignPerformance",
    diagnoseCampaignFailure: "campaignDiagnosis",
    getCustomerStats: "customerStats",
    getDashboardMetrics: "dashboard",
    generateCampaignMessage: "generateMessage",
    recommendAudience: "recommendAudience"
  };
  return mapping[tool] ?? "unknown";
}

async function runTest(
  token: string,
  conversationId: string,
  tc: TestCase
): Promise<TestResult> {
  try {
    const result = await sendMessage(token, conversationId, tc.query);
    const actualTool = result.grounding.tool;
    const actualIntent = inferIntentFromTool(actualTool);

    // For conversational intents, the tool should be null
    const isConversational = ["greeting", "thanks", "farewell", "help"].includes(
      tc.expectedIntent
    );

    let pass: boolean;
    if (isConversational) {
      // Conversational: tool should be null, response should not contain dashboard data
      pass =
        actualTool === null &&
        !result.response.includes("Dashboard Overview") &&
        !result.response.includes("📊");
    } else {
      // Data-backed: tool should match
      pass = actualTool === tc.expectedTool;
    }

    return {
      query: tc.query,
      description: tc.description,
      expectedIntent: tc.expectedIntent,
      actualIntent,
      expectedTool: tc.expectedTool,
      actualTool,
      responsePreview: result.response.slice(0, 200),
      pass
    };
  } catch (error) {
    return {
      query: tc.query,
      description: tc.description,
      expectedIntent: tc.expectedIntent,
      actualIntent: "ERROR",
      expectedTool: tc.expectedTool,
      actualTool: null,
      responsePreview: "",
      pass: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   AI Intent Classification & Response Validation Suite  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log("Logging in...");
  const token = await login();
  console.log("Creating test conversation...");
  const conversationId = await createConversation(token);

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i]!;
    process.stdout.write(
      `[${String(i + 1).padStart(2)}/${TEST_CASES.length}] ${tc.description.padEnd(40)} `
    );
    const result = await runTest(token, conversationId, tc);
    results.push(result);

    if (result.pass) {
      console.log(`✅ PASS`);
      passed++;
    } else {
      console.log(`❌ FAIL`);
      console.log(`           Expected: intent=${tc.expectedIntent}, tool=${tc.expectedTool}`);
      console.log(`           Actual:   intent=${result.actualIntent}, tool=${result.actualTool}`);
      if (result.error) {
        console.log(`           Error: ${result.error}`);
      }
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log("\n" + "═".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed, ${TEST_CASES.length} total`);
  console.log(`Pass rate: ${((passed / TEST_CASES.length) * 100).toFixed(1)}%`);
  console.log("═".repeat(60));

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ❌ "${r.query}"`);
      console.log(`     Expected: ${r.expectedIntent} (${r.expectedTool})`);
      console.log(`     Got:      ${r.actualIntent} (${r.actualTool})`);
    }
  }

  // Print summary table
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│                    Test Results Summary                  │");
  console.log("├─────────────────────────────────────────────────────────┤");
  const categories = [
    "greeting",
    "thanks",
    "farewell",
    "help",
    "listSegments",
    "listCampaigns",
    "campaignPerformance",
    "campaignDiagnosis",
    "customerStats",
    "dashboard",
    "generateSegment",
    "generateMessage"
  ];
  for (const cat of categories) {
    const catResults = results.filter((r) => r.expectedIntent === cat);
    if (catResults.length === 0) continue;
    const catPassed = catResults.filter((r) => r.pass).length;
    const status = catPassed === catResults.length ? "✅" : "❌";
    console.log(
      `│ ${status} ${cat.padEnd(25)} ${String(catPassed).padStart(2)}/${String(catResults.length).padStart(2)} passed │`
    );
  }
  console.log("└─────────────────────────────────────────────────────────┘");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Test suite failed:", error);
  process.exit(1);
});
