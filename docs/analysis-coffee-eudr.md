# SCTracker: Produktanalyse und Umsetzungsvorschlag

## Kaffee-EUDR Evidence Platform

Stand: 11. September 2026

## 1. Entscheidung

SCTracker sollte als fokussiertes EUDR Execution System für Kaffeeimporteure beginnen. Das Produktversprechen lautet:

> Von Lieferantendaten zur einreichbaren Erklärung - mit prüfbarer Mengen- und Evidenzkette pro Kaffee-Sendung.

Der Evidence Graph bleibt die langfristige Leitidee. Technisch wird er zunächst als nachvollziehbare Sicht auf relationale, versionierte Daten umgesetzt. Eine Graphdatenbank oder Blockchain ist für den Markteintritt nicht erforderlich.

## 2. Ausgangsbewertung

Das ursprüngliche Strategiepapier enthält eine starke Produktvision. Besonders überzeugend sind die Priorisierung von Datenqualität und Auditierbarkeit, das Bewusstsein für das Oracle-Problem, die Trennung des EU-Adapters sowie der zurückhaltende Umgang mit Blockchain.

Für eine belastbare Umsetzung waren jedoch fünf Korrekturen erforderlich:

- Beschränkung auf Kaffee und einen klaren Käufer.
- Vollständiger DDS-Prozess bereits im ersten verkaufbaren Produkt.
- Quantitative Materialbilanz statt rein narrativer Traceability.
- Klare Trennung von Evidenzvollständigkeit, Risiko und menschlicher Entscheidung.
- Berücksichtigung des regulatorischen und technischen Stands von September 2026.

## 3. Zielkunde und Markteintritt

Der erste Zielkunde ist ein mittelständischer EU-Kaffeeimporteur mit 20 bis 500 Lieferanten und wiederkehrenden Importen. Typischerweise liegen Lieferanten-, Plot- und Nachweisdaten heute in Excel-Dateien, E-Mails, GeoJSON/KML-Dateien und PDFs vor.

Der operative Käufer ist der Leiter Compliance, Supply Chain oder Operations. Sein Problem ist nicht ein fehlendes Blockchain-Netzwerk, sondern die rechtzeitige Vervollständigung, Prüfung und Zuordnung der Daten zu konkreten Kaffee-Sendungen.

Ein Pilot soll zwei Importeure und jeweils ein bis zwei reale Lieferketten umfassen. Ohne reale Sendungs-, Mengen- und Geodaten wird keine breite Plattform entwickelt.

## 4. Regulatorischer Rahmen

Der Produktplan muss dem aktuellen EUDR-Stand folgen. Die wesentlichen Verpflichtungen gelten grundsätzlich ab dem 30. Dezember 2026; für viele Kleinst- und Kleinunternehmen beginnt die Anwendung später. Das System muss deshalb unterschiedliche Akteursrollen, nachgelagerte Referenzierung und vereinfachte Erklärungen modellieren.

Die EU-Integration wird als versionierter Adapter umgesetzt. Sie umfasst die V3-Dienste für Due-Diligence-Erklärungen und vereinfachte Erklärungen, Acceptance- und Produktionskonfiguration, WS-Security, idempotente Übermittlung, Statusabfrage, Aktualisierung, Rücknahme sowie nachvollziehbare Fehlerbehandlung.

Technische Dokumentation und Rechtslage können sich ändern. SCTracker unterstützt die Compliance-Arbeit, ersetzt aber keine Rechtsberatung und trifft keine automatische rechtliche Konformitätsentscheidung.

## 5. Umfang des verkaufbaren MVP

### 5.1 Supplier Intake

- Einladungen über sichere Links.
- Mehrsprachige Formulare.
- CSV-, GeoJSON-, KML- und Dokumentimport.
- Status je Datenanforderung.
- Wiederverwendung bereits geprüfter Stammdaten mit kontrollierter Freigabe.

### 5.2 Plot Validation

- Geometriegültigkeit und Selbstüberschneidungen.
- Ländergrenzen, Land/Wasser, Duplikate und Flächenausreißer.
- nachvollziehbare Korrekturen und Plot-Versionen.
- Entwaldungsprüfung zunächst über einen austauschbaren externen EO-Anbieter.

### 5.3 Quantitative Chain of Custody

- Plot und Ernte beziehungsweise Source Lot.
- Batch, Split, Merge und Verarbeitung.
- Shipment Allocation.
- Mengen, Einheiten, Konvertierungen, Yield und dokumentierte Verluste.
- automatische Prüfung, dass Herkunftsmengen nicht mehrfach verwendet werden.

### 5.4 Risk und Human Review

Das System führt getrennte Bewertungen für Datenvollständigkeit, Geodatenqualität, Entwaldungsrisiko, Legalitätsrisiko und Traceability-Konsistenz. Unsichere oder widersprüchliche Fälle gehen in einen dokumentierten Human-Review-Workflow.

### 5.5 EU-Erklärung

- DDS und vereinfachte Erklärung.
- interner Entwurf und Vier-Augen-Freigabe.
- Übermittlung über den isolierten V3-Adapter.
- Speicherung von UUID, Referenznummer, Verifikationsnummer und Status.
- Rückfluss über API, Webhook oder Export.

### 5.6 Evidence Pack

