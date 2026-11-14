# RegChain AI dashboard research

14 November 2026

## Public clinical trial data

| Source | What RegChain can use | How to include it |
| --- | --- | --- |
| ClinicalTrials.gov | NCT ID, study title and type, sponsor, intervention type, listed site countries, recruitment status, and record update date. | Use API v2 for a read-only screen. Keep the original record URL, registry status, posted date and retrieval time. The dashboard includes three manually verified records. [Download and API guide](https://clinicaltrials.gov/data-api/how-download-study-records) · [Data terms](https://clinicaltrials.gov/terms-conditions) |
| EMA CTIS public portal | EU/EEA trials, EU trial numbers and public trial documents. | Use public search and downloads to enrich EU examples. Link to a ClinicalTrials.gov record when it lists the same CTIS identifier. Keep record provenance for both. [EMA CTIS overview](https://www.ema.europa.eu/en/human-regulatory-overview/research-development/clinical-trials-human-medicines/clinical-trials-information-system-ctis) · [Public portal download features](https://www.ema.europa.eu/system/files/documents/newsletter/ctis-newsflash-24-september-2024_en.pdf) |
| AACT | A relational copy of ClinicalTrials.gov for SQL queries and bulk snapshots. | Use when profiling many studies or evaluating screening offline. Preserve the NCT ID as the primary link and the snapshot date. [CTTI AACT](https://aact.ctti-clinicaltrials.org/landing) |

For the first data integration, screen interventional drug studies by listed site jurisdiction and record status, and retain the query and retrieval timestamp. For GB-specific screening, use a listed site in England, Scotland or Wales where the location supports it. A country-level match is a lead for further review. Clinical Supply must join the registry record to authorized sponsor records for label specifications, trial authorization cohort, batch certification, product presentation, shipment routes and operational dates. Registry data can be refreshed independently of review findings.

### Study examples included

- **NCT05797168**, FONTANA, AstraZeneca. The captured registry record lists a UK site in London and shows recruiting status, with an update posted on 5 October 2026. [ClinicalTrials.gov record](https://clinicaltrials.gov/study/NCT05797168)
- **NCT07284979**, KaiNETIC-3, Kailera. The captured registry record lists UK, Polish and Bulgarian sites, among others, and shows recruiting status, with an update posted on 1 September 2026. This record illustrates screening for both UK and EU cases. [ClinicalTrials.gov record](https://clinicaltrials.gov/study/NCT07284979)
- **NCT07685600**, AZD4144 interaction study, AstraZeneca. The captured registry record lists a UK site in Harrow and shows recruiting status, with an update posted on 28 September 2026. [ClinicalTrials.gov record](https://clinicaltrials.gov/study/NCT07685600)

Source for the three example records is ClinicalTrials.gov, U.S. National Library of Medicine, accessed 14 November 2026. The dashboard uses shortened display titles. Public matches are labeled **Candidate match**. The fictional portfolio supplies the batch-level review examples.

## Source-backed use cases

| Use case | Verified source change | How the dashboard uses it |
| --- | --- | --- |
| UK IMP labeling transition | The UK amendment replaced Part 7 from 28 April 2026. Schedule 14 preserves the earlier labeling rules in a qualifying cohort, and MHRA explains the finished-IMP QP certification date used in this transition. | Show the statute alongside the guidance. Trace the change to fictional UK studies with pre-cutoff and post-cutoff batches, an exact cutoff case, and a missing QP date. [UK amendment](https://www.legislation.gov.uk/uksi/2025/538/pdfs/uksi_20250538_en.pdf) · [MHRA transition guidance](https://www.gov.uk/guidance/clinical-trials-for-medicines-clinical-trials-regulations-transitional-arrangements#transitional-arrangements-for-labelling-of-investigational-medicinal-products) |
| Great Britain import oversight | The 12 February 2025 update note identifies a guidance revision reflecting implementation of the EU Clinical Trials Regulation for EU QP certification. | Screen GB sites, then require confirmed origin, destination, import authorization and certification evidence to triage a shipment. Show a simulated retry on the approved-country list and preserve incomplete coverage. [MHRA publication history](https://www.gov.uk/government/publications/importing-investigational-medicinal-products-into-great-britain-from-approved-countries) · [Detailed guidance](https://www.gov.uk/government/publications/importing-investigational-medicinal-products-into-great-britain-from-approved-countries/importing-investigational-medicinal-products-imp-from-countries-on-a-list-to-great-britain) |
| EU cryopreserved product labeling | The July 2026 EU Clinical Trials Regulation Q&A revision added question 8.4 on labeling cryopreserved medicinal products. The Commission's linked PDF now serves a later edition that retains the question. | Replay the July revision as a historical guidance event. Screen EU trial sites and request product presentation, cryopreservation status and label specification before applying it. [Commission CTR Q&A](https://health.ec.europa.eu/document/download/4ec3992a-ef9b-41f9-8e34-1dd6d0a479ae_en?filename=mp_ctr_qa_rules.pdf) · [EudraLex Volume 10](https://health.ec.europa.eu/medicinal-products/eudralex/eudralex-volume-10_en) |
| EU immediate-packaging expiry text | Delegated Regulation 2022/2239 amended Annex VI to allow omission of expiry or retest dates from immediate packaging under specified packaging conditions. | Use as a second EU labeling case. Triage against the actual primary and outer packaging configuration and applicable authorization status. [EUR-Lex, Annex VI amendment](https://eur-lex.europa.eu/eli/reg_del/2022/2239/oj/eng) |

Clarivate's ClaRITA provides a comparable workflow for regulatory alerts, impact assessment and action assignment. For RegChain, the product question is whether reviewers can go from an alert to the specific study, batch or shipment evidence in fewer steps. [Clarivate ClaRITA](https://clarivate.com/life-sciences-healthcare/medtech/medtech-regulatory-intelligence/clarivate-regulatory-intelligence-tracking-app-clarita/)

## Dashboard workflow

1. **Overview.** Open a change from its region and jurisdiction. The case opens to Evidence & impact, with the supporting sources, outstanding inputs and applicable study assessments together. Resolved cases remain accessible from the overview.
2. **Case.** For the UK labeling example, use SME decision to record an outcome. Approval opens Quality follow-up. Country specification shows the section's published versions, and the case's audit trail holds the decision and follow-up history.
3. **Country specifications.** Search by country and filter the sections of its specification. Open a section to see its text, status, owner, check dates, a suggested edit where one exists, the trials it affects and what the official sources say.
4. **Monitoring.** Use Source log for failed checks and coverage gaps. Use Monitoring schedule to change the cadence of the local replay.

## Country coverage and cadence

- A country library is useful as the standing reference for clinical supply teams. Start with defined topics and jurisdictions that have an assigned reviewer and authoritative sources. For each requirement, record jurisdiction, applicable scope, source provision, effective dates, approval state and version history. Show coverage gaps by topic. NIAID’s ClinRegs provides public country summaries, including investigational products, and can help find primary sources. [NIAID ClinRegs](https://clinregs.niaid.nih.gov/about)
- Geographic navigation supports quick triage. Regulatory scope stays attached to each change. One EU-level record can be shown with relevant country profiles while remaining a single open item. A country contributes to the national-change count only when it has a change recorded at country level. Review status and legal effective date serve different purposes.
- Give monitoring administrators a default repeat interval. Use daily checks by default for priority sources, allow slower checks for stable sources, and use alert subscriptions when an authority provides them. Retry failed retrievals on a shorter schedule and keep coverage incomplete until the source is checked successfully. Check attempted and successful timestamps separately. A live adapter can start with the public GOV.UK Content API for approved GOV.UK pages. [GOV.UK Content API documentation](https://content-api.publishing.service.gov.uk/getting-started.html)
- Live scheduled checks belong in a deployed worker. Store schedule settings for each workspace, record runs and outcomes, prevent overlapping or duplicate jobs, and route material changes to SME review. Saving a schedule authorizes checks. The country-record approval workflow still governs publication.

The dashboard runs locally from a single HTML file with research-backed fixtures. The schedule persists in browser storage when available. Automatic replay can run while the page is open, or catch up once when it reopens. The browser demo does not perform live source retrieval.
