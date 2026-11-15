# RegChain AI · Israel scenario: one label that can no longer serve two countries

> **Illustrative scenario.** The rule, the trial, the sites, the batches and the shipments are invented to show how RegChain handles a label that can no longer serve two countries. It is not a real Ministry of Health notice and not legal advice. The data is in `demo-data/israel-scenario.json`.

## The story in one minute

Trial STUDY-021 supplies sites in Israel, Greece and Cyprus from one stock. The kits carry a **booklet label** (LBL-BK-07) in Hebrew, Greek and English, so the depot in Belgium can send the same kits to any of the three countries.

On **12 Nov 2026** a notice says that from **3 Jan 2027** kits imported for Israeli sites must carry an **Israel-only label** with the Ministry of Health trial approval number. A label shared with another country is refused at import, even when it contains Hebrew.

The booklet stays valid for Greece and Cyprus, but it can no longer go to Israel. The pooled stock splits in two:

| Batch | Label | Countries on the label | Kits at the depot | Can serve after 3 Jan 2027 |
|---|---|---|---|---|
| Q-801 | Booklet LBL-BK-07 | Israel, Greece, Cyprus | 40 | Greece and Cyprus (Israel only for kits imported before the date) |
| Q-802 | Booklet LBL-BK-07 | Israel, Greece, Cyprus | 30 | Greece and Cyprus (Israel only for kits imported before the date) |
| Q-815 | Single-country LBL-IL-02 | Israel | 14 | Israel |

Israel needs 22 kits after the date and has 14 Israel-only kits.

## What the shipment checks find

| Shipment | Site | Dispatch · import | Result | Why |
|---|---|---|---|---|
| SHP-IL-01 | Tel Aviv | 23 Nov · 26 Nov 2026 | Ready to ship | Imported before 3 Jan 2027, so the booklet is still accepted |
| SHP-IL-02 | Haifa | 4 Jan · 7 Jan 2027 | Blocked | Booklet imported after the date |
| SHP-IL-03 | Jerusalem | 12 Jan · 15 Jan 2027 | Blocked | Booklet after the date, **and** a Friday delivery (Israeli sites receive Sunday to Thursday), **and** the import approval is still requested, not granted |
| SHP-GR-01 | Athens | 11 Jan · 14 Jan 2027 | Ready to ship | Greece keeps the booklet |
| SHP-CY-01 | Nicosia | 13 Jan · 18 Jan 2027 | Ready to ship | Cyprus keeps the booklet |

Every Israeli shipment is checked for: the label language (Hebrew), the Israel-only label from the rule's date, a Ministry of Health import approval for the shipment, QP release documents, preparation 5 business days before dispatch, dispatch on a depot working day, delivery on an Israeli working day, an approved carrier, and the importer of record.

## What the agents do

The master agent hands each Israeli shipment to the specialists:

- **Supply** finds the Israel-only stock: Q-815, 14 kits.
- **Logistics** checks relabelling the booklet kits with the Israel-only label at the Belgian depot, and for SHP-IL-03 finds a dispatch day that delivers on a Thursday instead of a Friday.
- **Records** checks the Ministry of Health import approval for SHP-IL-03 and who can confirm it.
- **Communications** drafts a short note to the local representative in Hebrew and English.

Three ways out are built and tested by the RegChain verifier: ship the Israel-only stock, relabel the booklet kits for Israel, or dispatch earlier so the kits are imported before 3 Jan 2027.

On the whole portfolio, SHP-IL-02 is more urgent and takes 12 of the 14 Israel-only kits. SHP-IL-03's first choice (the same stock) no longer works, so RegChain re-plans it to relabelling on 15 Dec 2026 with dispatch moved to Monday 11 Jan 2027. Nothing is promised twice.

## The wider rule this stands for

Multi-country booklet labels let one stock serve several countries. Whenever one of those countries changes what it accepts on a label, or whenever two countries cannot share a pack (for example, some destinations in the region do not accept packs that carry Hebrew text or an Israeli approval number), the pool splits and the sites of one country need their own kits. RegChain models this with the countries each label covers, so the checks, the impact and the agents' options follow from the data, not from a one-off rule.

## Where to see it

- **Overview → Israel label** tab: the impact in one paragraph and the three Israeli shipments.
- **Overview → Changes by region → Middle East → Israel**: the change, the evidence, the assessment and the label pool.
- **Shipment checks**: filter Destination to Israel.
- **Agents in action → Run → SHP-IL-03**: the whole team on one shipment, step by step.
- **Country specifications → Israel**: the specification, with Israeli working days and the import approval.
