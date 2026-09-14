# SCTracker Cloud-Services

## Empfohlene Infrastruktur für die Kaffee-EUDR-Plattform

Stand: 11. September 2026

## 1. Empfehlung

Für den ersten SCTracker-Pilot empfiehlt sich ein hybrider Managed-Cloud-Stack:

- Cloudflare Pages für Landingpage und statische Produktinhalte.
- Railway in einer EU-Region für Webanwendung, API und Worker.
- PostgreSQL mit PostGIS bei Neon oder Railway als zentrale Datenbank.
- Redis als kurzfristige Job Queue.
- AWS S3 in Frankfurt mit Versionierung und Object Lock für Evidenz.
- Auth0 EU oder Microsoft Entra External ID für Identität und MFA.
- Sentinel Hub, UP42 oder ein spezialisierter EUDR-Anbieter für EO-Analysen.

Diese Kombination ermöglicht eine schnelle Pilotbereitstellung, ohne bei Geodaten, Auditierbarkeit und revisionsrelevanter Evidenz unnötige Abkürzungen zu nehmen.

## 2. Zuordnung der Cloud-Dienste

### Öffentliche Website

Cloudflare Pages oder Vercel eignen sich für die öffentliche Landingpage. Dort werden Produktversprechen, Screenshots, Pilotprogramm, Datenschutzhinweise und Kontaktinformationen veröffentlicht. Es werden keine vertraulichen Lieferkettendaten verarbeitet.

### Webanwendung und API

Railway eignet sich für den kaffeefokussierten Pilot:

- einfache Deployments aus dem Git-Repository.
- getrennte Development-, Staging- und Production-Umgebungen.
- Betrieb von Webanwendung, API und Hintergrund-Worker.
- zentrale Variablen- und Secret-Konfiguration.
- Laufzeitlogs und schnelle Skalierung ohne eigenes Kubernetes.

Für den Pilot sollte eine EU-Region verwendet werden. Die tatsächlich gewählte Region und die vertraglichen Datenschutzbedingungen müssen dokumentiert werden.

### PostgreSQL und PostGIS

PostgreSQL ist das führende System für Organisationen, Lieferanten, Produzenten, Parzellen, Source Lots, Batches, Transformationen, Sendungen, Risikoentscheidungen und Erklärungen. PostGIS übernimmt räumliche Prüfungen.

Für den Pilot eignet sich Neon PostgreSQL in einer EU-Region oder Railway PostgreSQL. Vor Produktivstart sind Point-in-Time Recovery, Backup-Aufbewahrung, Verbindungslimits, Datenregion und Rollenmodell zu prüfen.

Für Kunden mit strengeren Enterprise-Anforderungen kann später AWS RDS PostgreSQL oder Azure Database for PostgreSQL eingesetzt werden.

### Job Queue und Worker

Redis auf Railway kann kurzfristige Jobs koordinieren:

- GeoJSON- und KML-Importe.
- Geometrievalidierung.
- EO-Aufträge.
- Evidence-Pack-Erstellung.
- EU-Einreichungen und Statusabfragen.

Geschäftskritische Zustände dürfen nicht ausschließlich in Redis liegen. Auftragsstatus und fachliche Ergebnisse werden dauerhaft in PostgreSQL gespeichert. Dauerhaft fehlgeschlagene Aufträge benötigen eine Dead-Letter-Behandlung.

### Dokumente und Evidence Packs

AWS S3 in `eu-central-1` wird für revisionsrelevante Dateien empfohlen:

- GeoJSON- und KML-Dateien.
- Zertifikate und Legalitätsnachweise.
- Rechnungen und Transportdokumente.
- Satelliten- und Analyseergebnisse.
- Evidence Packs.
- gesendete und empfangene XML-Nachrichten.

Erforderliche Einstellungen:

- Bucket Versioning.
- Object Lock im passenden Governance- oder Compliance-Modus.
- serverseitige Verschlüsselung mit AWS KMS.
- Lifecycle- und Aufbewahrungsregeln.
- getrennte Bereiche für ungeprüfte Uploads und freigegebene Evidenz.
- ausschließlich private Buckets.
- kurzlebige signierte URLs.

