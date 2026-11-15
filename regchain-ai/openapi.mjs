// OpenAPI 3.1 description of the /v1 API, served at /v1/openapi.json.
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const ok = (description, schema = { type: "object" }) => ({ 200: { description, content: { "application/json": { schema } } } });
const errors = {
  400: { description: "Bad request", content: { "application/json": { schema: ref("Error") } } },
  401: { description: "No role chosen for this session", content: { "application/json": { schema: ref("Error") } } },
  403: { description: "Role not allowed, or a request from another site", content: { "application/json": { schema: ref("Error") } } },
  404: { description: "Not found", content: { "application/json": { schema: ref("Error") } } },
  409: { description: "Stale revision, blocked shipments, or an Idempotency-Key reused for a different request", content: { "application/json": { schema: ref("Error") } } },
  422: { description: "Invalid input, or a rule refuses the step (for example a failed AI check)", content: { "application/json": { schema: ref("Error") } } },
};
const idempotency = { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 }, description: "Retrying with the same key returns the first response. A different request under the same key returns 409." };
const caseId = { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Case key (uk, es) or ID (RC-UK-001)." };

export const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "SupplyShield AI API", version: "1.1.0", description: "External risk and country regulatory intelligence for global clinical supply: the monitoring scope set by the active-trial portfolio, external signals matched to shipments, regulatory change cases, evidence, impact, decisions and audit. Writes check the session's role on the server and accept an Idempotency-Key." },
  servers: [{ url: "/" }],
  paths: {
    "/v1/monitoring-scope": { get: { summary: "The monitoring scope: countries with an operationally active trial (monitored automatically), recommended countries with their evidence and monitoring switches (off until a person turns them on), and registered countries that are not operationally active. Undetermined when no active-trial portfolio is connected.", responses: ok("Scope") } },
    "/v1/signals": { get: { summary: "External signals in monitored countries, matched to shipments, facilities, routes and deadlines, each classified as observed, potential exposure, confirmed disruption or not affected after check",
      parameters: [{ name: "tier", in: "query", required: false, schema: { enum: ["observed", "potential", "confirmed", "clear"] } }], responses: { ...ok("Signals"), 400: errors[400] } } },
    "/v1/signals/{id}": { get: { summary: "One signal with every match and the evidence or missing evidence behind it", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { ...ok("Signal"), 404: errors[404] } } },
    "/v1/shipments/{id}/risk": { get: { summary: "One shipment's route with the day of each leg, its external-risk matches, and the route and import-approval checks", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, example: "SHP-IL-01" }], responses: { ...ok("Shipment risk"), 404: errors[404] } } },
    "/v1/health": { get: { summary: "Service health, schema version and audit-chain check", responses: ok("Healthy") } },
    "/v1/session": {
      get: { summary: "The role held by this session", responses: ok("Session") },
      post: { summary: "Choose the role this session acts as", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["role"], properties: { role: { enum: ["viewer", "reviewer", "owner", "verifier"] } } } } } }, responses: { ...ok("Session"), 422: errors[422] } },
    },
    "/v1/cases": { get: { summary: "Every governed change case", responses: ok("Cases") } },
    "/v1/cases/{id}": { get: { summary: "One case: evidence, proposals, decisions and workflow", parameters: [caseId], responses: { ...ok("Case", ref("Case")), 404: errors[404] } } },
    "/v1/cases/{id}/commands": { post: { summary: "Apply a workflow step as the session's role", parameters: [caseId, idempotency],
      requestBody: { required: true, content: { "application/json": { schema: ref("Command") } } }, responses: { ...ok("New workflow state"), 401: errors[401], 403: errors[403], 409: errors[409], 422: errors[422] } } },
    "/v1/proposals/{id}/decisions": { post: { summary: "Approve or reject an exact proposal revision", parameters: [caseId, { ...idempotency, required: true }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["revision", "outcome", "rationale"], properties: { revision: { type: "integer" }, outcome: { enum: ["approve", "reject"] }, rationale: { type: "string" }, override: { type: "boolean" } } } } } },
      responses: { ...ok("Decision, publication receipt and workflow"), 403: errors[403], 409: errors[409], 422: errors[422] } } },
    "/v1/actions/{id}/acknowledgements": { post: { summary: "The action owner acknowledges a downstream action", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, idempotency], responses: { ...ok("Action status"), 403: errors[403], 404: errors[404] } } },
    "/v1/cases/{id}/reset": { post: { summary: "Start a case again for a rehearsal; the audit trail keeps the earlier run", parameters: [caseId], responses: ok("Initial workflow") } },
    "/v1/cases/{id}/impact": { get: { summary: "Versioned Clinical Supply impact: rule version, portfolio snapshot and per-object findings", parameters: [caseId], responses: { ...ok("Impact"), 404: errors[404] } } },
    "/v1/cases/{id}/events": { get: { summary: "Ordered event envelopes with dispatch status", parameters: [caseId], responses: ok("Events") } },
    "/v1/cases/{id}/audit": { get: { summary: "The case's audit entries and the chain check", parameters: [caseId], responses: ok("Audit") } },
    "/v1/audit/verify": { get: { summary: "Recompute the audit hash chain", responses: ok("Chain status") } },
    "/v1/evidence/{id}": { get: { summary: "A verified excerpt with its locator, offsets, hash and source version", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { ...ok("Evidence"), 404: errors[404] } } },
    "/v1/requirements/{key}/versions": { get: { summary: "Published history of a requirement; applicable_on and known_at select the version in force",
      parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" }, example: "GB/IMP_LABELING" }, { name: "applicable_on", in: "query", schema: { type: "string", format: "date" } }, { name: "known_at", in: "query", schema: { type: "string", format: "date-time" } }], responses: { ...ok("Versions"), 404: errors[404] } } },
    "/v1/specifications/{country}/versions": { get: { summary: "Published Country Specification versions", parameters: [{ name: "country", in: "path", required: true, schema: { type: "string" }, example: "uk" }], responses: ok("Versions") } },
    "/v1/replays": {
      get: { summary: "Recent pipeline runs", responses: ok("Runs") },
      post: { summary: "Run the regulation pipeline on a fixture set", parameters: [idempotency],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { fixture_set: { enum: ["uk-labelling", "es-notice"] }, extraction_mode: { enum: ["live", "recorded"] }, analysis_date: { type: "string", format: "date" } } } } } },
        responses: { ...ok("Run ID, case IDs, comparison status, evidence and extraction"), 422: errors[422] } },
    },
    "/v1/outbox/dispatch": { post: { summary: "Retry delivery of pending or failed events", responses: ok("Pending count") } },
    "/v1/change-decisions": { get: { summary: "Owner decisions on changes without a governed case", responses: ok("Decisions") } },
    "/v1/change-decisions/{id}": { put: { summary: "Record the owner decision on a change (Regulatory SME)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["decision", "reason"], properties: { decision: { enum: ["not-relevant", "case", "assessing"] }, reason: { type: "string" } } } } } }, responses: { ...ok("Decision"), 403: errors[403], 422: errors[422] } } },
    "/v1/shipment-actions": { get: { summary: "Recorded manual shipment actions", responses: ok("Actions") } },
    "/v1/shipment-actions/{id}": {
      put: { summary: "Record hold, swap or proceed for a shipment", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["action", "reason"], properties: { action: { enum: ["hold", "swap", "proceed"] }, reason: { type: "string" } } } } } }, responses: { ...ok("Action"), 401: errors[401], 422: errors[422] } },
      delete: { summary: "Clear a shipment's recorded action", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: ok("Cleared") },
    },
  },
  components: {
    schemas: {
      Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
      Command: { type: "object", required: ["action", "revision"], properties: {
        action: { enum: ["approve", "edit", "reject", "investigate", "defer", "resume", "ack", "implement", "return", "verify"] }, revision: { type: "integer" },
        reason: { type: "string" }, instruction: { type: "string" }, reviewOn: { type: "string", format: "date" }, override: { type: "boolean" }, today: { type: "string", format: "date" } } },
      Case: { type: "object", properties: { id: { type: "string" }, key: { type: "string" }, jurisdiction: { type: "string" }, requirement_key: { type: "string" }, workflow: { type: "object" },
        proposals: { type: "array" }, decisions: { type: "array" }, evidence: { type: "array" }, audit_entries: { type: "integer" } } },
    },
  },
};
