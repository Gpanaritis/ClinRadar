# RegChain AI

**Global Country Regulatory & Clinical Supply Intelligence Agent**  
Master product specification and 36-hour hackathon build brief  
Version 1.1 · 14 November 2026

## Contents

- [1. Product vision](#1-product-vision)
- [2. Functional requirements](#2-functional-requirements)
- [3. Regulatory evidence and time](#3-regulatory-evidence-and-time)
- [4. Approval, audit and operational closure](#4-approval-audit-and-operational-closure)
- [5. Platform independence and integration](#5-platform-independence-and-integration)
- [6. Nonfunctional requirements and evaluation](#6-nonfunctional-requirements-and-evaluation)
- [7. 36-hour hackathon scope](#7-36-hour-hackathon-scope)
- [8. MVP architecture and data model](#8-mvp-architecture-and-data-model)
- [9. MVP API and events](#9-mvp-api-and-events)
- [10. Demo scenarios and acceptance tests](#10-demo-scenarios-and-acceptance-tests)
- [11. Build plan and definition of done](#11-build-plan-and-definition-of-done)
- [12. Source references](#12-source-references)
- [13. Agent instructions](#13-agent-instructions)

## 1. Product vision

RegChain AI helps Global Clinical Supply teams turn a country regulatory change into an evidence-backed decision, a versioned country-intelligence update and a verified operational response. It monitors approved sources, identifies substantive changes, compares them with current country intelligence, evaluates potential effects on the sponsor's operations and prepares actions for authorized review.

Country requirements are distributed across authorities, customs agencies, official gazettes and other sources. Publication and implementation schedules vary. Teams must reconcile new publications with internal requirements, identify affected studies, shipments and partners, and coordinate work before the applicable deadline. Gaps at any step can leave country records stale, delay implementation, create inconsistent interpretations or make the basis for a decision difficult to reconstruct.

**Operating model.** Monitor → detect → classify and interpret → compare → assess impact → obtain SME approval → publish → assign and communicate actions → verify operational adoption.

The Country Intelligence Platform answers what Global Clinical Supply needs to know and do for a defined jurisdiction, product, activity and date. Enterprise coverage includes manufacturing, packaging, labeling, certification and release, import and export, customs, transport, storage, distribution to depots and sites, direct-to-patient distribution where applicable, returns, reconciliation and destruction.

| Information layer | Contents and ownership |
| --- | --- |
| A · Regulatory evidence | What the source states, including its original wording, version, authority, scope and legal status. RegChain preserves the evidence and source history. |
| B · Approved country intelligence | The organization’s approved operational requirements, conditions, exceptions and effective dates. The country platform serves as the system of record. |
| C · Operational impact | Object-level findings and implementation actions across studies, products, shipments, sites, depots, distribution plans and partners. Clinical Supply and Quality own the relevant decisions and action evidence. |

Link each layer through stable IDs. Preserve evidence, draft interpretation, approved requirement and actual implementation as individually attributable records.

**Primary users.** Country and Regulatory Affairs subject-matter experts (SMEs) own regulatory interpretation and approval. Global Clinical Supply, packaging and labeling, import/export, and logistics teams assess and implement operational actions. Quality owns applicable change controls and implementation verification. Platform owners operate the integrations. Depots and logistics providers receive authorized, scoped actions. Auditors can reconstruct the complete decision record.

**Product hypothesis.** The principal value comes from connecting approved country intelligence to specific business objects and reducing the time from publication to operational adoption. Measure the frequency of actionable changes by jurisdiction and topic, the manual work per case, and the time remaining before implementation. Validate the hypothesis in a read-only pilot with multinational sponsors and their outsourced supply operations. Test whether assessment time improves while expert-reviewed detection, applicability and traceability meet the agreed thresholds. Test willingness to pay separately.

**Decision authority.** AI may retrieve, detect, extract, compare, recommend and draft. Authorized people approve material interpretations and changes. Scoped services publish exact approved content and create authorized downstream tasks. Label approval, batch release or Qualified Person (QP) certification, shipment authorization and clinical trial authorization remain with their designated owners and systems.

## 2. Functional requirements

“Must” identifies a product requirement. Sections 7–11 define the prototype implementation and its test gates.

| ID | Capability | Requirement |
| --- | --- | --- |
| FR-01 | Approved source catalogue | Maintain coverage by jurisdiction and topic for national competent and health authorities, customs agencies, official gazettes, regional authorities such as EMA and the European Commission where relevant, and approved intelligence providers. Record authority, source tier, content rights, language, scope, location, retrieval method, schedule, owner and monitoring status. |
| FR-02 | Source retrieval and monitoring | Poll or subscribe according to the source policy. Support official HTML, PDFs, forms, structured feeds and licensed feeds. Capture immutable versions, normalize text while preserving evidence locations, and support manual backfill and scheduled reruns. Surface stale content, access failures, broken redirects, unreadable scans, parser failures and missed intervals. Route gaps to an owner and retain the last evidence with its freshness displayed. |
| FR-03 | Meaningful change detection | Detect newly issued, amended, clarified, corrected, suspended, withdrawn, removed, superseding and replacement requirements. Identify changed effective dates, transition periods, forms and administrative details. Capture the previous and new wording where available and describe the substantive delta. Filter cosmetic churn. Record explicit outcomes for unrelated, uncertain and unchanged items. Deduplicate mirrored publications while preserving each source relationship. |
| FR-04 | Status and relevance | Record jurisdiction, issuing authority, document type, status and affected process. Distinguish binding instruments, final guidance, administrative notices, proposed rules and consultations. Screen for clinical-supply relevance and route drafts or proposals to a watchlist or approved preparation work. Record dispositions and rationale for discarded candidates. |
| FR-05 | Structured extraction | Produce a candidate with country, jurisdiction, authority, requirement category, source and version, publication and applicability dates, transition provisions, previous value, proposed value, rationale, operational impact, urgency and claim-level evidence. Record detection, extraction, applicability and interpretation confidence independently. Capture unknown fields and their reasons. |
| FR-06 | Country intelligence comparison | Read the applicable approved version and any pending or future versions for the same requirement scope. Map to stable record and field identifiers. Show the structured before/after change and the source delta as distinct evidence. Present proposed additions, amendments, supersessions and retirements. Route ambiguous mappings, stale baselines and overlapping changes for review. |
| FR-07 | Company-specific applicability | Match candidates against study-country/site participation, study and authorization status, IMP and batch attributes, packaging and labeling specifications, planned shipments, origin/destination/transit, importer of record, depots, partners, release and distribution plans, and the dates relevant to each process. Return per-object findings with reasoning, rule inputs, object freshness, missing attributes and responsible owner. |
| FR-08 | Triage and proposals | Rank cases by impact severity, time remaining and confidence independently. Prepare an SME proposal with the exact field changes, supporting passages, assumptions, conflicts, dates, affected objects and suggested actions. Route by jurisdiction and category and escalate urgent or unassigned cases. |
| FR-09 | Controlled decision | Support approve, edit and approve, reject, request investigation and defer on an identified proposal revision. Validate authority, evidence and current baseline at the decision boundary. Capture a reason, accountable owner and return date for deferred cases. Preserve recommendations, revisions, decisions and explanations. |
| FR-10 | Versioned publication | Publish the approved revision through a country-platform adapter. Record the previous and new values, source references, effective dates, reviewer and decision timestamp, version/change ID, and verified external receipt. Keep historical values queryable. Surface publication conflicts and failures for reconciliation. |
| FR-11 | Downstream coordination | Group material findings into owner-assigned review or implementation actions with due dates, affected objects, evidence and required completion proof. Deliver them to authorized internal and partner systems, track acknowledgements and deadlines, and escalate failures or overdue work. Refresh impact when material operating data changes. |
| FR-12 | Verification and closure | Track proof of implementation and its verification at action level. Close the change only when publication is reconciled, the affected scope is dispositioned and required actions meet the closure policy. Reopen with an audit record when evidence becomes invalid or the material scope changes. |
| FR-13 | Work queues and reporting | Provide source health and coverage, case and decision queues, impact tables, country history and as-of lookup, open and overdue actions, and exportable evidence and audit histories. Report publication, propagation and closure as distinct milestones. |
| FR-14 | Country requirements library | Provide country, topic and scope navigation with source-linked approved records, effective dates, last review and coverage by topic. Surface current, future and historical versions and label proposals separately. Group open changes by region in the overview, and show a shared regional instrument once with explicit links to the jurisdictions it covers. Keep individual source attempts available in the source log. |
| FR-15 | Scheduled checks and alerts | Let authorized administrators set a repeat interval and source-level overrides. Show next check, last attempt, last successful comparison and coverage gaps. Persist schedules in a deployed worker, support manual runs and source subscriptions, deduplicate work, and retry failed attempts independently. Route alerts by severity, operational urgency and reviewer ownership. |

### 2.1 Requirement and product taxonomy

| Category | Example subcategories |
| --- | --- |
| Regulatory and authorization | Trial approvals, IMP status, site activation dependencies, manufacture, GMP, import and export authorization. |
| Import, export and customs | Licenses, permits, importer/exporter of record, broker, clearance, declarations, valuation, duties, VAT, Incoterms, invoices, certificates of origin and analysis. |
| Packaging and labeling | Immediate and outer packaging, study identifiers, local language, batch number, expiry, retest, storage information and relabeling. |
| Quality and release | QP certification and declaration, GMP evidence, testing, batch records and release documentation. |
| Depot, distribution and storage | GDP, depot authorization, transport and courier restrictions, direct-to-site and direct-to-patient, temperature bands, data loggers, excursions and storage facilities. |
| Controlled products | Classification, permits, quotas, security, storage controls and chain of custody. |
| Returns and destruction | Return, product accountability, reconciliation, local or central destruction, export for destruction, certificates and waste requirements. |

Product classifications include IMPs, comparators, placebo, marketed and ancillary products, devices, diagnostics, biological samples, biologics, vaccines, cell and gene therapies, controlled substances, radioactive or hazardous materials, temperature-sensitive products and other trial materials. Use product identity and classification together with dosage form, manufacturing and shipment origin, storage conditions, shelf life and other attributes supported by the evidence. Capture country and ISO code where applicable, plus broader or narrower regulatory jurisdiction, territory, authority and role, framework, language and route as independent inputs.

### 2.2 Operational impact and triage

For each case, trace the change from the proposed requirement to the affected process and the eligible operating objects. Use CTMS study phase, status, sites, activation dates and supply strategy. Use product, packaging, label and batch data to establish scope. Use shipment origin, destination, transit, planned departure and arrival, the actual regulatory trigger date, importer/exporter of record, broker, depot, temperature, provider and documentation status. Preserve which attributes were available, where they came from and when they were refreshed. For partner actions, maintain the partner and role, scope, owner, required-by date, notification and acknowledgement timestamps, implementation reference and status.

**Severity.** Critical means a plausible inability to supply lawfully or a significant trial continuity risk. High means a plausible shipment, customs, labeling, release or compliance failure. Medium means a process or documentation adjustment. Low means limited operational impact. Record the rationale and escalate plausible critical risks immediately for expert assessment, even when key inputs are still missing.

**Operational urgency.** Identify the event named by the source, such as customs entry, QP certification or labeling. Compare that event with the applicable date and transition predicates. Separately calculate the review or preparation deadline using the earliest potentially affected event, implementation lead times and internal milestones. A dispatch before the effective date can warrant review if customs entry occurs on or after it. A shipment whose triggering event falls before the effective date can still require preparation for later shipments. Record the trigger, dates, assumptions and missing inputs with the urgency rating.

**Confidence.** Record detection, extraction, applicability and interpretation separately, each with a reason or evidence gap. Use an evidence-backed rubric such as high, medium, low or unknown. Publish numerical confidence only for measures calibrated against labeled cases, with the calibration method and version. Confidence cannot substitute for an SME decision.

**Notification policy.** Route critical risks immediately, high-impact or near-term cases as priority, medium impact to the standard review queue, and low-impact items to a digest. Notify once per material revision and recipient scope, with separate escalation for failed delivery or overdue work. Include what changed, jurisdiction, effective date or unknown status, why it matters, potential scope, accountable owner, due date and evidence.

## 3. Regulatory evidence and time

### 3.1 Authority and provenance

- Store the issuing authority, jurisdiction and authority tier separately from document type and lifecycle status. An official consultation may be authoritative evidence that a proposal exists. Activation of an obligation requires approved evidence of legal effect and scope. A licensed feed or secondary source can trigger investigation and point to primary material.
- Preserve raw bytes or a permitted immutable archive reference with content hash or equivalent stable source version. Record canonical URL, title, version, retrieval UTC time, publication metadata, language and extraction version. For each material claim, store a page, section, article or paragraph locator and the exact supporting span. A translated span links to the original and records its translation method and review status.
- Maintain claim types for source fact, interpretation and company impact. A material interpretation must refer to the evidence claims it relies on. An impact finding must also cite the relevant business object, source system, input fields, data version and match logic. Keep selected citations resolvable from the approved version even if the source URL changes.
- Detect amendments, replacements, overlaps, withdrawals and potential conflicts among national, subnational, supranational and internal rules. Preserve the conflicting texts, applicable scopes and temporal windows. Route the issue to an authorized SME for a documented resolution, with Quality or Legal input where policy requires it. Publication recency alone confers no precedence.
- Missing, stale, ambiguous or contradictory evidence produces a named investigation outcome. Retrieval, extraction or citation validation failure blocks unsupported material fields from approval. A later correction enters a new reviewed revision and preserves the original evidence and decision.

| Tier | Source | Use in a proposal |
| --- | --- | --- |
| 1 | Official legal instruments and authoritative official publications of their text or formal legal status | Ground claims about legal text, commencement and scope. Record actual legal force separately. |
| 2 | Official guidance, FAQs, notices or formal clarifications | Ground claims about the authority’s guidance or practice. Link the governing instrument when claiming a binding obligation. |
| 3 | Approved regulatory intelligence provider | Surface and corroborate findings. Follow references to the authoritative material that supports the claim. |
| 4 | Approved internal SME interpretation | Establish the organization's prior decision and approved operating baseline. Retain links to its external evidence. |
| 5 | Secondary or unverified material | Use as an investigation lead. Approval requires qualifying evidence for each material claim. |

Source tier describes provenance. Legal force, validity, scope and status depend on the issuing authority, document and jurisdiction. An official gazette can publish both binding measures and consultation notices. For each document record the source ID, canonical URL, issuing body, language and translations, official reference and version, retrieval and review times, known predecessor and record of monitoring health.

### 3.2 Applicability over time

| Dimension | Required behavior |
| --- | --- |
| Regulatory time | Represent announcement, publication, enactment where relevant, effective/applicability start and end, suspension, transition, grace period, compliance deadline, expiry, supersession and withdrawal. Attach evidence to each material date. |
| Company record time | Track detected, assessed, submitted, decided, approved, published, last reviewed and next review times independently. Use immutable changes to reconstruct what the organization knew and relied on at a chosen time. |
| Operational date basis | Evaluate applicability against the date named by the requirement, such as planned import, QP batch certification, packaging or authorization submission. Record date precision, jurisdictional time basis and endpoint inclusivity. Route unresolved boundaries for expert review. |
| Historical and future versions | Publish future-dated versions with future status and preserve their predecessors for earlier dates and applicable transition cohorts. Allow multiple scoped rules to coexist when warranted. Retain prior recorded knowledge when making retroactive corrections. |
| Exceptions and uncertainty | Model eligibility predicates, dates, exception or variation references, and required proof as explicit inputs. Unknown values stay unknown. Effective dates must never default to the publication, retrieval or approval date. |

**As-of lookup.** Accept jurisdiction, topic and process, an operational context and date, and an optional `known_at` timestamp. Filter to versions that were approved and published by that timestamp, then evaluate their applicability windows and predicates against the operational date and context. Return the applicable version or versions, with evidence and any unresolved conditions. Surface gaps or conflicts explicitly. For a general requirement published in November with a March effective date, the ordinary December and April cohorts can resolve to different versions. Transition predicates can further change the result for a specific operation.

**Applicability outcomes.** Use **confirmed applicable**, **potentially applicable**, **confirmed non-applicable** and **insufficient information**. An SME confirms material decisions. Preserve **not assessed** as an assessment workflow state, including when a portfolio feed is missing or incomplete. A “no impact after assessment” disposition must identify the assessed scope, supply-data snapshot, evidence and deciding reviewer.

**Structured scope.** Represent obligation type (mandatory or optional), trigger predicates, exclusions, exemptions, dependencies and prerequisites as distinct fields. Store expressions with explicit AND/OR grouping and states allowing unknown values. Evaluate whether predicates are met in the applicable jurisdiction and time window before assigning an outcome. Product identity, route, purpose and jurisdiction may all be required. Retain the predicates and evidence in the country record.

**Independent statuses.** A document may be published while its requirement is future-effective. A requirement may be effective while the company proposal is still in review. Track document status, requirement lifecycle, proposal state, and downstream adoption separately. Where authorities appear to conflict, present passages, dates, jurisdiction, legal status, potential interpretations and operational consequences for an authorized resolution.

## 4. Approval, audit and operational closure

### Regulatory change proposal

| Section | Required content |
| --- | --- |
| Identification | Change ID, country/jurisdiction, requirement key, category and subcategory, proposal revision and baseline version. |
| Comparison | Current approved value, authoritative source wording before/after when available, substantive difference, change classification and proposed value. |
| Evidence | Authority, source tier and legal status, document reference/version, locator, exact passage, publication, effective date or unknown, retrieval time and supporting evidence IDs. |
| Interpretation | Draft operational interpretation, rationale, trigger conditions, dependencies, exclusions, exceptions and open questions or conflicts for an SME. |
| Impact | Severity and rationale, operational urgency and deadline basis, affected processes, scoped object candidates with verified applicability or explicit uncertainty, and an assessment snapshot ID. |
| Confidence | Detection, extraction, applicability and interpretation with separate reasons. |
| Routing | Recommended reviewer and action, review deadline, target implementation date and decision history. |

For example, in a fictional import-documentation change with potential electronic acceptance, capture which documents and routes qualify before proposing operational wording. A known publication date and a later effective date remain separate. Three studies, five shipments and one provider can be queued for assessment, each with its own scope and unresolved inputs. The Import/Export SME receives the exact proposal revision and the date by which review is needed.

### 4.1 State transitions and authority

| Lane | States and gates |
| --- | --- |
| Detection and assessment | `detected → triaged → assessed`. A case can move to `monitor_only`, `no_relevant_change` or `needs_investigation` with a reason and follow-up owner where appropriate. |
| Proposal and decision | `draft → in_review → approved / rejected / needs_investigation / deferred`. Investigation can return a new revision to review. Edit and approve creates and validates a new revision, then approves that exact revision. Deferral stores an owner, reason and return date and automatically returns the case to the queue. Critical escalation continues during deferral. |
| Publication | `pending → published` after verified persistence in the system of record. Failed or conflicting writes remain visible as `failed` or `conflict` and are reconciled. A materially stale baseline, invalidated approval or changed approved content requires review of a new revision. |
| Assignment and delivery | Create a required action with an owner and due date. Track delivery as `pending / sent / delivery_failed`, and named-owner acknowledgement separately. Retry failed delivery and escalate missed acknowledgement deadlines. |
| Implementation | Record `assigned → acknowledged → implemented → verified`. An owner supplies proof. An authorized verifier accepts the proof or returns the action for remediation. An approved alternate disposition records the scope, reason, approver, expiry where relevant and any follow-up. |
| Case closure | `open → closed → reopened`. A case that requires publication closes after the country platform receipt is reconciled, impact coverage is reviewed and required actions are verified or formally dispositioned. A rejected, withdrawn or investigation-only proposal receives a reasoned disposition and retains any separately assigned follow-up. |

The review screen must show the exact payload to be approved, the baseline version, applicable date and scope, evidence passages, open uncertainties, conflicts and the current impact snapshot. Check jurisdiction and role authorization server-side. Require a rationale for edits, rejection, investigation, override and exceptional disposition. Support policy-based secondary approval for critical cases or changes that need independent Quality review. A change to approved content or its material evidence invalidates that approval and starts a new revision. A baseline conflict triggers rebase and fresh review.

The publish service receives a decision ID, approved revision/hash and expected target version. It rechecks these before any mutation and uses an idempotency key tied to the approval and target. An unknown write outcome is resolved by querying the target with the same key or correlation reference before retry. If the external platform cannot safely support that contract, require a controlled import or manual reconciliation with a receipt.

### 4.2 Audit and verification

- Keep an append-only trail for ingest, normalization, matching, AI recommendation, reviewer edits, decisions, publishing attempts and receipts, delivery, acknowledgement, implementation evidence, verification and closure. Record actor or service identity, timestamp, operation, subject and revision IDs, old/new references or hashes, rationale and correlation ID. Record model, prompt, schema, rule and input snapshot versions for AI-assisted work.
- Provide a case export that reconstructs the original evidence, before/after requirements, all proposal revisions, approval, publication receipt and downstream dispositions. Retain records under configured policy, access rules and legal holds. Make corrections through new events and versions.
- For each required action, the implementation record must identify the exact affected scope, owner, completion date and evidence artifact. Examples include an approved SOP revision, a QMS change-control approval, a reconciled configuration change, or a partner implementation attestation with an artifact reference.
- Close as **verified implementation** only if every required action is verified. Track **no action required** where an SME documents that all assessed scope needs no action. If policy permits closure with an authorized exception, label it **closed with exception** and retain the risk owner, reason and follow-up obligation. Pending scope, failed publication or unverified required work keeps the case open.
- Re-evaluate if a new study, changed shipment date, revised requirement, invalidated receipt or rejected evidence affects a closed case. Reopen with the new cause and preserve the prior closure record.

## 5. Platform independence and integration

### 5.1 Component boundaries

| Component | Responsibility | Interface |
| --- | --- | --- |
| Regulatory Source Layer | Retrieve approved content, maintain source health and archive document versions. | `SourceAdapter` produces normalized version metadata, artifacts and retrieval outcomes. |
| Regulatory Intelligence Engine | Detect changes, classify documents, extract and validate evidence-backed claims and map changes to country requirements. | Canonical change, evidence and draft requirement schemas. |
| Clinical Supply Impact Engine | Match structured scopes, dates, exceptions and company objects. Combine deterministic criteria with evidence-grounded explanations. | `PortfolioReader` returns typed snapshots and object references. Assessment returns scoped findings. |
| Review and Integration Layer | Manage reviews, approved publication, downstream assignment, verification and audit. | `CountryIntelligencePort` reads versions, conditionally publishes and looks up receipts. `ActionPort` assigns and reconciles actions and accepts authenticated status evidence. |

Use stable canonical IDs and versioned mappings for each external record and field. Keep partner-specific mappings, credentials, transport and error translation inside adapters. The configured country platform owns published country requirements. RegChain owns evidence, proposals, reviews and orchestration state, with reconciled references to the published record. CTMS, supply, labeling and Quality systems own their respective operating records. Replacing the country platform requires a new adapter, historical crosswalk and reconciliation, with the same decision, evidence and impact contracts.

### 5.2 Integration priority

| Stage | Systems and minimum flow |
| --- | --- |
| Pilot foundation | Snapshot official sources or an authorized licensed feed and read the versioned country baseline and study-country/IMP portfolio. Connect reviewer identity and routing, plus assignment and notification status. Start with CSV or approved read APIs where feasible. |
| Operational pilot | Read study, site and status from CTMS. Read batches, QP dates, routes, shipments, depots, importers and partners from clinical supply ERP and logistics systems. Read specifications and linked batches from labeling management. Use QMS for controlled review tasks and evidence receipts. Validate the country-platform write path before production use. |
| Enterprise expansion | Add rollout-driven integrations for document management, IRT/RTSM, partner portals, additional country sources and licensed providers. Use enterprise identity and scoped partner access for deployments involving company data. |

**Integration contract.** Version APIs and schemas. Every event carries a stable event ID, schema version, UTC timestamp, producer, tenant, aggregate ID and version, correlation and causation IDs, authority evidence references when applicable, and the minimum consumer payload. The event catalogue in Section 9 names the lifecycle events. Publish persisted events through a transactional outbox. Consumers deduplicate by event ID and apply within-aggregate versions in order or retrieve current state on a gap. Expect at-least-once delivery. Support retries with backoff, a failed-delivery queue, operator replay with the same identifiers and receipt reconciliation. Authority documents and model output are untrusted inputs to this boundary. Only explicit, typed, scoped service operations can write to an integration.

**Portfolio synchronization.** Preserve external object IDs, source system, observation time and import version. Validate reference joins and quarantine ambiguous or invalid rows. Record coverage by jurisdiction, object type and time horizon. Use freshness and coverage in the case assessment so a partial import cannot support a portfolio-wide no-impact disposition. Reconcile accepted downstream deliveries and status updates against the approved version and exact action scope.

**Scheduled monitoring.** Store a workspace default interval, source overrides, run history and coverage status in the deployed scheduler. Give priority sources tighter cadence and use supported subscriptions where available. Derive the due time from the configured calendar, apply a retry policy independently of routine cadence, and distinguish fetch failures from a successful check with no change. Prevent overlapping processing of the same source version and preserve pending material changes across checks. Only a scoped administrator can modify live schedules. The current dashboard uses a locally saved replay schedule.

## 6. Nonfunctional requirements and evaluation

| ID | Requirement | Verification |
| --- | --- | --- |
| NF-01 | Access and segregation | Enforce tenant, country and role scopes, least privilege, named human identities and distinct publisher credentials. Validate tenant isolation, approval role checks, credential rotation and audit access. |
| NF-02 | Confidentiality and minimization | Encrypt transport and storage. Use necessary operational metadata and stable references. Exclude patient data, unblinded assignments and confidential formulations from normal ingestion. Enforce approved model processing, retention, residency and licensed-content entitlements with redaction where needed. |
| NF-03 | Evidence fidelity and input isolation | Validate structured model output, evidence spans and tool arguments before use. Treat retrieved instructions as document content. Test tampered hashes, OCR and translation errors, fabricated citations and attempted bypass of the human approval boundary. |
| NF-04 | Integrity and recoverability | Enforce version preconditions, unique operation keys and consistent history. Verify concurrent approval, duplicate dispatch, crash recovery, restore and reconciliation across partially completed operations. |
| NF-05 | Availability and observability | Track fetch and parse health, backlog age, stale inputs, approval queues, latency and integration failures with correlation IDs. Escalate according to source and case risk. Set and test service SLOs, continuity procedures, RPO and RTO with platform owners before pilot launch. |
| NF-06 | Performance and scale | Process documents asynchronously in production and make long-running work observable. Run representative workload tests at agreed country, source and portfolio volumes. Define ingest freshness and review latency targets by source criticality. |
| NF-07 | Usability and accessibility | Make evidence, comparisons, dates, missing inputs and required actions visible at decision time. Support keyboard navigation and accessible status labels. Test with Regulatory Affairs and Clinical Supply users on the highest-risk tasks. |
| NF-08 | Change and validation control | Version prompts, models, rules, mappings and schemas. Capture intended use, risk assessment, validation evidence and release acceptance with Quality before regulated deployment. Run reference cases on changes and retain reproducible inputs and output records. |

**Measurement.** Report median and p90 elapsed times from authority publication to detection, detection to assessment, proposal ready to approval decision, approval to confirmed platform publication, platform publication to all required recipients informed, and authority publication to operational closure. Count receipt of a notification separately from acknowledgement and implementation. Report missing or date-only publication timestamps and cases still open. Track the fraction of assessed cases requiring minimal manual preparation according to an agreed rubric, false positives among adjudicated detections, missed relevant changes on an expert reference set, and the fraction of approved requirements with resolvable evidence, dated applicability and a complete approval history. Also track overdue actions and the share of required actions with verified implementation.

Set freshness and detection targets by monitored source and risk. Illustrative starting targets are 24 hours for critical sources and two business days for high-priority sources using a defined working calendar. Standard sources follow the agreed interval. A check cadence and a publication-to-detection target are separate measurements. Track attainment, source outages, verified false negatives, extraction and classification accuracy, applicability accuracy, SME rejection and edit rates, and the proportion of material cases reviewed by the effective date where it is known. Measure detection-to-closure alongside overall elapsed time.

**Evaluation.** Use an SME-reviewed corpus stratified by jurisdiction, subject, authority type, status and urgency, with real historical changes and unchanged or cosmetic controls. Include conflicting authorities, ambiguous status, missing evidence, wrong country or study matches, future or superseded dates and exceptions. Score change precision and recall, evidence support, field accuracy, applicability by outcome, and correct abstention. Exercise duplicate writes, unauthorized actions and incomplete propagation separately. Benchmark analyst time and adoption against the existing workflow. Agree numeric pilot targets with the owners. Treat unsupported material obligations, unauthorized writes, lost audit history and false verified closure as release-blocking defects.

## 7. 36-hour hackathon scope

**Build one vertical slice.** Replay one UK IMP labeling transition with pinned official evidence and a fictional sponsor portfolio. Show a meaningful source delta, an evidence-backed proposal against a seeded country-intelligence record, deterministic batch triage, a simulated SME decision, a versioned publication and one mock QMS task with a Clinical Supply impact report.

| In scope | Beyond 36 hours |
| --- | --- |
| One document family, two official point-in-time versions and supplementary pinned statutory and guidance passages | Continuous live monitoring, worldwide coverage, arbitrary document ingestion, multilingual and OCR pipelines |
| One jurisdiction (`GB`, displayed as UK), one topic (`IMP_LABELING`), one requirement key, and one bounded UK transition rule | General legal interpretation, full label-text review, other product/process categories and automated exception decisions |
| Local fictional studies, product categories, QP observations and label specifications | Enterprise connectors, SSO, real supplier communications and production validation |
| Approve or reject as a simulated SME, land one versioned write in SQLite, create one mock task and record simulated acknowledgement | Enterprise edit-and-approve and investigation routing, approval delegation, real implementation evidence or verified real-world closure |

### 7.1 Official regulatory case and fixtures

The 2025 UK amendment replaced Part 7 of the 2004 Clinical Trials Regulations, with the amended provisions taking effect on 28 April 2026. Schedule 14 paragraph 6 preserves the old labeling rules for qualifying IMPs manufactured before the relevant day and used in old-rules clinical trials, subject to the old labeling rules and use in the intended trial. MHRA's labeling-transition guidance identifies the date of QP batch certification of the finished IMP as the manufacturing date for this purpose. Treat the statutory scope and the MHRA explanation as distinct claim types. Record the trial cohort, intended-use match and evidence of old-rules labeling in the assessment. Refer unresolved variations, scope conflicts and boundary cases for expert review. [2025 amendment, regulation 1, regulation 32 and Schedule 14 as inserted](https://www.legislation.gov.uk/uksi/2025/538/pdfs/uksi_20250538_en.pdf) · [MHRA IMP labeling transition](https://www.gov.uk/guidance/clinical-trials-for-medicines-clinical-trials-regulations-transitional-arrangements#transitional-arrangements-for-labelling-of-investigational-medicinal-products)

| Fixture | Content and locator |
| --- | --- |
| `uk-part7-before` | Capture the earlier official consolidated Part 7, regulation 46, from the linked point-in-time edition. Confirm the selected text against the available version history when preparing the fixture. Save the edition date and source URL. |
| `uk-part7-after` | Capture the official consolidated Part 7 as at 28 April 2026, with regulation 46 as the primary comparison section. |
| `uk-amendment` | Pin the 2025 instrument's commencement provision, substitution of Part 7 and insertion of Schedule 14, with paragraph 6 and its old-rules trial definition. |
| `mhra-labeling-transition` | Pin the MHRA section for IMP labeling transitional arrangements, including the QP date interpretation. Store the guidance version or page update date separately from the statutory effective date. |
| Controls | Derive a cosmetic-only wrapper change from an official fixture. Seed clearly labeled synthetic inputs for a consultation, an EU-only scope, a future date check and an invalid evidence span. |

For each fixture store raw/normalized artifact references, hashes, authority, retrieved timestamp, edition metadata and an anchor map. Store the relevant section text used by the comparison and evidence viewer. Mark a synthetic variant with its parent ID and mutation. Replay the source delta as a historical case and display actual fixture retrieval timestamps. Avoid using replay timestamps to measure historical detection latency.

### 7.2 Inference and assessment rules

1. Normalize the selected document sections, preserving clause labels, punctuation, dates, headings and list/table contents. Compare section hashes and display a readable diff. A cosmetic-only fixture generates no material change or review proposal.
2. Send changed sections and pinned supporting passages to an LLM through a typed extraction call. Require structured status, scope, date and transition claims with evidence span IDs, proposed wording and uncertainties. Validate dates syntactically, verify that each span resolves against the stored text and compare critical facts with the versioned fixture rule. Block draft approval if a required claim is missing, contradictory or unsupported. Treat generated explanations as draft interpretations.
3. Map the validated change to `GB/IMP_LABELING` and show the seeded internal version beside the proposed new text. Keep the predecessor queryable. Store any continued applicability as a scoped transition predicate.
4. Use deterministic rules for matching. Check the study and batch jurisdiction, product category, labeling activity, cohort and the finished-IMP QP batch certification date. Use the QP date in preference to a physical manufacture, packaging, import or planned shipment date for this specific match. Preserve both the chosen input and the reason when other dates are shown.
5. For a QP date before 28 April and evidence of old-rules cohort, intended-trial use and old-rule labeling, return **Potential transition eligibility**. For a pre-cutoff batch outside the supported old-rules cohort or with an unconfirmed transition condition, return **Needs review** and state which condition is absent or unconfirmed. For a QP date of 28 April itself, route to **Needs review** in this prototype and expose the cutoff wording for adjudication.
6. For a clearly post-cutoff QP date, a legacy label triggers **Labeling review required** and a newer specification triggers **Verify specification and approvals**. Participation outside the assessed jurisdiction with no UK linkage yields **Out of scope**. Unknown jurisdiction, QP date, label version or relevant exception data yields **Needs review**. Known special categories and variations are routed for expert review. No outcome is used to release, ship or approve a batch.

### 7.3 User interface

1. **Regulatory Monitor.** One replay action, detection status, source versions and hashes, diff, evidence links and publication versus effective dates.
2. **Company Impact.** Filterable study/batch table with result, QP date used, label reference, match reason, missing inputs and evidence. Export the impact report as JSON with the pinned assessment and proposal IDs, reviewed scope, per-batch reasons, uncertainty and evidence references.
3. **Review & Integration.** Show the proposed country update and baseline version, decision controls, review rationale, version history, mock task, exportable event record and activity timeline. Make the mock task's acknowledgement and the open state visible together.

## 8. MVP architecture and data model

**Implementation choice.** Use one local Python process with FastAPI, Pydantic, SQLite and a simple server-rendered or static HTML interface served by the same process. Use Beautiful Soup against the stored HTML fixture sections. Implement one versioned `uk_imp_labeling` rule in Python. Serve from localhost with fixed fictional reviewer, action owner and viewer personas and check their permissions server-side. Use one configured LLM call for structured extraction and a clearly labeled, previously captured and schema-validated result for offline rehearsal. Retrieval and matching use stored evidence and fictional portfolio data.

```text
Pinned evidence → normalize/diff → LLM extraction → evidence/schema gate
                                                           ↓
SQLite country baseline + fictional portfolio → deterministic assessment
                                                           ↓
                                    Review queue → simulated SME decision
                                                           ↓
                                  SQLite country adapter → durable receipt
                                                           ↓
                                  Outbox → mock QMS task + impact JSON
```

Run one synchronous replay on the small fixture set. Use an explicit SQLite transaction with foreign keys enabled for the approval-related records, local publication, audit entries and outbox writes. Store decision and publication separately for audit even when they commit together. The mock QMS handler consumes the action event in a second transaction and records acknowledgement through a named operator action. The country adapter and task sink use the same contracts as the product, with SQLite implementations. The model receives only fixture sections and candidate evidence IDs. It has no write credentials.

| Entity | Key fields and invariants |
| --- | --- |
| `source`, `source_version` | Source key, authority, jurisdiction, tier, URL and status. Version ID, publisher edition date, retrieval time, document status, raw SHA-256, normalized hash, artifact path. Enforce uniqueness on source/raw hash and preserve immutable evidence bytes. |
| `evidence_span` | ID, source version ID, locator, exact text, offsets into the pinned extraction and span hash. Evidence IDs referenced by claim, decision and published version. |
| `change_case` | ID, old/new version IDs, meaningful-section fingerprint, classification, detected time, case state and correlation ID. Unique change fingerprint within the source and topic. |
| `requirement`, `requirement_version` | Stable key `GB/IMP_LABELING`, version ID and number, prior-version ID, approved body, applicability start and scope, transition predicate, evidence IDs, publication time, approval ID and receipt. Enforce uniqueness on requirement/version number and publication per approval. Retain the predecessor and its evidence. |
| `study`, `batch`, `label_spec` | Study and country linkage, status, trial cohort, product category and labeling activity. Batch linkage to study and destination, finished-IMP QP certification date, illustrative physical manufacture date, intended-trial match, old-rules evidence flag and exception status. Label specification ID, version family and approval metadata. Each replay references a portfolio seed version. |
| `impact_finding` | Case and assessment ID, assessed object IDs, structured result, evidence IDs, matched and missing input fields, rationale, rule and portfolio snapshot versions. |
| `proposal`, `decision` | Proposal ID and revision, case ID, base requirement version, evidence IDs, candidate fields, payload hash and assessment ID. Decision ID, exact proposal revision, actor, rationale, outcome, UTC time, command key and request hash. One terminal decision per revision. |
| `action` | Action ID, case, decision and requirement version refs, owner, scoped batch IDs, due date, mock external receipt, delivery and acknowledgement timestamps. One mock QMS action for the approved demo case. |
| `audit_entry`, `outbox_event` | Stable ID, subject, actor/producer, timestamps, type, correlation and causation, sequence and payload. Outbox stores dispatch outcome, attempt count and last error. Audit rows append only. |

**Write safety.** Recheck the expected revision and baseline in the transaction. Bind the decision to the proposal hash and record the idempotency key and request hash. An exact retry returns the prior result. A different request under the same key or a stale baseline returns a conflict. The QMS mock deduplicates by action ID and event ID. If a dispatch fails after publication, retain the publication and show outstanding delivery until the event succeeds. If evidence or portfolio revisions change materially before review, prepare a new assessment and proposal revision.

**Minimum typed extraction contract.** Require `document_status`, `jurisdiction`, `topic`, `candidate_text`, `effective_date`, `date_basis`, `transition_conditions`, `claims` and `uncertainties`. Each claim has a stable ID, type (`source_fact` or `interpretation`), field, value and one or more pinned evidence IDs. The transition conditions in the fixture cover the old-rules trial cohort, pre-cutoff finished-IMP QP certification, old-rules labeling and use in the intended trial. Validate the jurisdiction, date basis and date against the reviewed fixture. The rule implementation takes the validated fields and typed portfolio observations. Free-text model output cannot alter executable matching logic.

## 9. MVP API and events

These routes define the local application contract. Human identity comes from the server-side demo session. The UI uses the same review and publication guards as other callers.

| Method and path | Request and contract |
| --- | --- |
| `POST /v1/replays` | `fixture_set`, `portfolio_seed`, `analysis_date`, `extraction_mode` (`live` or `recorded`). Return run ID, case IDs and comparison status. Identical material inputs reuse the detected case. A parse or extraction failure is explicit and yields no approvable proposal. |
| `GET /v1/cases/{id}` | Return source diff and citations, time/status, before/after, assessment, proposal revision, downstream status and audit references. |
| `GET /v1/evidence/{id}` | Return the verified excerpt, locator, source version, hash and canonical source link. |
| `GET /v1/cases/{id}/impact` | Return exportable, versioned Clinical Supply impact JSON. |
| `POST /v1/proposals/{id}/decisions` | Require `Idempotency-Key` and body with `revision`, `proposal_hash`, `expected_base_version_id`, `outcome` (`approve` or `reject`) and `rationale`. Approval triggers the guarded local publish. Return decision ID, publication receipt if any, and downstream delivery status. A stale revision, baseline mismatch or changed request on a used key returns `409`. A viewer receives `403`. Invalid evidence yields `422`. |
| `GET /v1/requirements/{id}/versions` | List the full published history. Optional `applicable_on` and `known_at` parameters support the ordinary date lookup. If transition predicates matter, display them and any required operational context alongside the candidate versions. |
| `GET /v1/cases/{id}/events` | Return ordered durable event envelopes and dispatch status for audit or demo export. |
| `POST /v1/actions/{id}/acknowledgements` | Record the mock owner acknowledgement under a matching actor scope and idempotency key. Return the action status and open case state. |

**Lifecycle event catalogue.** The core demo persists `regulatory_change.detected`, `impact_assessment.prepared` and `expert_review.requested` before decision. On approval it persists `requirement_version.approved`, `country_intelligence.updated` and `downstream_action.required`, followed by `downstream_action.acknowledged` when the owner responds. A rejection produces `proposal.rejected`. The enterprise contract adds `downstream_action.implemented`, `implementation_evidence.verified`, `change.closed` and `change.reopened`. A material event carries the relevant claim or evidence IDs. Operational events carry decision, object and action IDs through the same correlation.

```json
{
  "event_id": "evt_demo_006",
  "type": "downstream_action.required",
  "schema_version": 1,
  "occurred_at": "2026-11-14T10:00:00Z",
  "producer": "regchain",
  "tenant_id": "demo",
  "aggregate_type": "change_case",
  "aggregate_id": "case_uk_labelling",
  "aggregate_version": 6,
  "correlation_id": "case_uk_labelling",
  "causation_id": "evt_demo_005",
  "source_refs": ["uk-amendment", "mhra-labeling-transition"],
  "evidence_ids": ["ev_schedule14_6", "ev_mhra_qp_date"],
  "data": {
    "action_id": "act_uk_001",
    "decision_id": "dec_uk_001",
    "requirement_version_id": "req_gb_imp_labeling_v2",
    "target": "mock_qms",
    "action_type": "review_labeling_impact",
    "owner_role": "quality_labeling",
    "due_at": "2026-11-18T17:00:00Z",
    "batch_ids": ["A-101", "B-102", "C-103", "D-104", "F-106"]
  }
}
```

In the mock, the QMS adapter consumes the action event from the local outbox and persists its receipt. Drain pending actions after approval and on startup, with a local operator retry command for failed dispatches. Acknowledgement adds an event and timeline entry. It leaves the action awaiting implementation and the case open. Event schema tests check payload shape, sequence, causal links and downstream deduplication.

**MVP date query.** Default `known_at` to server time. For the ordinary cohort, select the version with the latest applicable start on or before `applicable_on` among the published versions visible at `known_at`. Return any transition predicates and their predecessor references in the response. The separate batch assessment evaluates the UK predicate with its full operational context.

## 10. Demo scenarios and acceptance tests

### 10.1 Fictional portfolio and expected outputs

Replay the change on a fixed scenario date of 14 November 2026. The older internal requirement is a seeded reference to the prior UK Part 7. The draft replacement records the amended Part 7 applicability date and a conditional Schedule 14 transition with evidence. Approving the replacement publishes a country-intelligence record. Each batch retains a separate assessment outcome.

| Batch and study | Fictional inputs | Expected triage |
| --- | --- | --- |
| A-101 · STUDY-001 · UK | QP 20 April 2026, legacy label, verified old-rules cohort and evidence of legacy labeling and intended-trial use | **Potential transition eligibility**. Review the Schedule 14 conditions and their supporting records. |
| B-102 · STUDY-003 · UK | Physical manufacture 20 April, finished-IMP QP 5 May 2026, legacy label | **Labeling review required**. The 5 May QP date drives the branch. |
| C-103 · STUDY-003 · UK | QP 5 May 2026, updated label specification ID | **Verify specification and approvals**. A newer specification is a lead for verification. |
| D-104 · STUDY-001 · UK | QP date missing, legacy label | **Needs review**. Report the missing finished-IMP certification date. |
| E-105 · STUDY-002 · Germany | Germany-only study and batch with complete jurisdiction data and no UK linkage | **Out of scope** for this UK case. Exclude it from the mock task. |
| F-106 · STUDY-003 · UK | QP 28 April 2026 exactly, legacy label | **Needs review**. Show the exact cutoff evidence and the prototype's boundary escalation. |

**Three-minute demonstration**

1. **0:00–0:40** — Replay the official before/after versions. Open the regulation 46 diff, show the effective date, then open the Schedule 14 passage and MHRA QP date interpretation.
2. **0:40–1:30** — Show the two UK studies and the Germany-only exclusion. Compare A-101 with B-102 and C-103. Show the physical-manufacture/QP difference and D-104's missing date.
3. **1:30–2:20** — Review the exact proposal and approve as the fictional SME. Show both country record versions and the timestamped approval and publication events.
4. **2:20–3:00** — Open the mock QMS task and export the impact report and event JSON. Acknowledge the task as its mock owner and show that implementation and case closure are still pending.

Run the negative demonstrations from a fresh seed. Show cosmetic-change and unrelated-jurisdiction controls, a rejected proposal with no publication, and a duplicate approval that returns the original result. Use the temporal and evidence controls in the test suite.

### 10.2 Prototype acceptance tests

| ID | Given and when | Pass condition |
| --- | --- | --- |
| AT-01 | Replay the pinned official before/after pair | One material case is created with a readable regulation 46 diff, verified evidence spans, a structured baseline comparison and a reviewable assessment. Replaying returns the same case. |
| AT-02 | Replay a cosmetic-only wrapper variant | Normalized meaning is unchanged. No material alert, review proposal or action is created. |
| AT-03 | Run an EU-only synthetic scope and assess the Germany-only batch against the UK case | No UK obligation or UK impact is inferred from the EU control. E-105 is out of scope with an explicit jurisdiction reason. |
| AT-04 | Publish a future-dated approved test version and query before and at its stated effective date | The pre-effective query returns the predecessor for the ordinary cohort. The future version is visible in history and appears as applicable at the stated inclusive boundary. A query with `known_at` before publication excludes the later publication. |
| AT-05 | Assess A-101, B-102 and C-103 | Return their three expected outcomes with the QP date and source evidence. A-101's old-rules cohort and intended-use evidence must be present. B-102 uses finished-IMP QP date despite its earlier physical manufacture date. C-103 remains a verification action. |
| AT-06 | Assess D-104 and F-106, then test missing label data, unconfirmed old-rules cohort and an unresolved variation | Return **Needs review** with the relevant missing input, scope issue or boundary condition. No compliance or release verdict appears. |
| AT-07 | Inject an unsupported effective date, fabricated span, wrong document hash or invalid extraction response | The evidence or schema gate rejects the draft, records the reason and prevents approval and downstream writes. Valid approved claims open the exact excerpt and original source locator. |
| AT-08 | Replay a synthetic consultation with a proposed date | Classify it as a consultation or watch item. No binding requirement is activated and no publishing approval is offered. |
| AT-09 | Reject a valid proposal as the demo reviewer. Attempt approval as a viewer | The rejection and authorization result are auditable. The country version count and QMS task count stay unchanged. Viewer attempt returns `403`. |
| AT-10 | Approve the valid proposal as the scoped reviewer | Exactly one approved version and verified local receipt are stored. History retains the preceding version. The impact report and task use the approved revision and share its evidence and correlation ID. |
| AT-11 | Replay the identical approval, send a changed body with the same key, then test a stale baseline | Exact retry returns the original decision and receipt. Changed body or stale baseline returns `409`. Version, task and approval records remain unique. |
| AT-12 | Simulate a failed mock dispatch after durable publication, then retry twice | Published history survives. Delivery failure is visible, retry delivers exactly one task, and the event and receipt remain correlated. |
| AT-13 | Acknowledge the mock task | Owner and time are recorded, replay is idempotent and the case remains open. No implementation-verified or closure event exists. |

**Enterprise acceptance beyond the prototype.** Test independently reviewed conflict resolution, expiry and supersession, missed-source escalation, drift in operational inputs, multi-country scope, approval edits, execution against an external country platform, authenticated partner responses and evidence-based closure. Include a reopening test and a case where every assessed object is dispositioned as requiring no action.

| Enterprise case | Expected result |
| --- | --- |
| A secondary source reports a new obligation without a retrievable primary source | Open an investigation and record the unverified claim. The proposal remains ineligible for publication. |
| Dispatch precedes the effective date and customs entry falls after it | Evaluate against the customs entry date when the instrument uses that trigger. Preserve both dates and calculate the preparation deadline independently. |
| A shared EU item appears in two country profiles | Both profiles reference the same version and case. The overview counts one shared change and shows the record's legal scope. |
| A source times out in a scheduled run | Log the attempt, preserve the previous successful check and flag incomplete coverage. Retry on the retry schedule. |
| An SME defers a proposal | Record reason, owner and return date. Return it to the queue when due, and continue any critical escalation. |

## 11. Build plan and definition of done

| Hours | Work | Exit check |
| --- | --- | --- |
| 0–7 | Pin and hash the official evidence, agree the scenario inputs and expected outcomes, seed SQLite and establish the three user views. Draft fixture and domain schemas. | Both source editions open locally with verifiable locations. The synthetic portfolio and predecessor can be reset and inspected. |
| 7–14 | Implement section normalization, diffing, Pydantic extraction schema and AI call, claim binding and evidence validation. Capture a valid recorded extraction and label its provenance. | The replay reaches a supported draft proposal. Cosmetic and invalid-citation controls pass. |
| 14–21 | Implement the UK assessment rule, ordinary as-of lookups and the impact report. | Portfolio baseline, missing-input tests, cutoff cases and future-date check pass. |
| 21–27 | Implement approval/rejection, versioned publication, audit entries, JSON events and mock QMS receipt and acknowledgement. | Approval, rejection, unauthorized write, retry and stale-baseline scenarios pass through the normal entry points. |
| 27–32 | Complete the three views and JSON exports. Show retry status, evidence, event timeline and mock task on the same case. | A new demo reviewer can traverse the whole workflow from a reset seed. |
| 32–36 | Run all acceptance tests, rehearse the timed demo, test the recorded path and fix any blocking defects. | A fresh replay generates the expected report, timeline and mock task. Acknowledgement leaves the case open. |

If time is compressed, keep the official replay, traceable extraction, batch assessment, guarded approval, durable version and mock task. Use plain tables, simple JSON downloads and a local retry command. Ship a one-command local start and seed/reset procedure alongside the prototype, with an example environment file for the optional live model key. Demonstrate either live or clearly labeled recorded extraction from the same checked fixture inputs. Claim prototype completion when AT-01 through AT-13 pass from a clean seed and the end-to-end run can be repeated under the same case conditions.

## 12. Source references

- Product scope and decisions derive from the original user prompt and follow-up discussion. [Σύγκριση Pfizer Supply Chains](chatgpt-conversation://6af6adab-4f74-83eb-a8f4-555fa30ebb94)
- Historical text for the replay. Inspect Part 7, regulation 46 in both point-in-time editions and confirm the selected predecessor when pinning the fixture. [Earlier consolidated edition, 23 July 2025](https://www.legislation.gov.uk/cy/uksi/2004/1031/body/2025-07-23) · [Consolidated edition at 28 April 2026](https://www.legislation.gov.uk/uksi/2004/1031/body/2026-04-28?view=extent)
- Statutory commencement, Part 7 substitution and transitional scope. See regulation 1, regulation 32 and inserted Schedule 14, paragraphs 1, 2 and 6. [The Medicines for Human Use (Clinical Trials) (Amendment) Regulations 2025, S.I. 2025/538](https://www.legislation.gov.uk/uksi/2025/538/pdfs/uksi_20250538_en.pdf)
- Official MHRA interpretation and guidance. See the IMP labeling transition section for the finished-IMP QP certification date and discussion of modifications. [Clinical Trials Regulations transitional arrangements](https://www.gov.uk/guidance/clinical-trials-for-medicines-clinical-trials-regulations-transitional-arrangements#transitional-arrangements-for-labelling-of-investigational-medicinal-products) · [Clinical trials for medicines: labelling](https://www.gov.uk/guidance/clinical-trials-for-medicines-labelling)

## 13. Agent instructions

You are the Global Country Regulatory & Clinical Supply Intelligence Agent. Your job is to reduce the time from external change to verified operational adoption while preserving evidence, versioned country intelligence and accountable human decisions. Work against the configured source catalogue, country platform, portfolio snapshots and action systems. The scheduler determines when checks run. The approved source catalogue and integration permissions determine what you can access.

1. **Monitor and classify.** Record each check outcome and compare substantive text with the previous reviewed version. Treat formatting churn as no material change. Classify the document, its issuing authority, source tier, jurisdiction, legal status and the type of change. Route drafts and secondary leads to the watchlist or investigation. Mark failed source checks as incomplete coverage.
2. **Extract with evidence.** Cite the exact passage, its locator and source version for each material claim. Preserve original wording, translations, dates, conditions and exceptions. Use explicit unknowns for unsupported dates and missing facts. Flag conflicts and present the competing evidence and potential operational consequences to an SME.
3. **Compare against the approved baseline.** Identify the current record and revision for the relevant jurisdiction, topic, scope and date. Produce a structured before/after comparison and a distinct proposed operational interpretation. Keep the source wording, organizational interpretation and company impact separately attributable.
4. **Assess applicability before impact.** Use the rule’s scope, product category, route, predicates, effective date and operational trigger. Return per-object findings as confirmed applicable, potentially applicable, confirmed non-applicable or insufficient information. Use **not assessed** for missing assessment coverage. Registry-only location matches enter screening as candidates. State the missing inputs and associated owner when a decision needs more information.
5. **Prioritize and propose.** Record severity and urgency independently, with evidence for the date basis and review deadline. Record detection, extraction, applicability and interpretation confidence separately. For a material change, submit the proposal in Section 4. Escalate a plausible critical risk early, including when facts are missing.
6. **Route to an authorized reviewer.** Support approval, edit and approval, rejection, investigation and deferral. Require a reason and return date for deferral. Publish only after the authorized decision service verifies the exact approved revision and the expected country record version. Use the configured publisher, retain predecessor history, and reconcile the receipt.
7. **Track operational follow-up.** Route scoped actions to named owners with evidence, due dates and proof requirements. Track delivery, acknowledgement, implementation and evidence verification independently. Close the case only after its required publication and action gates are satisfied. Record the basis for any alternate disposition.

For a review response, present the change and jurisdiction, authoritative evidence and date basis, current and proposed country values, conditions and exceptions, potential scope, confidence dimensions, next action, reviewer and due date. If evidence is unavailable, report **insufficient authoritative evidence**, identify the missing retrieval or verification, and route the case for investigation.