Ein gewöhnlicher S3-kompatibler Bucket ist nicht automatisch ein revisionssicheres Archiv. Object Lock und Aufbewahrungsregeln müssen ausdrücklich konfiguriert und getestet werden.

### Identität und Berechtigungen

Auth0 mit EU-Datenregion oder Microsoft Entra External ID sind geeignete Optionen. Erforderlich sind:

- Multi-Faktor-Authentifizierung für privilegierte Rollen.
- Enterprise SSO für Kunden.
- organisationsgebundene Benutzer.
- Rollen wie Supplier Contributor, Logistics Contributor, Compliance Reviewer, Approver, Auditor und Administrator.
- kurzlebige Sessions und nachvollziehbare Berechtigungsänderungen.

Autorisierung muss zusätzlich serverseitig und datenbanknah durchgesetzt werden. Eine ausgeblendete Schaltfläche im Frontend ist keine Zugriffskontrolle.

### Secret Management

Im Pilot können Railway Variables verwendet werden. Produktionsrelevante EU-Zugangsdaten, Signaturschlüssel und externe API-Schlüssel sollten später in AWS Secrets Manager oder Azure Key Vault liegen.

Secrets gehören niemals:

- in das Git-Repository.
- in PDF-Dokumente.
- in Protokolle.
- in Freitextfelder.
- in Client-seitigen JavaScript-Code.

### Monitoring

Railway Logs und Sentry eignen sich für den Pilot. Für den Produktivbetrieb werden zusätzlich strukturierte Logs, Metriken, Traces und Alarmierungen benötigt.

Besonders überwacht werden:

- fehlgeschlagene EU-Einreichungen.
- wachsende Job Queues.
- fehlerhafte Geoimporte.
- ungewöhnliche Tenant-Zugriffe.
- fehlgeschlagene Anmeldungen.
- Änderungen an freigegebenen Evidenzversionen.
- Backup- und Restore-Ergebnisse.

## 3. Satelliten- und EO-Dienste

SCTracker sollte im MVP keine eigene Satelliteninfrastruktur betreiben.

### Sentinel Hub

Geeignet für Sentinel-2-Daten, Zeitreihen und eigene Auswertungen. Gute Wahl, wenn SCTracker schrittweise eigene fachliche Logik entwickeln möchte.

### UP42

Geeignet für den Zugriff auf verschiedene Datenquellen und Analyseanbieter über eine Plattform.

### Planet

Geeignet für hochauflösende kommerzielle Daten. Wegen der höheren Kosten sollte Planet gezielt für unklare oder hochwertige Fälle eingesetzt werden.

### Spezialisierter EUDR-Anbieter

Die schnellste Pilotoption, wenn der Anbieter bereits klassifizierte Ergebnisse, Methodik, Confidence und auditierbare Analyse-IDs bereitstellt.

Jeder Anbieter wird über einen austauschbaren Adapter angebunden. SCTracker speichert Datenquelle, Beobachtungszeitraum, Analyse-ID, Modellversion, Confidence und Ergebnis. Ein einfacher Grün-/Rot-Wert reicht nicht.

## 4. EU-EUDR-Integration

Der EU-V3-Adapter läuft als isoliertes Modul oder Worker. Er benötigt:

- getrennte Acceptance- und Production-Konfiguration.
- WS-Security-Zugangsdaten im Secret Store.
- idempotente Übermittlungsaufträge.
- begrenzte Wiederholungsversuche mit Backoff.
- Dead-Letter-Behandlung.
- nachvollziehbare SOAP-Fehler.
- Speicherung von UUID, Referenznummer, Verifikationsnummer und Status.
- Alarmierung bei technischen und fachlichen Ablehnungen.

Requests und Responses können zu Audit-Zwecken archiviert werden, dürfen aber keine ungeschützten Credentials oder unnötigen personenbezogenen Daten enthalten.

## 5. Empfohlene Umgebungen

### Development

Nur synthetische Daten. Entwickler dürfen keine Produktionsdaten herunterladen oder kopieren.

### Staging und Acceptance

Anonymisierte oder synthetische Daten, EU-Acceptance-Zugang und realistische Integrationstests. Eigene Datenbank, Buckets und Secrets.

### Production

Reale Kaffee-Lieferketten mit eigener Datenbank, eigenen Buckets, eigenen Schlüsseln und produktiven EU-Credentials. Der Zugriff folgt dem Need-to-know-Prinzip.

