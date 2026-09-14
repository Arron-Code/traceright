# SCTracker Coffee Mobile

Expo/React-Native-App für Android und iOS mit vollständiger Oberfläche in Deutsch, Englisch, Amharisch und Tigrinya. Die Sprachauswahl bleibt dauerhaft im Header verfügbar und wird lokal gespeichert.

## Funktionen

- Offline-fähige Lieferanten- und Kaffee-Plot-Erfassung
- E-Mail-/Passwort-Login mit kurzlebigem Access Token, Refresh Token und Organisationsauswahl; Session verschlüsselt in Expo SecureStore
- echte GeoJSON-Polygone durch mehrere GPS-Punkte sowie JSON-Import und -Bearbeitung, inklusive Bereichs-, Flächen- und Selbstüberschneidungsprüfung
- lokale Geofence-Vorprüfung mit sichtbarem Backend-/Prüfstatus; Serverentscheidungen bleiben autoritativ
- strikt nach Benutzer und ausgewählter Organisation partitionierte AsyncStorage-Daten
- ungescopte V3-/V2-/Legacy-Plot-Daten werden mit Quelle, Originalformat und Rohwert in `sctracker.mobileState.legacyQuarantine.v1` quarantänisiert; sie werden keinem Login zugeordnet und nie automatisch synchronisiert
- retry-sichere Push/Pull-Synchronisierung mit UUID-/Idempotency-IDs, Outbox, Inbox-Cursor und sichtbarer Konfliktauflösung
- Dokument-Upload über Presigned-URL-Initiierung und Abschluss
- geschützter Evidence-Pack-Download als JSON mit Authentifizierungs- und Organisationsheadern
- Satellitenanalyse, Evidence-Pack-Anforderung mit Download/Teilen sowie DDS-Entwurf, Validierung, Einreichung und Status
- sichtbarer Online-/Offline-, Konfigurations- und Synchronisierungsstatus mit manueller Wiederholung

`NOT_CONFIGURED` und eine fehlende API-URL werden immer als blockierende Fehler angezeigt und nie als Erfolg behandelt.

## Konfiguration

`.env.example` nach `.env.local` kopieren und die Backend-Basis-URL setzen:

```powershell
Copy-Item .env.example .env.local
```

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3000
```

Es ist keine Produktions-URL fest eingebaut. Für ein physisches Gerät muss die URL vom Gerät erreichbar sein; `localhost` verweist dort auf das Gerät selbst.

Die App erwartet JSON-Antworten im Format `{ "data": ..., "meta": ... }` und Fehler als `{ "error": { "code": "...", "message": "...", "details": ... } }`.

Verwendete Endpunkte:

- `POST /api/v1/auth/login` (`{ email, password, organizationSlug? }`)
- `POST /api/v1/auth/refresh` (`{ refreshToken }`)
- `POST /api/v1/auth/logout` (`{ refreshToken }`)
- `GET /api/v1/geofences`
- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull?cursor=...`
- `POST /api/v1/documents/uploads`
- `POST /api/v1/documents/uploads/:id/complete`
- `POST|GET /api/v1/satellite/analyses[/:id]`
- `POST|GET /api/v1/evidence-packs[/:id]`
- `POST|GET /api/v1/dds/drafts[/:id]`
- `POST /api/v1/dds/drafts/:id/validate`
- `POST /api/v1/dds/drafts/:id/submit`

Login/Refresh liefern unter `data` mindestens `accessToken`, `refreshToken`, `user`,
`organizations` sowie `expiresIn` (Sekunden) oder `accessTokenExpiresAt`. Jeder
geschützte Request erhält `Authorization: Bearer <accessToken>` und
`X-Organization-Id: <id>`. Bei `401` wird einmalig aktualisiert und wiederholt.

## Legacy-Quarantäne

Ungescopte Daten aus `sctracker.mobileState.v3`, `sctracker.mobileState.v2` und
`sctracker.plotDrafts.v1` werden nicht einem Benutzer oder Mandanten zugeordnet.
Die App schreibt zuerst Quelle, Format und unveränderten Rohwert in
`sctracker.mobileState.legacyQuarantine.v1`. Nur nach erfolgreichem Schreiben
werden die aktiven Legacy-Keys best effort entfernt. Quarantänedaten werden
weder geladen noch automatisch synchronisiert; jeder neue authentifizierte
Scope beginnt leer.

`GEOFENCE_REVIEW_REQUIRED` kann unter `error.details.violations` Einträge mit
`violationId`, `operationId` und `entityId` liefern. Nur exakt passende
Plot-Operationen werden bis zum manuellen Retry pausiert; alle übrigen
Operationen werden im selben Sync-Vorgang erneut gepusht.

## Entwicklung

```powershell
npm install
npm start
```

## Prüfungen

```powershell
npm test
npm run typecheck
npx expo-doctor
npm run export:android
npm run export:ios
```

Für signierte Builds werden weiterhin Expo Application Services sowie die jeweiligen Apple-/Google-Entwicklerkonten benötigt.
