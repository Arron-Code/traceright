# SCTracker Gebrauchsanweisung

## Kaffee-EUDR-Prototyp

Version 0.1 - September 2026

## 1. Zweck

SCTracker unterstützt Kaffeeimporteure bei der Erfassung, Prüfung und Zuordnung von Lieferanten-, Parzellen-, Mengen- und Nachweisdaten zu einer konkreten Sendung. Der Prototyp zeigt den Weg vom Source Lot bis zur vorbereiteten EUDR-Erklärung.

SCTracker ersetzt keine Rechtsberatung und bestätigt nicht automatisch, dass eine Sendung EUDR-konform ist. Die finale Bewertung und Freigabe erfolgt durch eine verantwortliche Person.

## 2. Anwendung starten

1. Öffnen Sie im Projektordner ein PowerShell-Terminal.
2. Führen Sie `npm start` aus.
3. Öffnen Sie `http://localhost:4173` im Browser.
4. Der Hinweis "Prototyp - Nur Kaffee - Demo-Daten" zeigt an, dass keine Produktivdaten verwendet werden.

## 3. Navigation

- Überblick: Status der aktiven Kaffee-Sendung und offene Aufgaben.
- Lieferanten: Datenstatus von Kooperativen, Exporteuren und Produzenten.
- Parzellen: Geodaten und Validierungsergebnisse.
- Sendungen: quantitative Herkunft und Mengenbilanz.
- Risiko und Evidenz: getrennte Risikosignale, Reviews und Evidence Pack.
- DDS: Bereitschaft und interner Freigabestatus.
- Anleitung: Zugriff auf die drei Sprachversionen und das PDF-Handbuch.

## 4. Empfohlener Arbeitsablauf

### Schritt 1: Lieferant anlegen oder einladen

Öffnen Sie "Lieferanten" und wählen Sie "Lieferant einladen". Im Prototyp zeigt die Schaltfläche nur den vorgesehenen Workflow an. In der Produktversion erhält der Lieferant einen zeitlich begrenzten Link.

Erforderlich sind mindestens Organisation, Kontakt, Produktionsland, Rolle in der Lieferkette und die zugehörigen Produzenten.

### Schritt 2: Parzellen importieren

Öffnen Sie "Parzellen" und wählen Sie "GeoJSON importieren". Vorgesehen sind GeoJSON, KML und strukturierte Tabellenimporte. Jede Änderung erzeugt eine neue Plot-Version.

Prüfen Sie:

- korrekte Produktionsregion.
- gültige Geometrie.
- keine Selbstüberschneidung.
- plausible Fläche.
- keine unbeabsichtigten Duplikate.
- Ergebnis der EO- beziehungsweise Entwaldungsprüfung.

Fordern Sie bei Fehlern eine Korrektur an. Falsche Geometrien dürfen nicht still durch das Compliance-Team verändert werden.

### Schritt 3: Source Lots und Batches zuordnen

Ordnen Sie die geerntete Kaffeemenge einem Source Lot zu. Erfassen Sie danach Split-, Merge- und Verarbeitungsschritte.

Für jeden Schritt werden Input-Menge, Output-Menge, Einheit, dokumentierter Verlust, Datum und verantwortliche Organisation benötigt. Eine Differenz muss erklärt werden, bevor eine Sendung freigegeben werden kann.

### Schritt 4: Sendung erstellen

Eine Sendung verbindet Export Batch, Bestell- oder Containerreferenz, Menge, Herkunft und Ziel. Kontrollieren Sie, dass die gesamte Sendungsmenge auf verfügbare Source Lots zurückgeführt werden kann.

Der Status "Ausgeglichen" bedeutet nur, dass die Mengenbilanz stimmt. Er ist keine rechtliche EUDR-Freigabe.

### Schritt 5: Risiken prüfen

SCTracker zeigt Datenvollständigkeit, Geodatenqualität, Entwaldungsrisiko, Legalitätsrisiko und Traceability getrennt. Öffnen Sie Warnungen und prüfen Sie Quelle, Datum, Regel- oder Modellversion und Confidence.

Unsichere Fälle werden nicht automatisch abgelehnt. Ein Reviewer dokumentiert Entscheidung, Begründung und gegebenenfalls Mitigationsmaßnahmen.

### Schritt 6: Evidence Pack kontrollieren

Das Evidence Pack enthält die für eine Entscheidung verwendeten Versionen und Referenzen. Fehlende Nachweise werden als offen angezeigt.

Kontrollieren Sie insbesondere:

- Plot-Versionen.
- Dokumentgültigkeit.
- Analyse-IDs.
- Mengenherkunft.
- Regelversionen.
- Review-Entscheidungen.

### Schritt 7: Erklärung vorbereiten

Öffnen Sie "DDS". Prüfen Sie Produkt, Herkunft, Geolokationen, Mengenbilanz und Review. Solange Pflichtangaben oder Freigaben fehlen, bleibt die Einreichung gesperrt.

Der Prototyp sendet keine Daten an das EU Information System. Die spätere Produktversion verwendet einen isolierten V3-Adapter für DDS und vereinfachte Erklärungen.

## 5. Statusmeldungen

- Vollständig: alle erwarteten Daten sind vorhanden.
- Eingeladen: der Lieferant hat die Datenerfassung noch nicht abgeschlossen.
- Korrektur: mindestens ein Datensatz muss berichtigt werden.
- In Prüfung: ein menschlicher Review ist offen.
- Bereit: interne Voraussetzungen sind erfüllt; dies ist keine behördliche Bestätigung.
- Ausgeglichen: Input, Output und dokumentierter Verlust stimmen mengenmäßig überein.

## 6. Rollen

- Supplier Contributor: erfasst Lieferanten-, Produzenten- und Plotdaten.
- Logistics Contributor: pflegt Batches, Mengen und Sendungen.
- Compliance Reviewer: prüft Evidenz, Risiken und Mitigation.
- Approver: gibt eine Erklärung nach dem Vier-Augen-Prinzip frei.
- Auditor: liest freigegebene Versionen und Audit-Ereignisse.
- Administrator: verwaltet Organisationen, Benutzer und technische Konfiguration.

## 7. Datenschutz und Sicherheit

Teilen Sie Lieferantendaten nur mit berechtigten Organisationen. Speichern Sie keine Zugangsdaten in Dokumenten oder Freitextfeldern. Personenbezogene Daten, vollständige Geometrien und kommerzielle Mengen gehören nicht auf eine öffentliche Blockchain.

Korrekturen müssen versioniert werden. Löschen oder überschreiben Sie keine Evidenz, die bereits für eine Entscheidung verwendet wurde.

## 8. Fehlerbehebung

- Seite lädt nicht: Prüfen Sie, ob `npm start` noch läuft und Port 4173 erreichbar ist.
- Navigation reagiert nicht: Laden Sie die Seite neu und verwenden Sie einen aktuellen Browser.
- PDF öffnet nicht: Führen Sie `python scripts\build_pdfs.py` aus.
- Amharischer Text fehlt im PDF: Prüfen Sie, ob die Schriftdatei unter `assets\fonts` vorhanden ist, und bauen Sie das PDF erneut.

## 9. Supportinformationen

Geben Sie bei einem Fehler die betroffene Sendungs-ID, den Arbeitsschritt, den Zeitpunkt und die sichtbare Meldung an. Senden Sie keine Passwörter, WS-Security-Zugangsdaten oder vollständigen personenbezogenen Datensätze.
