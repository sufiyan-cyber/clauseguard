/** Quick retrieval sanity check: npm run test:retrieval */
import "dotenv/config";
import { searchBenchmarks } from "../services/qdrant";

const CASES: Array<{ query: string; clauseType?: string; expect: string }> = [
  {
    query:
      "Provider's total liability shall not exceed amounts paid in the three months preceding the claim; customer payment obligations unlimited",
    clauseType: "limitation_of_liability",
    expect: "aggressive 3-month one-sided cap",
  },
  {
    query:
      "Agreement renews automatically for successive terms unless customer gives 180 days notice; fees may increase without notice",
    clauseType: "auto_renewal",
    expect: "aggressive renewal trap",
  },
  {
    query: "customer indemnifies provider for all claims including provider's own negligence",
    clauseType: "indemnification",
    expect: "one-way indemnity red flag",
  },
];

async function main() {
  for (const c of CASES) {
    const hits = await searchBenchmarks(c.query, { clauseType: c.clauseType, limit: 3 });
    console.log(`\nQUERY (${c.expect}):`);
    for (const h of hits) {
      console.log(
        `  ${h.score.toFixed(3)} [${h.riskBaseline}] ${h.clauseType} — ${h.text.slice(0, 90)}...`,
      );
    }
    if (hits.length === 0) console.log("  !! NO RESULTS");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
