# SupplyShield AI · Which study data sets the scope

*15 November 2026. A short decision record: which level of trial data decides the countries SupplyShield monitors.*

## The question

Clinical trial data exists at several levels: the development **programme** (one product, many studies), the **protocol** (the document and its amendments), the **study** (the trial being run under that protocol), the **study country** (the study in one country) and the **site**. Which one should decide whether a country is monitored?

## The decision

| Level | Used for the scope? | Why |
|---|---|---|
| Programme | No, grouping only | A programme spans studies that are planned, running and closed. It says nothing about where product is being shipped now. |
| Protocol | No | The protocol is the document: versions and amendments change what is done, not where the trial runs. CTMS systems don't hold an operational status on the protocol. |
| **Study** | **Yes: does the study count?** | The study's status in the CTMS (recruiting, enrolling by invitation, active not recruiting, treatment ongoing, follow-up ongoing) says whether supply is running. The same vocabulary is used for registry recruitment status (ClinicalTrials.gov), which is set per study. |
| **Study country** | **Yes: does the country count?** | Authorisation and start are per country (under the EU Clinical Trials Regulation, per Member State concerned). The country record is active when at least one site there is activated and the company supplies investigational product to it. |
| Site (IRT) | Cross-check only | Site activation in IRT is used to spot a contradictory status. Example: Portugal, where the CTMS says "approved, not started" but IRT shows site PT-01 activated. SupplyShield asks the study manager instead of guessing. |

So a country is monitored automatically when **an active study has an active study-country record there**. This matches `config/supplyshield.yaml` (`active_statuses`, `country_scope_from_active_sites: true`) and the demo CTMS in `demo-data/supply-network.json`, where every study has a study status and a status per country (`ACTIVE`, `NOT_STARTED`, `CLOSED`, `UNKNOWN`).

## What this means on screen

- **Monitoring scope** shows, per country, the active studies with their study status, and counts sites and patients from the active study-country records. The (i) next to "Active studies" explains the two levels.
- Studies that are completed, suspended or not yet recruiting are listed under **Studies not counted**, with the reason.
- A suspended study with product still at a site (Austria, 24 kits) is not monitored automatically but is **suggested**, because the product is still there.
- Patient numbers are aggregate counts per site from the CTMS. SupplyShield uses no patient-level data.

## Checked in the demo data

- 22 studies: 18 count as active, 4 do not (2 completed, 1 suspended, 1 not yet recruiting).
- The study-country records give the 16 countries with an active trial, 5 countries with a registered study but no active trial, and 1 country to confirm (Portugal).
- The Israeli, Greek and Cypriot sites' stock now runs until after their next planned delivery. Before, three sites ran out weeks before their next shipment, which no supply plan would allow. Only Tel Aviv stays tight on purpose: its stock runs out on 27 Nov 2026, one day after the planned delivery, which is what makes the Belgian strike urgent.
