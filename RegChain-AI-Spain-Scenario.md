# RegChain AI · Spain scenario: an early warning before a rule applies

> **Everything in this scenario is fictional:** the information note, the authority, the trial, the sites and the people. It shows how RegChain behaves; it is not a real Spanish rule. The trial is based on the synthetic clinical supply agreement the team drafted. The screens carry no demo labels; companies and sites have generic names ("Central EU depot, Belgium", "Hospital pharmacy, site ES-04"), and the note itself is marked *illustrative scenario*, because it is an invented regulation and should not be mistaken for a real Spanish rule. The import-permit idea became a shipping-document rule, because shipments between EU countries are generally not treated as imports.

## The story in one minute

On **10 Nov 2026** a fictional Spanish medicines authority publishes an information note. From **1 Mar 2027**, every IMP shipment to a trial site in Spain needs two things:

- a **delivery note in Spanish** with the EU trial number, the hospital pharmacy code and each batch number;
- an **electronic notice to the hospital pharmacy** at least 3 business days before delivery.

Hospital pharmacies refuse shipments that lack either, and refused shipments go back to the sender. The Spain Country Specification (v4) is not due for its next scheduled update until 20 Jan 2027.

RegChain finds the note on the day it is published. The AI reads it in Spanish, drafts the specification edits in English and quotes the note word for word, and RegChain checks every quote. The impact is clear: **6 of the 10** planned shipments of trial CTP-7842-201 are affected, the first must be prepared by **19 Feb 2027** (97 days away), and **2 sites** have no hospital pharmacy code yet. The owner approves, Spain specification **v5 is published between scheduled updates**, and a Quality task goes to the supply team.

| | UK case | Spain case |
| --- | --- | --- |
| Rule | Real: amended UK labeling rules | Fictional: shipping documents and pharmacy notice |
| When RegChain flags it | Months after the rule applied (28 Apr 2026) | 107 days before it applies (1 Mar 2027) |
| What it shows | Catching a change that the specification missed | Warning early enough to act calmly |
| Source | Fetched live from legislation.gov.uk and GOV.UK | A demo file, in Spanish |

## The note (fictional, summarised)

1. From 1 Mar 2027, every IMP shipment to a trial site in Spain travels with a delivery note in Spanish.
2. The delivery note shows the EU trial number, the receiving hospital pharmacy code and the batch number of each product.
3. The sponsor sends the hospital pharmacy an electronic notice at least 3 business days before the planned delivery.
4. Pharmacies refuse shipments that do not meet points 1 to 3, and refused products go back to the sender.
5. Shipments dispatched before 1 Mar 2027 and delivered by 8 Mar 2027 can follow the earlier procedure.
6. Labeling does not change.

The full Spanish text is in `demo-data/spain-scenario.json`. The dashboard also shows it in the Source log under *Information note 12/2026 (illustrative scenario)*.

## The trial (fictional)

**CTP-7842-201** is a phase III rheumatology study of XZ-417 50 mg film-coated tablets, run in Germany, Spain, Italy and Poland. It plans 64 sites and 480 patients, and its first patient is due on 15 Feb 2027. Supply comes from the central EU depot in Belgium. Shipments are prepared 5 business days before dispatch, or 2 when expedited. Eight sites are in Spain, and two of them (Sevilla and Málaga) have no hospital pharmacy code on file.

## What RegChain finds

