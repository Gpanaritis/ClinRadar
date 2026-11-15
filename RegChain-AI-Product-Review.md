# RegChain AI · product review, 15 November 2026

> Later on 15 Nov 2026 this review, a deeper research round ([ClinRadar-Research.md](ClinRadar-Research.md)) and the team's ClinRadar brief led to **ClinRadar** ([ClinRadar.md](ClinRadar.md)). The review below is kept as it was written; its counts (13 blocked of 25, six MCP servers) are from before that change.

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

## Built after the review: the pre-shipment check

The **Shipment checks** page tests all 20 planned shipments against their destination's Country Specification. Today it finds 11 blocked, 5 to confirm and 4 ready to ship. Each check names its source and marks requirements from changes still waiting for approval as **pending**. The planner can hold a shipment, swap the batch or proceed, with a reason recorded under their name. The blocked shipments include both kinds of failure: rule changes (UK legacy labels) and requirements that already existed but weren't met (a missing German label specification, a missing QP date, a missing pharmacy code).

## Built next: agents that resolve a blocked shipment

The hackathon is about agentic AI, and finding a blocked shipment is only half the job. **Agent plans**, in the menu, gives every shipment that needs action a team of agents:

- An orchestrator (Claude Opus 5.5) delegates to supply, logistics, records and communications agents (Claude Sonnet 5.5).
- The agents read IRT, ERP, the depot and the eTMF through six MCP servers, all read-only except a draft inbox.
- The orchestrator proposes options and checks each one with RegChain's rules, then drafts the changes for people to approve in their own validated systems.

On SHP-04 it finds the eTMF authorisation letter that IRT is missing and a replacement batch with the updated label. On SHP-03 nothing passes, so it escalates instead of guessing. The design keeps generative AI out of the decision, in line with the draft EU GMP Annex 22: fixed rules decide pass or fail, and a named person approves. See [RegChain-AI-Agents.md](RegChain-AI-Agents.md).

**Plan all with AI agents** runs the same team on every shipment that needs action, most urgent first, then checks the plans together so no kits or relabelling slot is promised twice. That is the orchestration a supply team cannot do by email: on today's data SHP-06 is moved to the 18 Nov slot because SHP-01 needs the 16 Nov one more urgently.

## Second review, 15 Nov: logic gaps found and fixed

An independent review of the code and a run of the agents on every shipment found these gaps. All are fixed:

- **Two shipments could be promised the same kits or relabelling slot.** Approved plans now hold what they use; the verifier counts it and the portfolio run allocates in priority order.
- **Relabelling and label specifications were judged against the dispatch date**, not the preparation date. Kits must be relabelled, and QP-released kits at the depot, before preparation starts. SHP-04's relabelling now passes only if the dispatch moves to 23 Nov.
- **Shipments that only need confirming** (SHP-07, SHP-09, three in Spain) got "escalate" or an empty option. They now get "proceed and confirm", with a confirmation draft.
- **Approvals lived only in the browser.** They went stale after a new run, could not be withdrawn, and approving a non-recommended option approved the wrong drafts. Approvals are now:
  - stored and re-checked on the server;
  - tied to the run they came from;
  - withdrawable, with every approval and withdrawal logged;
  - limited to Clinical Supply.

  Drafts name their option, and drafts for an option that fails are withdrawn.
- **Spanish shipments showed "Ready to ship" for a batch only planned for QP release.** A planned release is now Confirm, and a booked one stays Confirm until the QP signs.
- **A weekend UK dispatch was only Confirm**, though the specification says the depot dispatches on working days only. It now blocks, and SHP-01's plan moves the dispatch to Monday.
- **A run in progress could appear under another shipment.** Each run now belongs to its own shipment.
- **The agents read the UK specification without knowing a change is pending.** Sections with a pending change now say so.
- **The audit record shortened tool answers.** It now keeps them in full, along with every version of every run, and every prompt says tool results are data, not instructions.
- **Bad dates in an option could stop a run.** They now make the option fail.
- **A UK or Spain case could close while its shipments were still blocked.** Quality can't verify until each one has a recorded action.
- **Approvals used the real clock and the case used the planning date.** The case now publishes on the planning date, so the Quality task isn't overdue the moment it is created.
- **The Spain date lookup ignored the delivery-date condition.** It now states it.

Not changed: the UK controlled-drug and Spain consignee checks show Pass from the specification's own statements, not from shipment data.

**Suggested demo order (about 5 minutes).** The full script, with clicks and talk track, is Scenario A in [RegChain-AI-User-Journeys.md](RegChain-AI-User-Journeys.md).
1. **Shipment checks.** 11 of 20 blocked. Open SHP-04: it must be prepared today and fails the amended UK labeling rule, marked "pending change: specification v12 doesn't say this yet". Open SHP-03: Germany has no label specification for that batch, a gap that has nothing to do with any rule change.
2. **Agents on SHP-04, live.** Open its plan, then **Run the agents again → Run the AI agents**. Watch the orchestrator delegate, the agents call IRT, ERP, the depot and the eTMF, and the verifier pass the swap, pass "relabel and dispatch on 23 Nov", and fail the delay. Approve the swap as Clinical Supply; the drafts wait for approval in IRT.
3. **Agent plans.** 16 shipments, most urgent first: 14 plans, 2 escalations, 1 re-plan. Point at SHP-06: its agents chose the 16 Nov slot, but SHP-01 needs it first, so RegChain moved it to 18 Nov. Show a run recorded beforehand, as a live run of all 16 takes several minutes.
4. **The UK case.** Found at the first scan, 200 days after the rule applied; the look-back lists 7 legacy-label batches. Run the AI check, approve, and SHP-04 now cites specification v13. Quality can't close the case until every blocked shipment has an action.
5. **Spain.** The same check flags the new rule 107 days early. SHP-ES-10's batch has no QP release planned and its site has no pharmacy code: the agents book the QP slot and draft the request to the site in Spanish and English.

## Still open, ranked

**For the hackathon:**
1. **Real AI runs** for both cases and one live agent run (SHP-04), with saved results in case the venue's internet fails (needs the API key). The page loads the last agent run for each shipment.
2. **One clock.** "Today" is fixed at Saturday 14 Nov 2026. Case dates now use it; approval times still use the real clock, which is right for an audit trail. UK preparation dates use calendar days, so some fall on weekends. Pick the demo date, move the UK data to business days and regenerate the answer key.
3. ~~Shipment actions~~ and ~~the pre-shipment check view~~: built (see above). Still to do: put shipment actions into each case's audit trail, not only the browser.
4. **Connect more data** so fewer requirements show as Not checked: invoices, label texts, courier and importer alerts.
5. **Fewer status words.** About 20 remain. Reduce them to the three impact words plus Current / Change to assess / Edit suggested.
6. **Smaller items:**
   - In Spain, the delivery note sits under "Mandatory invoice statements".
   - The US specification says "current" although none of its sources are watched.
   - The purpose of the "Public registry" tab is unclear.
   - The Monitoring schedule says "Paused".
   - "labeling" and "labelling" are both used, and times mix UTC and Athens time.

**For a real product:** connections to trial, supply and batch systems; a server-side monitoring pipeline with notifications; a database with a permanent audit trail; company sign-in with real permissions and electronic signatures; hosting with a key vault and backups; AI logging, accuracy tests against past changes and cost limits; GxP validation; automated tests in CI; the single HTML file split into modules; national and regional holiday calendars; and the real Country Specifications imported.