Für jede Sendung wird ein reproduzierbarer Snapshot erzeugt. Er enthält Plot- und Dokumentversionen, Materialherkunft, Analyse-IDs, verwendete Regeln, Review-Entscheidungen, Zeitstempel und kryptografische Hashes.

## 6. Technische Architektur

Die erste Version wird als modularer Monolith entwickelt. Das reduziert Betriebsaufwand und hält Transaktionen über Mengenbilanz, Review und Erklärung konsistent.

- Webanwendung und Supplier Portal.
- modulare Application API.
- PostgreSQL und PostGIS als führendes System.
- S3-kompatibler Objektspeicher.
- Queue und Worker für Geoprüfungen und EU-Aufträge.
- Outbox Pattern für zuverlässige Integrationsereignisse.
- austauschbarer EO-Adapter.
- isolierter EU-V3-Adapter.
- append-only Audit Log.

Tenant-Isolation wird in Anwendung und Datenbank durchgesetzt. Dokumentzugriffe verwenden kurzlebige signierte URLs. Evidenz wird versioniert und nicht still überschrieben. Secrets liegen außerhalb der Anwendung in einem Secret Store.

## 7. Kerndatenmodell

Das zentrale Produktobjekt ist die Material Lineage:

Plot zu Harvest oder Source Lot zu Material Batch zu Transformation zu Shipment Allocation zu Due Diligence Case zu Erklärung.

Jedes Materialereignis enthält:

- Input- und Output-Batches.
- Menge, Einheit und normalisierte Basiseinheit.
- Yield oder dokumentierten Verlust.
- Organisation und verantwortliche Partei.
- Ereigniszeit und Erfassungszeit.
- Herkunftsallokation.
- Evidenzreferenzen.
- Version und gegebenenfalls Korrekturbezug.

Korrekturen erzeugen eine neue Version oder ein kompensierendes Ereignis. Historische Fakten werden nicht still verändert.

## 8. Was nicht zum MVP gehört

- eigene Blockchain oder Smart Contracts.
- eigene Satellitenmodelle.
- native Mobile-App.
- mehrere Rohstoffe.
- zahlreiche ERP-Connectoren.
- automatische Legalitätsentscheidung.
- generische ESG-Funktionen.

Ein kryptografisch verkettetes Audit Log, signierte Evidence-Pack-Manifeste und WORM-Speicherung liefern zunächst den benötigten Manipulationsschutz. Eine Blockchain wird erst bewertet, wenn mehrere unabhängige Organisationen verbindlich gemeinsame Governance und Kosten übernehmen.

## 9. Lieferplan

### Discovery - zwei Wochen

Rollenmatrix, reale Kaffee-Lieferkette, Beispieldaten, Feldmapping und Pilotvertrag. Ein No-go-Gate verhindert die Entwicklung ohne reale Pilotkunden und Daten.

### Pilot Core - sechs Wochen

Supplier Intake, Plotvalidierung, quantitative Lineage, Review und Evidence Pack.

### EU Integration - vier Wochen

V3 DDS und Simplified Declaration, Acceptance-Tests, Status- und Fehlerworkflow.

### Hardening - vier Wochen

Mandantentrennung, Security, Monitoring, Recovery, Lasttests und operativer Pilot.

## 10. Erfolgskriterien

- Mindestens 80 Prozent der angefragten Lieferantendaten kommen ohne individuelle Beratung zurück.
- Mindestens 90 Prozent der formalen Plotfehler werden automatisch und verständlich erkannt.
- Jede Shipment-Menge kann quantitativ zu den Source Lots zurückgeführt werden.
- Eine vollständige Erklärung wird in der Acceptance-Umgebung eingereicht.
- Ein Compliance-Mitarbeiter kann einen Standardfall in weniger als 15 Minuten prüfen.
- Ein Evidence Pack beantwortet typische Auditfragen ohne manuelle Nachrecherche.
- Manuelle Nachbearbeitung und externe EO-Kosten bleiben innerhalb einer definierten Zielmarge.

## 11. Geschäftsmodell

Empfohlen werden eine einmalige Pilot- und Onboarding-Gebühr, eine jährliche Plattformgebühr sowie eine nutzungsabhängige Komponente pro aktivem Lieferanten, Sendung oder Erklärung. Kostenpflichtige EO-Analysen und ERP-Connectoren werden separat berechnet.

Der langfristige Wettbewerbsvorteil entsteht aus wiederverwendbaren, freigegebenen Lieferantendaten, verifizierten Lieferkettenbeziehungen, regulatorischen Workflows, Integrationen und strukturierten Review-Daten - nicht aus dem verwendeten Framework oder einer Blockchain.

## 12. Aktueller Prototyp

Der erste SCTracker-Prototyp bildet bereits die kaffeefokussierte Informationsarchitektur ab:

- Compliance Cockpit.
- Lieferantenstatus.
- Plotvalidierung.
- quantitative Sendungs- und Mengenansicht.
- getrennte Risikosignale.
- Evidence-Pack-Fortschritt.
- DDS-Bereitschaft mit Einreichungssperre bei offenen Reviews.
- Gebrauchsanweisung in Deutsch, Englisch und Amharisch.

Die dargestellten Inhalte sind Demo-Daten. Es findet keine Verbindung zum EU Information System statt.
