# RegChain AI · product review, 15 November 2026

A skeptical reassessment of the whole platform. It combines an independent screen-by-screen review, independent market research and a code review, and lists what was fixed today and what is still open.

## The verdict

**The problem is real, but narrower than the current pitch says.** The research found no evidence that *missed rule changes* are a main cause of clinical supply failures. The failures that are documented are mostly **requirements that already existed but were not applied to a given shipment**: missing pre-approvals, inconsistent documents, permits that don't match the shipment. Supply-relevant rule changes run to roughly a few dozen a year across 50+ countries (an inference; no direct count exists), and most are announced well in advance.

What nobody seems to offer is the link from a country's requirements to **specific trials, batches and shipments**, with evidence and an approval trail. Detection alone is already sold by regulatory intelligence vendors.

**Recommendation:** position RegChain as a **pre-shipment check against the current Country Specification**. Every planned shipment is tested against the requirements of its destination before it leaves the depot. Change monitoring stays, as the way the specification is kept current between scheduled updates. Our two cases already show both halves:

- **UK:** what happens without RegChain. The first scan finds the specification 200 days behind the rule, with 7 legacy-label batches to look back on.
- **Spain:** what happens with RegChain. The change is flagged 107 days early, with each affected shipment and its last safe date.

## What the evidence says

