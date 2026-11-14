# RegChain AI · demo scenario: one UK rule change, seven trials affected

**One UK labelling change. 18 trials checked in one run. 7 trials need action, 12 batches need a labelling review or an expert decision, and 6 shipments to UK sites need work before dispatch. The first preparation deadline is today, at a site with 22 patients on treatment.**

The regulation and its sources are real. The sponsor, trials, sites, batches, shipments and patient counts are fictional, and the demo says so.

> A second, fictional scenario shows the early warning before a rule applies: [RegChain-AI-Spain-Scenario.md](RegChain-AI-Spain-Scenario.md).

## The story in one minute

A sponsor runs 18 trials in 17 countries. On 28 April 2026 the UK's amended clinical trial rules on labelling investigational medicinal products (IMPs) came into force. Batches certified by a Qualified Person (QP) before that date may keep the old labels if conditions are met. Batches certified after it need labels that follow the new rules, and a batch certified on the day itself goes to the expert.

Nobody connected that change to the supply plan. Six months later, on 14 November 2026, six shipments to UK sites are about to leave with batches that need a labelling review or are missing facts. One shipment has to be prepared today.

RegChain reads the official texts, drafts the change with checked quotes, matches it against every trial, batch and shipment, and puts the result in front of the Regulatory Affairs expert for a decision.

## The regulation change (real)

