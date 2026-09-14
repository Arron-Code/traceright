# SCTracker User Guide

## Coffee EUDR prototype

Version 0.1 - September 2026

## 1. Purpose

SCTracker helps coffee importers collect, review, and link supplier, plot, quantity, and evidence data to a specific shipment. The prototype demonstrates the path from source lot to a prepared EUDR declaration.

SCTracker does not replace legal advice and does not automatically certify that a shipment is EUDR compliant. A responsible person performs the final assessment and approval.

## 2. Start the application

1. Open a PowerShell terminal in the project directory.
2. Run `npm start`.
3. Open `http://localhost:4173` in a browser.
4. The label "Prototype - Coffee only - Demo data" confirms that no production data is being used.

## 3. Navigation

- Overview: status of the active coffee shipment and pending tasks.
- Suppliers: data status of cooperatives, exporters, and producers.
- Plots: geolocation data and validation results.
- Shipments: quantitative origin and mass balance.
- Risk and evidence: separate risk signals, reviews, and the evidence pack.
- DDS: readiness and internal approval status.
- Guide: access to all three language versions and the combined PDF.

## 4. Recommended workflow

### Step 1: Create or invite a supplier

Open "Suppliers" and select "Invite supplier". In the prototype, the button only demonstrates the planned workflow. In the product version, the supplier receives a time-limited link.

At minimum, collect the organisation, contact, country of production, supply-chain role, and related producers.

### Step 2: Import plots

Open "Plots" and select "Import GeoJSON". GeoJSON, KML, and structured spreadsheet imports are planned. Every change creates a new plot version.

Check:

- correct production region.
- valid geometry.
- no self-intersections.
- plausible area.
- no unintended duplicates.
- EO or deforestation analysis result.

Request a correction when data is invalid. The compliance team must not silently modify an incorrect geometry.

### Step 3: Allocate source lots and batches

Assign harvested coffee quantities to source lots. Then record splits, merges, and processing steps.

Every step requires input quantity, output quantity, unit, documented loss, date, and responsible organisation. Any difference must be explained before the shipment can be approved.

### Step 4: Create a shipment

A shipment links the export batch, order or container reference, quantity, origin, and destination. Confirm that the full shipment quantity can be traced to available source lots.

"Balanced" only means that the mass balance is correct. It is not a legal EUDR approval.

### Step 5: Review risks

SCTracker displays data completeness, geodata quality, deforestation risk, legality risk, and traceability separately. Open warnings and inspect the source, date, rule or model version, and confidence.

Uncertain cases are not rejected automatically. A reviewer records the decision, reasoning, and any mitigation action.

### Step 6: Review the evidence pack

The evidence pack contains the versions and references used for the decision. Missing evidence is shown as open.

Review in particular:

- plot versions.
- document validity.
- analysis identifiers.
- quantity origin.
- rule versions.
- review decisions.

### Step 7: Prepare the declaration

Open "DDS". Review the product, origin, geolocations, mass balance, and human review. Submission remains locked while mandatory data or approvals are missing.

The prototype does not transmit data to the EU Information System. The future product version uses an isolated V3 adapter for due diligence statements and simplified declarations.

## 5. Status messages

- Complete: all expected data is available.
- Invited: the supplier has not completed data entry.
- Correction: at least one record must be corrected.
- In review: a human review is pending.
- Ready: internal prerequisites are met; this is not an authority decision.
- Balanced: input, output, and documented loss agree quantitatively.

## 6. Roles

- Supplier Contributor: enters supplier, producer, and plot data.
- Logistics Contributor: maintains batches, quantities, and shipments.
- Compliance Reviewer: reviews evidence, risk, and mitigation.
- Approver: approves a declaration under the four-eyes principle.
- Auditor: reads approved versions and audit events.
- Administrator: manages organisations, users, and technical configuration.

## 7. Privacy and security

Share supplier data only with authorised organisations. Never store credentials in documents or free-text fields. Personal data, full geometries, and commercially sensitive quantities must not be placed on a public blockchain.

Corrections must be versioned. Do not delete or overwrite evidence that has already been used for a decision.

## 8. Troubleshooting

- Page does not load: confirm that `npm start` is still running and port 4173 is available.
- Navigation does not respond: reload the page and use a current browser.
- PDF does not open: run `python scripts\build_pdfs.py`.
- Amharic text is missing from the PDF: verify the font file under `assets\fonts` and rebuild the PDF.

## 9. Support information

When reporting an error, include the affected shipment ID, workflow step, time, and visible message. Never send passwords, WS-Security credentials, or complete personal datasets.
