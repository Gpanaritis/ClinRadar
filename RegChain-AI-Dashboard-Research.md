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
| EU cryopreserved product labeling | The July 2026 EU Clinical Trials Regulation Q&A revision added question 8.4 on labeling cryopreserved medicinal products. The Commission index also links an October 2026 edition. | Replay the July revision as a historical guidance event. Screen EU trial sites and request product presentation, cryopreservation status and label specification before applying it. [July 2026 Q&A](https://health.ec.europa.eu/document/download/4ec3992a-ef9b-41f9-8e34-1dd6d0a479ae_en?filename=mp_ctr_qa_rules.pdf) · [EudraLex Volume 10](https://health.ec.europa.eu/medicinal-products/eudralex/eudralex-volume-10_en) |
| EU immediate-packaging expiry text | Delegated Regulation 2022/2239 amended Annex VI to allow omission of expiry or retest dates from immediate packaging under specified packaging conditions. | Use as a second EU labeling case. Triage against the actual primary and outer packaging configuration and applicable authorization status. [EUR-Lex, Annex VI amendment](https://eur-lex.europa.eu/eli/reg_del/2022/2239/oj/eng) |

Clarivate's ClaRITA provides a comparable workflow for regulatory alerts, impact assessment and action assignment. For RegChain, the product question is whether reviewers can go from an alert to the specific study, batch or shipment evidence in fewer steps. [Clarivate ClaRITA](https://clarivate.com/life-sciences-healthcare/medtech/medtech-regulatory-intelligence/clarivate-regulatory-intelligence-tracking-app-clarita/)

## Dashboard workflow

1. **Scan overview.** See total attempted pages, source failures, changes detected and fictional studies to review. The statuses describe the simulated historical replay.
2. **Inspect a source.** Open its URL, last attempt, check status, section compared, source edition and linked change. Filter or search the source log, including the failed-check view.
3. **Inspect a change.** Read the previous reference, the change, the supporting sources and the missing information. Selecting a change updates the study panel.
4. **Review study impact.** Drill into fictional studies and their batches, or open the public registry candidates and their original records. For the UK labeling case, the separate approval demo remains available from the study workspace.

The dashboard runs locally from a single HTML file with research-backed fixtures. A future live monitor would store each source attempt and its retrieval outcome, run the document comparison, persist the detected change and pass it to the governed impact and approval flow.