| Shipment | Site | Dispatch | Delivery | Result | Prepare by | Notice by |
| --- | --- | --- | --- | --- | --- | --- |
| SHP-ES-01 | Madrid Norte | 1 Feb 2027 | 3 Feb 2027 | Earlier procedure allowed | — | — |
| SHP-ES-02 | Barcelona Mar | 2 Feb 2027 | 4 Feb 2027 | Earlier procedure allowed | — | — |
| SHP-ES-03 | Valencia | 8 Feb 2027 | 10 Feb 2027 | Earlier procedure allowed | — | — |
| SHP-ES-04 | Madrid Sur | 15 Feb 2027 | 17 Feb 2027 | Earlier procedure allowed | — | — |
| SHP-ES-05 | Barcelona Nord | 26 Feb 2027 | 9 Mar 2027 | New documents needed | 19 Feb 2027 | 4 Mar 2027 |
| SHP-ES-06 | Bilbao | 1 Mar 2027 | 3 Mar 2027 | New documents needed | 22 Feb 2027 | 26 Feb 2027 |
| SHP-ES-07 | Madrid Norte | 4 Mar 2027 | 8 Mar 2027 | New documents needed | 25 Feb 2027 | 3 Mar 2027 |
| SHP-ES-08 | Sevilla | 8 Mar 2027 | 10 Mar 2027 | Insufficient information (no pharmacy code) | 1 Mar 2027 | 5 Mar 2027 |
| SHP-ES-09 | Barcelona Mar | 15 Mar 2027 | 17 Mar 2027 | New documents needed | 8 Mar 2027 | 12 Mar 2027 |
| SHP-ES-10 | Málaga | 22 Mar 2027 | 24 Mar 2027 | Insufficient information (no pharmacy code) | 15 Mar 2027 | 19 Mar 2027 |

**The rule RegChain applies.** A shipment can follow the earlier procedure only if it was dispatched before 1 Mar 2027 **and** delivered by 8 Mar 2027. Every other shipment needs the new documents. If such a shipment goes to a site without a pharmacy code, the result is *Insufficient information*. "Prepare by" is the dispatch date minus 5 business days, and "Notice by" is the delivery date minus 3 business days. In this demo, business days skip weekends only.

**Three boundary cases worth showing:**
- **SHP-ES-05** was dispatched before 1 Mar but arrives on 9 Mar, after the 8 Mar limit. It needs the new documents.
- **SHP-ES-06** is dispatched on 1 Mar itself. It needs the new documents.
- **SHP-ES-07** arrives by 8 Mar but was dispatched after 1 Mar. It still needs the new documents.

The other three trials in the demo portfolio with Spanish sites have no shipments planned in the data. RegChain says so and notes that their future shipments will need the new documents.

## The AI check

On the Spain case, **Run AI check** sends Claude two texts: the note (in Spanish) and the current Spain Country Specification. Claude returns a draft with the summary, the effective date, the transition, the operational instruction, one **edit per specification line** and quotes that support each claim. RegChain then checks four things, and a failed check blocks approval:

- every quote appears word for word in the note, in Spanish and never translated;
- the effective date is 2027-03-01;
- every edit replaces a line that really exists in the specification, or adds a new one;
- the change status agrees with the comparison.

`npm run check:ai` tests these checks with a stand-in AI. It confirms that a translated quote, a wrong date and an edit aimed at a missing line are all caught. A real run needs the API key in `.env`.

## How to use it in the demo (about 45 seconds)

1. **Overview:** the *Spain shipping-document change · early warning* card shows the rule applying in 107 days, 6 of 10 shipments affected, the first to prepare by 19 Feb 2027, and 2 sites without a pharmacy code.
2. **Open the Spain case:** the AI panel shows the quotes in Spanish with every check passed, and the shipments table shows the three boundary cases.
3. **SME decision:** the redline adds the Spanish delivery note, the pharmacy notice and the pharmacy code. Approve as the Regulatory SME.
4. **Country specifications → Spain:** the specification is now v5, published between scheduled updates, while the 20 Jan 2027 update stays on the calendar.
5. **Quality follow-up:** the task is due 19 Feb 2027 and lists the 6 shipments and the 2 sites without a pharmacy code.

## Files

- `demo-data/spain-scenario.json` holds all the scenario data: the note, the trial, its sites and shipments, the Spain specification, and the suggested edits used before an AI run. Edit it and reload the page.
- `regchain-ai/spain.mjs` turns the file into the two texts the AI reads and the rule it is checked against.
- `regchain-ai/analyze.mjs` holds the Spain prompt (profile `es`) and the extra check that every edit targets a real line.
- `serve-regchain.cjs` serves the AI routes for both cases (`?case=es`) and keeps the last Spain result in `.regchain-cache/analysis-es-latest.json`.
- `RegChain-AI-Dashboard.html` contains the Overview card, the Spain case and the Spain specification. Without the local server the Spain scenario is left out.