| Finding | Confidence | Source |
| --- | --- | --- |
| No published number separates rule-change holds from paperwork errors. The often-quoted "~60% of customs delays are documentation" has no primary source. | High | Research summary |
| In a small 2026 survey, "reduce supply delays" was the top priority (41%), while "adapting to regulatory changes" was chosen less often. | Medium | [Myonex 2026 insight](https://www.myonex.com/2026-clinical-trial-supply-insight/) |
| Latin American customs holds come from missing pre-approvals and inconsistent documents, which are execution errors. | Medium | [PharmTech Q&A](https://www.pharmtech.com/view/q-a-how-can-sponsors-respond-to-clinical-trial-customs-delays-) |
| Real rule-driven cases exist, as anecdotes: South Africa (approval letters must state quantities), Argentina (any content change needs a revised import licence, costing weeks), EU (the expiry date on immediate packaging forced relabelling until it was relaxed in 2022). | Medium | [Pharmaceutical Online](https://www.pharmaceuticalonline.com/doc/the-reliance-trap-when-regulatory-strategy-becomes-a-clinical-supply-problem-0001), [DIA Global Forum](https://globalforum.diaglobal.org/issue/march-2026/navigating-global-clinical-supply-challenges-in-diverse-regulatory-environments/), [Applied Clinical Trials](https://www.appliedclinicaltrialsonline.com/labeling-challenges-eu-annex-vi-0) |
| The fast-moving changes are tariffs, sanctions, controlled-drug scheduling and permit forms or portals. Example: the US added a tariff heading for clinical-trial use from 29 Sep 2026. | Medium | [WilmerHale](https://www.wilmerhale.com/en/insights/client-alerts/20261015-section-232-pharmaceutical-tariffs-are-now-in-effect-its-not-too-late-to-consider-duty-mitigation-strategies), [ClinRegs Mexico](https://clinregs.niaid.nih.gov/updates/full/234-mexico-profile-updated) |
| Knowledge sits with couriers, depots and import brokers (86% used brokers in a 2016 survey). Regulatory intelligence vendors (RegASK, Redica, Cortellis) map changes to products and documents, not to shipments. | Medium | [Clinical Trials Arena](https://www.clinicaltrialsarena.com/news/arena-international-survey-reveals-current-and-future-trends-in-the-clinical-trial-supplies-market-5758435-2/), [Marken](https://www.marken.com/news/ensuring-smooth-importation-of-clinical-trial-materials-the-importance-of-accurate-customs-documentation), [Redica](https://redica.com/regulatory-intelligence/) |
| No public product links regulatory requirements to specific IMP shipments or batches. The closest is batch release by country for commercial products. Vendor documentation is mostly behind logins, so this is not proof. | Medium | [Veeva](https://www.veeva.com/?p=118103), [Loftware](https://www.loftware.com/industries/clinical-trials) |

**Before building further,** ask 5 to 10 supply teams for 12 months of shipment holds and relabels, with root causes. If only a small share trace back to rule changes, lead with the pre-shipment check.

## Doubts worth keeping

- **Who buys it?** Clinical supply owns the country document, trade compliance the import side, Regulatory Affairs the intelligence subscription, and the importer of record does the final check.
- **Couriers, depots and import brokers** already hold this knowledge and the liability. They could be a channel or a competitor, and their alerts are a data source official websites don't have.
- **Integration** with IRT, ERP, depot and courier data is a separate job for every trial and vendor. Start from a shipment export.
- **Regulated use:** as soon as RegChain edits a controlled document or blocks a shipment, it needs GxP validation, Part 11 signatures and an audit trail. Start as decision support.
- **AI trust:** a wrong requirement can cause a hold, and much practice is unwritten or in the local language. The quote checks and the expert approval are the answer; keep them strict.

## Fixed today

1. **One impact model** (Act / Check / Not affected) on every screen. The Overview, the Assessment, the tables and the Quality task now agree: act on 7 trials, 12 batches and 6 shipments; check 1 more trial, 9 batches and 2 shipments.
2. **The UK story is honest.** "Found at the first scan on 14 Nov 2026 · the rule has applied since 28 Apr 2026, 200 days earlier", with a **look-back** listing the 7 legacy-label batches certified since the rule applied, so anything already shipped gets checked.
3. **A real AI gate.** Approval needs a passing AI check. Without one, the SME must tick an override and give a reason, and the override is logged. A failed check blocks approval with no override. The button is greyed out when blocked, every AI run is logged in the audit trail, and the confidence panel is calculated from the checks.
4. **Version dates.** The rule's date and the date a version came into force are now separate: "Rule applies from 28 Apr 2026 · v13 in force from 14 Nov 2026 · gap closed: v12 described the earlier rule for 200 days". The date lookup shows the gap.
5. **No dead ends:**
   - A rejected edit stays visible as "Edit rejected · next step needed" and can be reopened.
   - Changes without a case get an owner decision (not relevant / open a case / keep assessing) and show how long they have been open.
   - A failed source check can be retried, which fetches the official GOV.UK page now.
6. **Named people and separation of duties:** A. Novak or C. Ruiz approves, M. Okafor implements, L. Chen verifies, and the verifier can't be the approver. "Reset this case" has moved out of the audit trail.
7. **Smaller fixes:**
   - The date basis is named as MHRA's reading of Schedule 14, which says "manufactured", and is listed as a question for the SME.
   - Spain's detection date is the note's publication day.
   - The AI setup hints are folded away.
   - Dates no longer show "Sept".
   - "Ordinary cohort date", "handoff" and "Studies" are replaced with plainer words.

Tested in headless Edge: 23 checks pass with no AI result recorded and with a failed one. A sweep of 137 screens finds no demo wording and no page errors, served and as a file.

## Still open, ranked

**For the hackathon:**
1. **Real AI runs** for both cases, with saved results in case the venue's internet fails (needs the API key).
2. **One clock.** "Today" is fixed at Saturday 14 Nov 2026, but approvals use the real clock. UK preparation dates use calendar days, so some fall on weekends. Pick the demo date, move the UK data to business days and regenerate the answer key.
3. **Shipment actions.** Rows can't be clicked yet. Add Hold / Swap batch / Proceed, each with a reason in the audit trail.
4. **Pre-shipment check view** (if the reframe is agreed): each planned shipment against each section of its country's specification, with pass, fail or missing data.
5. **Fewer status words.** About 20 remain. Reduce them to the three impact words plus Current / Change to assess / Edit suggested.
6. **Smaller items:**
   - In Spain, the delivery note sits under "Mandatory invoice statements".
   - The US specification says "current" although none of its sources are watched.
   - The purpose of the "Public registry" tab is unclear.
   - The Monitoring schedule says "Paused".
   - "labeling" and "labelling" are both used, and times mix UTC and Athens time.

**For a real product:** connections to trial, supply and batch systems; a server-side monitoring pipeline with notifications; a database with a permanent audit trail; company sign-in with real permissions and electronic signatures; hosting with a key vault and backups; AI logging, accuracy tests against past changes and cost limits; GxP validation; automated tests in CI; the single HTML file split into modules; national and regional holiday calendars; and the real Country Specifications imported.