## 6. Zielarchitektur

Der Request-Pfad verläuft über Cloudflare zur Webanwendung und API auf Railway. Die API verwendet PostgreSQL/PostGIS für Fachdaten und Redis für kurzfristige Arbeitsaufträge. Separate Worker bearbeiten Geoprüfungen, EO-Aufträge, PDF-Erstellung und EU-Kommunikation. Dokumente und freigegebene Evidence Packs liegen verschlüsselt und versioniert in AWS S3.

Die Anwendung bleibt ein modularer Monolith. Eine Microservice- oder Kubernetes-Landschaft wird erst eingeführt, wenn tatsächliche Skalierungs-, Sicherheits- oder Teamgrenzen dies verlangen.

## 7. Alternative Enterprise-Stacks

### Vollständig auf AWS

- ECS/Fargate für API und Worker.
- RDS PostgreSQL/PostGIS.
- S3 Object Lock.
- SQS für Aufträge.
- Secrets Manager und KMS.
- CloudFront und WAF.
- CloudWatch und CloudTrail.

Diese Variante bietet umfangreiche Sicherheits- und Auditfunktionen, verursacht aber mehr Konfigurations- und Betriebsaufwand.

### Vollständig auf Microsoft Azure

- Azure Container Apps.
- Azure Database for PostgreSQL.
- Blob Storage mit Immutability Policies.
- Service Bus.
- Key Vault.
- Entra ID.
- Azure Monitor.

Azure ist besonders attraktiv, wenn Zielkunden Microsoft-Identitäten, SAP-Integrationen oder bestehende Azure-Verträge verwenden.

## 8. Kostenrahmen

Für einen kleinen Pilot ohne Satellitengebühren ist folgende monatliche Größenordnung realistisch:

- Landingpage: 0 bis 20 Euro.
- Railway API und Worker: 30 bis 150 Euro.
- PostgreSQL/PostGIS: 20 bis 150 Euro.
- Redis: 10 bis 50 Euro.
- S3, Backups und Transfers: 10 bis 100 Euro.
- Authentifizierung, Monitoring und E-Mail: 20 bis 150 Euro.

Damit liegt ein Pilot typischerweise bei etwa 100 bis 600 Euro pro Monat. EO-Analysen, Support und manuelle Reviews kommen hinzu. Ein Enterprise-Produktivbetrieb kann abhängig von Datenvolumen, Verfügbarkeit und Sicherheitsanforderungen 1.000 bis 5.000 Euro pro Monat oder mehr kosten.

Preise und Leistungsmerkmale ändern sich. Vor einer Beschaffungsentscheidung sind aktuelle Angebote, Datenregionen, Auftragsverarbeitungsverträge und technische Limits zu prüfen.

## 9. Einführungsreihenfolge

1. Öffentliche Demo über Cloudflare Pages oder Railway bereitstellen.
2. Private Pilotumgebung mit Railway API, Worker und PostgreSQL/PostGIS einrichten.
3. S3-Evidenzarchiv mit Versionierung, Verschlüsselung und Object Lock konfigurieren.
4. Authentifizierung, Mandantentrennung und Rollenmodell implementieren.
5. EO-Anbieter über einen austauschbaren Adapter integrieren.
6. EU-Acceptance-Adapter implementieren und testen.
7. Backup- und Restore-Verfahren praktisch prüfen.
8. Erst nach Security- und Datenschutzprüfung reale Lieferkettendaten verwenden.

## 10. Konkrete Startkonfiguration

Für SCTracker empfiehlt sich zum Start:

- Cloudflare Pages für die Produktseite.
- Railway Amsterdam für Webanwendung, API und Worker.
- Neon PostgreSQL in einer EU-Region.
- Redis auf Railway.
- AWS S3 Frankfurt für unveränderliche Evidenz.
- Auth0 EU für Identität.
- Sentinel Hub oder ein spezialisierter EUDR-Anbieter für EO.
- Sentry und Railway Logs für Monitoring.
- Postmark EU oder AWS SES EU für Benachrichtigungen.

Dieser Stack bietet einen guten Kompromiss aus schneller Umsetzung, kontrollierbaren Kosten und späterer Enterprise-Fähigkeit.