| Source | What it gives us |
| --- | --- |
| [Regulation 46, version in force on 27 April 2026](https://www.legislation.gov.uk/uksi/2004/1031/regulation/46/2026-04-27) | The old labelling rule |
| [Regulation 46, version in force from 28 April 2026](https://www.legislation.gov.uk/uksi/2004/1031/regulation/46/2026-04-28) | The new labelling rule (Part 7 replaced by S.I. 2025/538) |
| [Schedule 14, paragraph 6](https://www.legislation.gov.uk/uksi/2004/1031/schedule/14/paragraph/6/2026-04-28) | The transition: when the old labelling rules can continue |
| [MHRA guidance, labelling transition section](https://www.gov.uk/guidance/clinical-trials-for-medicines-clinical-trials-regulations-transitional-arrangements#transitional-arrangements-for-labelling-of-investigational-medicinal-products) (updated 15 July 2026) | The date that counts is the QP certification of the finished IMP |

The dashboard's AI check fetches these four sources live. The rule RegChain applies to each batch is the one in the master specification, section 7.2.

## The fictional portfolio

| | Count | Detail |
| --- | --- | --- |
| Trials | 18 | 17 active, 1 completed (UK oncology follow-up, supply closed) |
| Countries | 17 | UK, 12 others in Europe, US, Canada, Japan, Australia |
| Trials with UK sites | 9 | 8 of them still receive supply |
| Sites | 30 | 11 in the UK, with 190 patients on treatment |
| Batches | 33 | 21 for the UK, 12 for other countries |
| Shipments planned | 10 | 8 to the UK, all dispatching by 8 December 2026 |

The six batches from the specification (A-101 to F-106) are part of this portfolio with the same inputs, so the specification's expected results still hold.

## What RegChain finds

### By trial

| Trial | UK batches | Result |
| --- | --- | --- |
| STUDY-001 · UK legacy-cohort study | 4 | **Action:** G-107 needs a labelling review; D-104 has no QP date; A-101 may use the transition; H-108 needs a specification check |
| STUDY-003 · UK labeling and supply study | 3 | **Action:** B-102 needs a labelling review; F-106 was certified on the cutoff day; C-103 needs a specification check |
| STUDY-004 · Multinational asthma study | 3 | **Action:** J-202 needs a labelling review; J-201 was certified before the cutoff but the trial's cohort is unknown; J-203 needs a specification check. The German batch is out of scope |
| STUDY-005 · Rare disease enzyme study | 2 | **Action:** K-301 and K-302 need a labelling review. The French batch is out of scope |
| STUDY-006 · Paediatric vaccine study | 3 | **Action:** L-402 was certified the day before the cutoff, but its intended trial use is not confirmed; L-401 may use the transition; L-403 needs a specification check |
| STUDY-008 · Type 2 diabetes study | 2 | **Action:** N-601 needs a labelling review; N-602 has no label version on record. The US batch is out of scope |
| STUDY-009 · Rheumatoid arthritis study | 2 | **Action:** P-702 needs a labelling review; P-701 may use the transition |
| STUDY-007 · Migraine prevention study | 2 | **Check only:** both batches already carry the updated label |
| STUDY-018 · UK oncology follow-up | 0 | Not affected: supply closed |
| 9 trials without UK sites | 0 | Not affected: checked and excluded with the reason |

### By batch

| Result | Batches | What happens next |
| --- | --- | --- |
| Labelling review required | 7 | QP date after the cutoff and an old label: relabel or confirm an approved variation |
| Needs review | 5 | A fact is missing or the batch sits on the boundary; the expert decides |
| Verify specification | 6 | Updated label already; confirm the approved specification |
| May use the transition | 3 | The expert confirms the Schedule 14 conditions |
| Out of scope | 12 | Not supplied to the UK |

### Shipments that need action before dispatch

| Shipment | Batch | Site | Prepare by | Days left | Patients on treatment at the site |
| --- | --- | --- | --- | --- | --- |
| SHP-04 | J-202 | Birmingham | 14 Nov 2026 | **0** | 22 |
| SHP-01 | B-102 | London | 17 Nov 2026 | 3 | 14 |
| SHP-02 | D-104 | Manchester | 20 Nov 2026 | 6 | 9 |
| SHP-05 | K-301 | Cambridge | 22 Nov 2026 | 8 | 6 |
| SHP-06 | N-601 | Newcastle | 27 Nov 2026 | 13 | 31 |
| SHP-08 | P-702 | Oxford | 29 Nov 2026 | 15 | 19 |

Together these sites have **101 patients on treatment** whose resupply depends on these shipments. Two more UK shipments (SHP-07 and SHP-09) need only a specification check. The two shipments to Germany are not affected.

## Why this shows the need

- **The deciding fact lives in another system.** The rule turns on the finished-IMP QP certification date, which sits in the supply or quality system, not in the regulatory tracker. B-102 was manufactured before the cutoff but certified after it. A check on the manufacture date would wrongly clear it.
- **Edge cases hide in the data.** F-106 was certified on the cutoff day itself, L-402 the day before but without confirmed intended use, D-104 has no QP date, and N-602 has no label version. A spreadsheet filter passes over these; RegChain names them.
- **The cost of missing it lands on patients.** The earliest deadline is today. Six UK sites with 101 patients are waiting on these shipments.
- **Scale.** One change meant checking 18 trials, 33 batches and 10 shipments against 4 official sources. A real sponsor has many more trials and countries, and the rules keep changing.

**To add from the team:** how long this check takes by hand today, in hours per change, from someone who has done it. Use a real number from experience, not an estimate made up for the pitch.

## How to use it in the demo

1. **Open with the headline numbers:** 7 of 18 trials need action, and the first deadline is today. The Overview page shows them in the "UK labeling change · portfolio impact" card, with the six shipments and their time left.
2. **Show the source change:** run the AI check, open the regulation 46 comparison and the quote checks.
3. **Show the trials:** the 7 trials needing action, the 1 needing a check only, and the 10 excluded with reasons.
4. **Zoom into one shipment:** SHP-01, where B-102 was made before the cutoff but certified after it.
5. **Show the expert's decision:** approve the suggested edit, which publishes the UK Country Specification v13 between scheduled updates, and create the Quality task.

## Files and how to change the data

| File | What it is |
| --- | --- |
| `demo-data/uk-labelling-portfolio.json` | The fictional portfolio, in the same format as `RegChain-AI-Clinical-Trial-Input.example.json`. This is the seed for the database |
| `demo-data/uk-labelling-expected-impact.json` | What the pipeline should find for every trial, batch and shipment, with the totals above. Use it as the test answer key |
| `scripts/build-demo-portfolio.mjs` | Builds both files. Edit the tables at the top, then run `node scripts/build-demo-portfolio.mjs` |

The results use codes rather than display names, because the team still has to agree the names shown on screen (see the project plan, step 1):

| Code | Specification wording | Dashboard today |
| --- | --- | --- |
| `labeling_review_required` | Labeling review required | Labeling review required |
| `needs_review` | Needs review | Insufficient information, or Needs SME assessment on the cutoff day |
| `verify_specification_and_approvals` | Verify specification and approvals | Verify specification |
| `potential_transition_eligibility` | Potential transition eligibility | Potential transition eligibility |
| `out_of_scope` | Out of scope | Out of scope |

Not in the data yet: contracts and quality agreements per partner (see `RegChain-AI-Clinical-Trial-Workflow.md`), customs entry dates, and the EU and GB import cases.
