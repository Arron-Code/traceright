# SCTracker Mobile-Testcheckliste

## Android und iOS - Kaffee-Feld-App

Stand: 11. September 2026

## 1. Vorbereitung

- Expo Go auf dem Mobiltelefon installieren.
- Mit dem Expo-Konto anmelden.
- Den SCTracker-Entwicklungslink in Expo Go öffnen.
- Standortzugriff nur während der App-Nutzung erlauben.
- Prüfen, dass auf der Startseite "SCTracker Coffee Evidence" angezeigt wird.

## 2. Startseite testen

1. Den Tab "Start" öffnen.
2. Die aktive Sendung `IMP-2026-0142` prüfen.
3. Fortschritt, Lieferantenstatus und offene Aufgaben kontrollieren.
4. Auf "Neuen Kaffee-Plot erfassen" tippen.
5. Erwartetes Ergebnis: Die Plot-Erfassung wird geöffnet.

Die dargestellten Sendungs- und Kennzahlendaten sind synthetische Demo-Daten.

## 3. Lieferanten testen

1. Den Tab "Partner" öffnen.
2. Die Lieferanten Kaffa Cooperative Union, Jimma Highland Export und Sidama Coffee Farmers prüfen.
3. Statuswerte, Produzentenanzahl und Anzahl der Kaffee-Plots vergleichen.

Erwartetes Ergebnis: Alle drei Lieferanten werden mit ihrem jeweiligen Datenstatus angezeigt.

Die Lieferantenansicht ist im aktuellen Prototyp nur lesbar. Neue Lieferanten und Änderungen werden später über die Backend-API angebunden.

## 4. GPS-Plot-Erfassung testen

1. Den mittleren Standort-Button öffnen.
2. Einen Produzentennamen eingeben.
3. Einen Plot- oder Farmnamen eingeben.
4. Eine positive Fläche in Hektar eingeben.
5. Auf "GPS erfassen" tippen.
6. Standortzugriff erlauben.
7. Auf "Offline-Entwurf speichern" tippen.

Erwartetes Ergebnis:

- Die GPS-Koordinaten werden angezeigt.
- Eine Bestätigung für die lokale Speicherung erscheint.
- Der neue Plot wird unter "Gespeicherte Entwürfe" angezeigt.
- Der Entwurf ist mit "nur lokal" gekennzeichnet.

Für einen realistischen GPS-Test sollte die Position direkt am Kaffee-Plot und möglichst im Freien erfasst werden.

## 5. Eingabevalidierung testen

### Fehlende Pflichtfelder

Ohne Produzent, Plotname, Fläche oder GPS-Position speichern.

Erwartetes Ergebnis: Die App lehnt die Speicherung ab und nennt die fehlenden Angaben.

### Ungültige Fläche

Als Fläche `0`, einen negativen Wert oder einen nicht numerischen Inhalt eingeben.

Erwartetes Ergebnis: Die App fordert eine positive Fläche in Hektar.

### Verweigerter Standortzugriff

Die GPS-Berechtigung verweigern und "GPS erfassen" auswählen.

Erwartetes Ergebnis: Die App erklärt, dass die Standortberechtigung für die Plot-Erfassung benötigt wird.

Auf dem iPhone kann die Berechtigung später unter Einstellungen, Datenschutz und Sicherheit, Ortungsdienste, Expo Go geändert werden.

## 6. Lokale Speicherung testen

1. Einen vollständigen Plot-Entwurf speichern.
2. Expo Go vollständig schließen.
3. Expo Go erneut öffnen.
4. SCTracker erneut starten.
5. Zur Plot-Erfassung wechseln.

Erwartetes Ergebnis: Der zuvor gespeicherte Entwurf ist weiterhin vorhanden.

Die Entwürfe liegen aktuell ausschließlich im lokalen AsyncStorage des Geräts. Eine Deinstallation von Expo Go oder das Löschen der App-Daten kann diese Entwürfe entfernen.

## 7. Offline-Verhalten testen

1. SCTracker bei bestehender Internetverbindung vollständig laden.
2. Danach den Flugmodus aktivieren.
3. Einen weiteren Plot erfassen.
4. Den Entwurf offline speichern.
5. Den Flugmodus deaktivieren.

Erwartetes Ergebnis: Der Entwurf kann ohne Netzwerk gespeichert und angezeigt werden.

Hinweis: Im Expo-Entwicklungsmodus kann ein vollständiger Neustart der App erneut den Entwicklungsserver benötigen. Ein späterer installierbarer Produktionsbuild enthält das JavaScript-Bundle direkt.

## 8. Sendungen testen

1. Den Tab "Sendungen" öffnen.
2. Sendungs-ID, Kaffeeprodukt, Herkunft und Menge prüfen.
3. Den Fortschrittsbalken der DDS-Bereitschaft kontrollieren.
4. Die Statuswerte "In Prüfung" und "Bereit" vergleichen.

Erwartetes Ergebnis: Beide Demo-Sendungen werden korrekt und ohne Bearbeitungsmöglichkeit angezeigt.

Der Status "Bereit" ist im Prototyp keine rechtliche oder behördliche Bestätigung.

## 9. Sprachen testen

1. Den Tab "Hilfe" öffnen.
2. `DE` auswählen.
3. `EN` auswählen.
4. `አማ` auswählen.

Erwartetes Ergebnis: Überschrift, Anleitungsschritte und Datenschutzhinweis wechseln zwischen Deutsch, Englisch und Amharisch.

Die amharische Fassung sollte vor einem Produktionseinsatz von einer muttersprachlichen Fachperson geprüft werden.

## 10. Datenschutz testen

- Keine echten Passwörter, EU-Zugangsdaten oder Identitätsdokumente eingeben.
- GPS nur mit Einwilligung der betroffenen Person erfassen.
- Prüfen, ob das Betriebssystem den Standortzugriff sichtbar anzeigt.
- Keine realen Lieferantendaten für allgemeine Demo-Zwecke verwenden.

## 11. Noch nicht angebundene Funktionen

Folgende Funktionen sind im aktuellen mobilen Prototyp noch nicht produktiv:

- Backend-Synchronisation.
- Anmeldung und Mandantentrennung.
- Anlegen und Bearbeiten von Lieferanten.
- vollständige Polygon- oder GeoJSON-Erfassung.
- Dokument- und Zertifikatsupload.
- Satelliten- und Entwaldungsanalyse.
- Evidence-Pack-Erzeugung.
- quantitative Batch- und Mengenbuchungen.
- EU-DDS- und Simplified-Declaration-Einreichung.
- Push-Benachrichtigungen.

Diese Funktionen benötigen API, PostgreSQL/PostGIS, Objekt-Speicher, Authentifizierung und den isolierten EU-V3-Adapter.

## 12. Fehler dokumentieren

Bei einem Fehler folgende Angaben notieren:

- verwendetes Gerät und Betriebssystemversion.
- Expo-Go-Version.
- betroffener Tab und Arbeitsschritt.
- sichtbare Fehlermeldung.
- Zeitpunkt des Fehlers.
- ob Internet und GPS verfügbar waren.

Keine Passwörter, Zugangsschlüssel oder vollständigen personenbezogenen Datensätze in Screenshots oder Fehlerberichte aufnehmen.
