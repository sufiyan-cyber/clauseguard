/**
 * Market-standard benchmark clauses for the clause_library collection.
 * riskBaseline = the risk posture this formulation represents:
 *   "market"     — balanced, commonly accepted language
 *   "protective" — favorable to the receiving/non-drafting party
 *   "aggressive" — known one-sided pattern, kept so retrieval can match and
 *                  the risk agent can cite it as a recognized red flag
 */
export interface BenchmarkClause {
  text: string;
  clauseType: string;
  jurisdiction: string;
  riskBaseline: "market" | "protective" | "aggressive";
  source: string;
  guidance?: string;
}

export const CLAUSE_LIBRARY: BenchmarkClause[] = [
  // --- Limitation of liability ------------------------------------------------
  {
    text: "EXCEPT FOR BREACHES OF CONFIDENTIALITY, INDEMNIFICATION OBLIGATIONS, OR GROSS NEGLIGENCE OR WILLFUL MISCONDUCT, NEITHER PARTY'S AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT SHALL EXCEED THE TOTAL FEES PAID OR PAYABLE BY CUSTOMER IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM. NEITHER PARTY SHALL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.",
    clauseType: "limitation_of_liability",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard SaaS MSA template",
    guidance: "Mutual cap at 12 months' fees with standard carve-outs is the accepted market position.",
  },
  {
    text: "Provider's total liability under this Agreement, regardless of the form of action, shall not exceed the amounts paid by Customer in the three (3) months preceding the claim. Customer waives all claims for any indirect or consequential damages. Customer's obligations to pay fees shall not be subject to any limitation.",
    clauseType: "limitation_of_liability",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "A 3-month cap that applies only to the provider, with unlimited customer exposure, is a recognized red flag.",
  },
  {
    text: "Each party's liability shall be limited to direct damages not exceeding two (2) times the annual contract value, except that no limitation shall apply to a party's indemnification obligations, breach of confidentiality, misappropriation of intellectual property, or violations of applicable law.",
    clauseType: "limitation_of_liability",
    jurisdiction: "US-general",
    riskBaseline: "protective",
    source: "Enterprise procurement rider",
    guidance: "2x ACV cap with broad carve-outs favors the customer; commonly achieved by enterprise buyers.",
  },
  // --- Indemnification ---------------------------------------------------------
  {
    text: "Each party (the \"Indemnifying Party\") shall defend, indemnify, and hold harmless the other party from and against third-party claims, damages, and reasonable attorneys' fees arising from (a) the Indemnifying Party's gross negligence or willful misconduct, or (b) its material breach of this Agreement, provided the indemnified party gives prompt written notice and reasonable cooperation, and the Indemnifying Party controls the defense and settlement.",
    clauseType: "indemnification",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard mutual indemnity",
    guidance: "Mutual indemnities limited to third-party claims with notice/control mechanics are market standard.",
  },
  {
    text: "Provider shall defend and indemnify Customer against any third-party claim alleging that the Services, as provided, infringe any patent, copyright, or trademark, or misappropriate any trade secret, and shall pay all damages finally awarded, provided Provider may (a) procure the right for Customer to continue using the Services, (b) modify the Services to be non-infringing, or (c) terminate and refund prepaid fees.",
    clauseType: "indemnification",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard IP indemnity",
    guidance: "IP infringement indemnity from the vendor with mitigation options is expected in SaaS deals.",
  },
  {
    text: "Customer shall indemnify, defend, and hold harmless Provider and its affiliates, officers, and employees from any and all claims, losses, liabilities, and expenses of any kind arising out of or relating in any way to Customer's use of the Services, regardless of cause or fault, including Provider's own negligence.",
    clauseType: "indemnification",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "A one-way customer indemnity covering the provider's own negligence is a serious red flag.",
  },
  // --- Termination ---------------------------------------------------------------
  {
    text: "Either party may terminate this Agreement (a) for material breach upon thirty (30) days' written notice if the breach remains uncured at the end of the notice period, or (b) immediately upon the other party's insolvency or bankruptcy filing. Upon termination, Customer shall receive a pro-rata refund of prepaid, unused fees.",
    clauseType: "termination",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard SaaS MSA template",
    guidance: "Mutual termination for cause with a 30-day cure period and pro-rata refund is market standard.",
  },
  {
    text: "Provider may terminate this Agreement or suspend the Services at any time, for any reason or no reason, upon notice to Customer. Customer may terminate only for Provider's uncured material breach and shall not be entitled to any refund of prepaid fees under any circumstances.",
    clauseType: "termination",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "Unilateral termination-for-convenience for one side only, with no refund, is strongly disfavored.",
  },
  {
    text: "Either party may terminate this Agreement for convenience upon ninety (90) days' prior written notice. Termination for convenience by Customer entitles Customer to a pro-rata refund of prepaid fees for the unused portion of the term.",
    clauseType: "termination",
    jurisdiction: "US-general",
    riskBaseline: "protective",
    source: "Enterprise procurement rider",
  },
  // --- Auto-renewal ---------------------------------------------------------------
  {
    text: "This Agreement shall renew for successive one (1) year terms unless either party provides written notice of non-renewal at least sixty (60) days before the end of the then-current term. Provider shall notify Customer of the upcoming renewal at least ninety (90) days in advance, and any fee increase shall not exceed five percent (5%) unless mutually agreed.",
    clauseType: "auto_renewal",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard SaaS MSA template",
    guidance: "Auto-renewal with 60-day opt-out, advance renewal notice, and a capped uplift is acceptable.",
  },
  {
    text: "This Agreement automatically renews for successive terms equal to the Initial Term unless Customer delivers written notice of non-renewal no later than one hundred eighty (180) days prior to expiration. Provider may increase fees for any renewal term in its sole discretion without notice.",
    clauseType: "auto_renewal",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "A 180-day opt-out window with uncapped, unnoticed price increases is a classic renewal trap.",
  },
  // --- Confidentiality ------------------------------------------------------------
  {
    text: "Each party shall protect the other's Confidential Information with at least the same degree of care it uses for its own confidential information (and no less than reasonable care), use it solely to perform under this Agreement, and disclose it only to personnel and advisors bound by confidentiality obligations at least as protective. These obligations survive for five (5) years after termination; trade secrets are protected for as long as they remain trade secrets.",
    clauseType: "confidentiality",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard mutual NDA",
    guidance: "Mutual obligations, reasonable-care standard, 3-5 year survival: market standard.",
  },
  {
    text: "Receiving Party's confidentiality obligations shall survive in perpetuity for all Confidential Information, whether or not marked, including information Receiving Party independently develops. Disclosing Party may seek injunctive relief and liquidated damages of $500,000 per disclosure without proof of harm.",
    clauseType: "confidentiality",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided NDA",
    guidance: "Perpetual obligations over unmarked and independently developed information plus punitive liquidated damages is far off-market.",
  },
  // --- Intellectual property -------------------------------------------------------
  {
    text: "Each party retains all right, title, and interest in its pre-existing intellectual property. Customer owns all deliverables created specifically for Customer upon full payment, excluding Provider's pre-existing materials and generic tools, for which Provider grants Customer a perpetual, non-exclusive, royalty-free license to use as embedded in the deliverables.",
    clauseType: "intellectual_property",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard services agreement",
    guidance: "Customer owns bespoke deliverables on payment; vendor keeps background IP with an embedded license.",
  },
  {
    text: "All work product, inventions, improvements, and feedback conceived by either party in connection with this Agreement, including Customer's suggestions and Customer Data derivatives, shall be the sole and exclusive property of Provider, and Customer hereby assigns all such rights to Provider without additional consideration.",
    clauseType: "intellectual_property",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "Provider capturing customer work product and data derivatives is a severe IP overreach.",
  },
  // --- Payment terms -----------------------------------------------------------------
  {
    text: "Customer shall pay undisputed invoices within thirty (30) days of receipt. Late payments accrue interest at 1.5% per month or the maximum lawful rate, whichever is less. Customer may withhold amounts disputed in good faith, provided it pays undisputed portions and the parties resolve the dispute promptly.",
    clauseType: "payment_terms",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard SaaS MSA template",
    guidance: "Net-30 on undisputed amounts with a good-faith dispute carve-out is standard.",
  },
  {
    text: "All fees are due within ten (10) days of invoice, are non-refundable and non-cancellable in all circumstances, and may not be withheld or offset for any reason, including Provider's breach. Provider may suspend Services immediately and without notice for any late payment and charge a reinstatement fee equal to 25% of annual fees.",
    clauseType: "payment_terms",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "Net-10, absolute non-refundability, no dispute rights, and punitive reinstatement fees are red flags.",
  },
  // --- Governing law / dispute resolution ---------------------------------------------
  {
    text: "This Agreement shall be governed by the laws of the State of Delaware, without regard to its conflict-of-laws principles. Each party consents to the exclusive jurisdiction of the state and federal courts located in Wilmington, Delaware, and waives any objection to venue therein.",
    clauseType: "governing_law",
    jurisdiction: "US-DE",
    riskBaseline: "market",
    source: "Standard commercial agreement",
  },
  {
    text: "Any dispute arising out of or relating to this Agreement shall be finally resolved by binding arbitration administered by JAMS in accordance with its Comprehensive Arbitration Rules, seated in the county of the responding party's principal place of business, before a single arbitrator. Either party may seek injunctive relief in court for IP or confidentiality breaches. Each party bears its own costs; the arbitrator may award fees to the prevailing party.",
    clauseType: "dispute_resolution",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard arbitration clause",
  },
  {
    text: "All disputes shall be resolved exclusively in the courts of Provider's principal place of business, and Customer irrevocably waives any right to a jury trial and any right to participate in a class action. Customer shall reimburse Provider's attorneys' fees and costs for any action Provider brings to enforce this Agreement, regardless of outcome.",
    clauseType: "dispute_resolution",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "Forum tied to provider plus one-way fee shifting regardless of outcome is heavily one-sided.",
  },
  // --- Non-compete / non-solicit -------------------------------------------------------
  {
    text: "During the term and for twelve (12) months thereafter, neither party shall knowingly solicit for employment any employee of the other party with whom it had material contact under this Agreement. General solicitations not targeted at such employees (e.g., public job postings) are not a breach.",
    clauseType: "non_solicitation",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard commercial agreement",
    guidance: "Mutual, 12-month, materially-limited non-solicit with a job-postings carve-out is standard.",
  },
  {
    text: "For a period of five (5) years following termination, Customer shall not, directly or indirectly, engage in, invest in, or provide services to any business competitive with Provider anywhere in the world, and shall not hire any current or former Provider personnel.",
    clauseType: "non_compete",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "A 5-year worldwide non-compete imposed on a customer is extraordinary and likely unenforceable in many jurisdictions.",
  },
  // --- Warranty ---------------------------------------------------------------------------
  {
    text: "Provider warrants that (a) the Services will perform materially in accordance with the Documentation, and (b) it will perform the Services in a professional and workmanlike manner consistent with industry standards. Customer's exclusive remedy for breach of this warranty is re-performance or, if re-performance fails, termination and a pro-rata refund.",
    clauseType: "warranty",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard SaaS MSA template",
  },
  {
    text: "THE SERVICES ARE PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTY OF ANY KIND. PROVIDER DISCLAIMS ALL WARRANTIES, EXPRESS, IMPLIED, OR STATUTORY, AND DOES NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, ERROR-FREE, OR FIT FOR ANY PARTICULAR PURPOSE, EVEN IF PROVIDER HAS BEEN ADVISED OF SUCH PURPOSE.",
    clauseType: "warranty",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "A total warranty disclaimer with no performance warranty in a paid B2B service is below market.",
  },
  // --- Data protection ---------------------------------------------------------------------
  {
    text: "Provider shall process Customer Personal Data solely as a processor on Customer's documented instructions, implement appropriate technical and organizational measures including encryption in transit and at rest, notify Customer without undue delay (and within 72 hours) of any Personal Data breach, and, at Customer's election, return or delete all Personal Data upon termination. The parties shall execute the attached Data Processing Addendum incorporating the EU Standard Contractual Clauses where applicable.",
    clauseType: "data_protection",
    jurisdiction: "EU/GDPR",
    riskBaseline: "market",
    source: "Standard DPA",
    guidance: "Processor-only role, security measures, 72-hour breach notice, and deletion on exit are GDPR-market standard.",
  },
  {
    text: "Customer grants Provider a perpetual, irrevocable, worldwide, royalty-free license to use, reproduce, and create derivative works from all Customer Data, including personal information, for any business purpose, including improving services, marketing, and resale of aggregated or de-identified data, without notice or compensation.",
    clauseType: "data_protection",
    jurisdiction: "US-general",
    riskBaseline: "aggressive",
    source: "One-sided vendor paper",
    guidance: "A perpetual any-purpose license over customer personal data is a severe privacy and compliance risk.",
  },
  // --- Force majeure --------------------------------------------------------------------------
  {
    text: "Neither party shall be liable for failure or delay in performance (except payment obligations) caused by events beyond its reasonable control, including natural disasters, war, terrorism, labor disputes, governmental action, or internet or utility failures, provided the affected party gives prompt notice and uses commercially reasonable efforts to resume performance. Either party may terminate if a force majeure event continues for more than sixty (60) days.",
    clauseType: "force_majeure",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard commercial agreement",
  },
  // --- Assignment ------------------------------------------------------------------------------
  {
    text: "Neither party may assign this Agreement without the other party's prior written consent, not to be unreasonably withheld, except that either party may assign this Agreement in its entirety, upon notice, to an affiliate or to a successor in connection with a merger, acquisition, or sale of substantially all its assets, provided the assignee is not a direct competitor of the non-assigning party.",
    clauseType: "assignment",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard commercial agreement",
  },
  // --- Insurance --------------------------------------------------------------------------------
  {
    text: "Provider shall maintain, at its expense: (a) commercial general liability insurance of at least $2,000,000 per occurrence; (b) professional liability (errors & omissions) insurance of at least $2,000,000 per claim; and (c) cyber liability insurance of at least $5,000,000, and shall provide certificates of insurance upon request.",
    clauseType: "insurance",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Enterprise procurement rider",
  },
  // --- Audit rights -----------------------------------------------------------------------------
  {
    text: "No more than once per twelve (12) month period and upon thirty (30) days' notice, Customer may audit Provider's compliance with this Agreement during normal business hours, subject to Provider's reasonable security policies. Provider may satisfy audits with its most recent SOC 2 Type II report. Each party bears its own audit costs unless the audit reveals material non-compliance.",
    clauseType: "audit_rights",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard SaaS MSA template",
  },
  // --- Service levels ---------------------------------------------------------------------------
  {
    text: "Provider shall make the Services available 99.9% of each calendar month, excluding scheduled maintenance announced at least 48 hours in advance. For each 0.1% below the target, Customer receives a service credit of 5% of monthly fees, up to 30%. If availability falls below 99.0% in three consecutive months, Customer may terminate without penalty and receive a pro-rata refund.",
    clauseType: "service_levels",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard SLA schedule",
    guidance: "99.9% uptime with escalating credits and a chronic-failure termination right is market standard.",
  },
  // --- Publicity --------------------------------------------------------------------------------
  {
    text: "Neither party shall use the other party's name, logo, or trademarks in any press release, customer list, or marketing material without prior written consent, except that Provider may identify Customer as a customer in factual lists after Customer's written approval of the specific usage.",
    clauseType: "publicity",
    jurisdiction: "US-general",
    riskBaseline: "market",
    source: "Standard commercial agreement",
  },
];
