export const languages = ["de", "en", "am", "ti"] as const;
export type Language = (typeof languages)[number];

export type Translation = {
  languageName: string;
  languageCode: string;
  chooseLanguage: string;
  languageHint: string;
  close: string;
  brandSubtitle: string;
  auth: {
    title: string;
    email: string;
    password: string;
    organizationSlug: string;
    signIn: string;
    signOut: string;
    selectOrganization: string;
  };
  tabs: { home: string; suppliers: string; plots: string; operations: string; help: string };
  common: {
    save: string;
    create: string;
    refresh: string;
    retry: string;
    download: string;
    share: string;
    status: string;
    name: string;
    region: string;
    subjectId: string;
    pending: string;
    synced: string;
    failed: string;
    conflict: string;
  };
  sync: {
    online: string;
    offline: string;
    syncing: string;
    queued: string;
    lastSync: string;
    never: string;
    syncNow: string;
    configured: string;
    notConfigured: string;
    notConfiguredDetail: string;
    success: string;
    error: string;
    conflicts: string;
    keepLocal: string;
    useServer: string;
  };
  home: { title: string; intro: string; suppliers: string; plots: string; documents: string };
  suppliers: {
    title: string;
    description: string;
    add: string;
    empty: string;
    producerCount: string;
    plotCount: string;
  };
  plots: {
    title: string;
    description: string;
    producer: string;
    farm: string;
    area: string;
    supplierId: string;
    capturePoint: string;
    pointCount: string;
    polygonJson: string;
    importGeoJson: string;
    applyGeoJson: string;
    saveDraft: string;
    empty: string;
    invalidPolygon: string;
    gpsError: string;
    permissionError: string;
    geofence: string;
    geofencePending: string;
    geofenceInside: string;
    geofenceOutside: string;
    geofenceReview: string;
    geofenceApproved: string;
    geofenceBlocked: string;
  };
  operations: {
    title: string;
    documents: string;
    pickUpload: string;
    satellite: string;
    requestSatellite: string;
    evidence: string;
    requestEvidence: string;
    dds: string;
    createDds: string;
    validateDds: string;
    submitDds: string;
    checkStatus: string;
    noItems: string;
    providerBlocked: string;
  };
  help: { title: string; body: string };
  alerts: { required: string; saved: string; storageError: string };
};

export const translations = {
  de: {
    languageName: "Deutsch", languageCode: "DE", chooseLanguage: "Sprache auswählen",
    languageHint: "Die Auswahl wird auf diesem Gerät gespeichert.", close: "Schließen",
    brandSubtitle: "Kaffee-Nachweise",
    auth: {
      title: "Anmelden", email: "E-Mail", password: "Passwort",
      organizationSlug: "Organisationskürzel (optional)", signIn: "Anmelden",
      signOut: "Abmelden", selectOrganization: "Organisation auswählen",
    },
    tabs: { home: "Start", suppliers: "Partner", plots: "Plots", operations: "Vorgänge", help: "Hilfe" },
    common: {
      save: "Speichern", create: "Erstellen", refresh: "Aktualisieren", retry: "Erneut versuchen",
      download: "Herunterladen", share: "Teilen", status: "Status", name: "Name", region: "Region",
      subjectId: "Referenz-ID", pending: "Ausstehend", synced: "Synchronisiert", failed: "Fehlgeschlagen",
      conflict: "Konflikt",
    },
    sync: {
      online: "Online", offline: "Offline", syncing: "Synchronisierung ...", queued: "in Warteschlange",
      lastSync: "Letzte Synchronisierung", never: "Noch nie", syncNow: "Jetzt synchronisieren",
      configured: "Backend konfiguriert", notConfigured: "Backend nicht konfiguriert",
      notConfiguredDetail: "EXPO_PUBLIC_API_URL fehlt. Synchronisierung und Provider-Vorgänge sind blockiert.",
      success: "Synchronisierung abgeschlossen", error: "Synchronisierung fehlgeschlagen",
      conflicts: "Synchronisierungskonflikte", keepLocal: "Lokale Version behalten", useServer: "Serverversion verwenden",
    },
    home: {
      title: "Feldübersicht", intro: "Offline erfassen, sicher synchronisieren und Compliance-Vorgänge verfolgen.",
      suppliers: "Lieferanten", plots: "Kaffee-Plots", documents: "Dokumente",
    },
    suppliers: {
      title: "Lieferanten", description: "Lieferanten werden offline angelegt und über die Outbox synchronisiert.",
      add: "Lieferant hinzufügen", empty: "Noch keine Lieferanten.", producerCount: "Produzenten", plotCount: "Plots",
    },
    plots: {
      title: "GeoJSON-Plots", description: "Mindestens drei GPS-Punkte erfassen oder ein GeoJSON-Polygon importieren und bearbeiten.",
      producer: "Produzent", farm: "Plot- oder Farmname", area: "Fläche (ha)", supplierId: "Lieferanten-ID (optional)",
      capturePoint: "GPS-Punkt hinzufügen", pointCount: "Punkte", polygonJson: "GeoJSON Polygon",
      importGeoJson: "GeoJSON importieren", applyGeoJson: "GeoJSON übernehmen", saveDraft: "Offline-Plot speichern",
      empty: "Noch keine Plot-Entwürfe.", invalidPolygon: "Das Polygon ist ungültig. Mindestens drei unterschiedliche Positionen sind erforderlich.",
      gpsError: "Der Standort konnte nicht ermittelt werden.", permissionError: "Standortberechtigung wurde nicht erteilt.",
      geofence: "Geofence", geofencePending: "Ausstehend", geofenceInside: "Innerhalb",
      geofenceOutside: "Außerhalb", geofenceReview: "Prüfung erforderlich",
      geofenceApproved: "Freigegeben", geofenceBlocked: "Lokal blockiert; das Backend entscheidet endgültig.",
    },
    operations: {
      title: "Compliance-Vorgänge", documents: "Dokumente", pickUpload: "Dokument auswählen und hochladen",
      satellite: "Satellitenanalyse", requestSatellite: "Analyse anfordern", evidence: "Evidence Pack",
      requestEvidence: "Evidence Pack anfordern", dds: "DDS-Entwurf", createDds: "DDS-Entwurf erstellen",
      validateDds: "Validieren", submitDds: "Einreichen", checkStatus: "Status abrufen",
      noItems: "Noch keine Vorgänge.", providerBlocked: "Provider-Konfiguration fehlt. Dieser Vorgang ist blockiert.",
    },
    help: {
      title: "Offline und Datenschutz",
      body: "GPS- und Personendaten nur mit Einwilligung erfassen. Lokale Änderungen bleiben bis zur bestätigten Synchronisierung erhalten. Konflikte werden nie automatisch überschrieben.",
    },
    alerts: { required: "Bitte alle erforderlichen Felder ausfüllen.", saved: "Offline gespeichert.", storageError: "Lokale Daten konnten nicht sicher gespeichert werden." },
  },
  en: {
    languageName: "English", languageCode: "EN", chooseLanguage: "Choose language",
    languageHint: "The selection is saved on this device.", close: "Close",
    brandSubtitle: "Coffee Evidence",
    auth: {
      title: "Sign in", email: "Email", password: "Password",
      organizationSlug: "Organization slug (optional)", signIn: "Sign in",
      signOut: "Sign out", selectOrganization: "Select organization",
    },
    tabs: { home: "Home", suppliers: "Partners", plots: "Plots", operations: "Operations", help: "Help" },
    common: {
      save: "Save", create: "Create", refresh: "Refresh", retry: "Retry", download: "Download",
      share: "Share", status: "Status", name: "Name", region: "Region", subjectId: "Reference ID",
      pending: "Pending", synced: "Synced", failed: "Failed", conflict: "Conflict",
    },
    sync: {
      online: "Online", offline: "Offline", syncing: "Synchronising ...", queued: "queued",
      lastSync: "Last sync", never: "Never", syncNow: "Sync now", configured: "Backend configured",
      notConfigured: "Backend not configured",
      notConfiguredDetail: "EXPO_PUBLIC_API_URL is missing. Synchronisation and provider operations are blocked.",
      success: "Synchronisation completed", error: "Synchronisation failed", conflicts: "Sync conflicts",
      keepLocal: "Keep local version", useServer: "Use server version",
    },
    home: {
      title: "Field overview", intro: "Capture offline, synchronise safely, and track compliance operations.",
      suppliers: "Suppliers", plots: "Coffee plots", documents: "Documents",
    },
    suppliers: {
      title: "Suppliers", description: "Suppliers are created offline and synchronised through the outbox.",
      add: "Add supplier", empty: "No suppliers yet.", producerCount: "Producers", plotCount: "Plots",
    },
    plots: {
      title: "GeoJSON plots", description: "Capture at least three GPS points or import and edit a GeoJSON Polygon.",
      producer: "Producer", farm: "Plot or farm name", area: "Area (ha)", supplierId: "Supplier ID (optional)",
      capturePoint: "Add GPS point", pointCount: "Points", polygonJson: "GeoJSON Polygon",
      importGeoJson: "Import GeoJSON", applyGeoJson: "Apply GeoJSON", saveDraft: "Save offline plot",
      empty: "No plot drafts yet.", invalidPolygon: "The polygon is invalid. At least three distinct positions are required.",
      gpsError: "The current location could not be determined.", permissionError: "Location permission was not granted.",
      geofence: "Geofence", geofencePending: "Pending", geofenceInside: "Inside",
      geofenceOutside: "Outside", geofenceReview: "Review required",
      geofenceApproved: "Approved", geofenceBlocked: "Locally blocked; the backend remains authoritative.",
    },
    operations: {
      title: "Compliance operations", documents: "Documents", pickUpload: "Pick and upload document",
      satellite: "Satellite analysis", requestSatellite: "Request analysis", evidence: "Evidence pack",
      requestEvidence: "Request evidence pack", dds: "DDS draft", createDds: "Create DDS draft",
      validateDds: "Validate", submitDds: "Submit", checkStatus: "Check status", noItems: "No operations yet.",
      providerBlocked: "Provider configuration is missing. This operation is blocked.",
    },
    help: {
      title: "Offline and privacy",
      body: "Capture GPS and personal data only with consent. Local changes remain until sync is confirmed. Conflicts are never overwritten automatically.",
    },
    alerts: { required: "Complete all required fields.", saved: "Saved offline.", storageError: "Local data could not be stored safely." },
  },
  am: {
    languageName: "አማርኛ", languageCode: "አማ", chooseLanguage: "ቋንቋ ይምረጡ",
    languageHint: "ምርጫው በዚህ መሣሪያ ላይ ይቀመጣል።", close: "ዝጋ", brandSubtitle: "የቡና ማስረጃ",
    auth: {
      title: "ይግቡ", email: "ኢሜይል", password: "የይለፍ ቃል",
      organizationSlug: "የድርጅት አጭር መለያ (አማራጭ)", signIn: "ይግቡ",
      signOut: "ውጣ", selectOrganization: "ድርጅት ይምረጡ",
    },
    tabs: { home: "መነሻ", suppliers: "አጋሮች", plots: "መሬቶች", operations: "ሂደቶች", help: "እገዛ" },
    common: {
      save: "አስቀምጥ", create: "ፍጠር", refresh: "አድስ", retry: "እንደገና ሞክር", download: "አውርድ",
      share: "አጋራ", status: "ሁኔታ", name: "ስም", region: "ክልል", subjectId: "የማጣቀሻ መለያ",
      pending: "በመጠባበቅ ላይ", synced: "ተመሳስሏል", failed: "አልተሳካም", conflict: "ግጭት",
    },
    sync: {
      online: "መስመር ላይ", offline: "ከመስመር ውጭ", syncing: "በማመሳሰል ላይ ...", queued: "ተሰልፏል",
      lastSync: "የመጨረሻ ማመሳሰል", never: "አልተደረገም", syncNow: "አሁን አመሳስል",
      configured: "የጀርባ ስርዓት ተዋቅሯል", notConfigured: "የጀርባ ስርዓት አልተዋቀረም",
      notConfiguredDetail: "EXPO_PUBLIC_API_URL የለም። ማመሳሰልና የአቅራቢ ሂደቶች ታግደዋል።",
      success: "ማመሳሰል ተጠናቋል", error: "ማመሳሰል አልተሳካም", conflicts: "የማመሳሰል ግጭቶች",
      keepLocal: "የአካባቢውን ስሪት አቆይ", useServer: "የሰርቨር ስሪት ተጠቀም",
    },
    home: {
      title: "የመስክ አጠቃላይ እይታ", intro: "ከመስመር ውጭ መዝግብ፣ በደህንነት አመሳስል እና የተገዢነት ሂደቶችን ተከታተል።",
      suppliers: "አቅራቢዎች", plots: "የቡና መሬቶች", documents: "ሰነዶች",
    },
    suppliers: {
      title: "አቅራቢዎች", description: "አቅራቢዎች ከመስመር ውጭ ይፈጠራሉ እና በመላኪያ ወረፋ ይመሳሰላሉ።",
      add: "አቅራቢ ጨምር", empty: "ገና አቅራቢ የለም።", producerCount: "አምራቾች", plotCount: "መሬቶች",
    },
    plots: {
      title: "GeoJSON መሬቶች", description: "ቢያንስ ሶስት GPS ነጥቦችን መዝግብ ወይም GeoJSON Polygon አስገባና አርትዕ።",
      producer: "አምራች", farm: "የመሬት ወይም የእርሻ ስም", area: "ስፋት (ሄክታር)",
      supplierId: "የአቅራቢ መለያ (አማራጭ)", capturePoint: "GPS ነጥብ ጨምር", pointCount: "ነጥቦች",
      polygonJson: "GeoJSON Polygon", importGeoJson: "GeoJSON አስገባ", applyGeoJson: "GeoJSON ተግብር",
      saveDraft: "መሬቱን ከመስመር ውጭ አስቀምጥ", empty: "ገና የመሬት ረቂቅ የለም።",
      invalidPolygon: "ፖሊጎኑ ትክክል አይደለም። ቢያንስ ሶስት የተለያዩ ቦታዎች ያስፈልጋሉ።",
      gpsError: "የአሁኑን ቦታ ማወቅ አልተቻለም።", permissionError: "የቦታ ፈቃድ አልተሰጠም።",
      geofence: "Geofence", geofencePending: "በመጠባበቅ ላይ", geofenceInside: "ውስጥ",
      geofenceOutside: "ውጭ", geofenceReview: "ምርመራ ያስፈልጋል",
      geofenceApproved: "ጸድቋል", geofenceBlocked: "በአካባቢው ታግዷል፤ የጀርባ ስርዓቱ የመጨረሻ ውሳኔ ይሰጣል።",
    },
    operations: {
      title: "የተገዢነት ሂደቶች", documents: "ሰነዶች", pickUpload: "ሰነድ ምረጥና ስቀል",
      satellite: "የሳተላይት ትንተና", requestSatellite: "ትንተና ጠይቅ", evidence: "የማስረጃ ጥቅል",
      requestEvidence: "የማስረጃ ጥቅል ጠይቅ", dds: "የDDS ረቂቅ", createDds: "የDDS ረቂቅ ፍጠር",
      validateDds: "አረጋግጥ", submitDds: "አስገባ", checkStatus: "ሁኔታን አረጋግጥ",
      noItems: "ገና ሂደት የለም።", providerBlocked: "የአቅራቢ ውቅር የለም። ይህ ሂደት ታግዷል።",
    },
    help: {
      title: "ከመስመር ውጭ እና ግላዊነት",
      body: "GPS እና የግል መረጃን በፈቃድ ብቻ ይመዝግቡ። የአካባቢ ለውጦች ማመሳሰል እስኪረጋገጥ ይቆያሉ። ግጭቶች በራስ-ሰር አይተኩም።",
    },
    alerts: { required: "እባክዎ ሁሉንም አስፈላጊ መስኮች ይሙሉ።", saved: "ከመስመር ውጭ ተቀምጧል።", storageError: "የአካባቢ ውሂብ በደህንነት ሊቀመጥ አልቻለም።" },
  },
  ti: {
    languageName: "ትግርኛ", languageCode: "ትግ", chooseLanguage: "ቋንቋ ምረጹ",
    languageHint: "እቲ ምርጫ ኣብዚ መሳርሒ ይዕቀብ።", close: "ዕጸው", brandSubtitle: "መርትዖ ቡን",
    auth: {
      title: "እቶ", email: "ኢመይል", password: "መሕለፊ ቃል",
      organizationSlug: "ሓጺር መለለዪ ትካል (ኣማራጺ)", signIn: "እቶ",
      signOut: "ውጻእ", selectOrganization: "ትካል ምረጽ",
    },
    tabs: { home: "መበገሲ", suppliers: "መሻርኽቲ", plots: "ግራውቲ", operations: "መስርሓት", help: "ሓገዝ" },
    common: {
      save: "ዓቅብ", create: "ፍጠር", refresh: "ኣሐድስ", retry: "ደጊምካ ፈትን", download: "ኣውርድ",
      share: "ኣካፍል", status: "ኩነታት", name: "ስም", region: "ክልል", subjectId: "መወከሲ መለለዪ",
      pending: "ይጽበ ኣሎ", synced: "ተመሳሲሉ", failed: "ኣይተዓወተን", conflict: "ግጭት",
    },
    sync: {
      online: "ኣብ መስመር", offline: "ካብ መስመር ወጻኢ", syncing: "ይመሳሰል ኣሎ ...", queued: "ተሰሪዑ",
      lastSync: "ናይ መወዳእታ ምትእስሳር", never: "ኣይተገብረን", syncNow: "ሕጂ ኣመሳስል",
      configured: "ስርዓተ-ድሕሪት ተዋቒሩ", notConfigured: "ስርዓተ-ድሕሪት ኣይተዋቐረን",
      notConfiguredDetail: "EXPO_PUBLIC_API_URL የለን። ምትእስሳርን ናይ ኣቕራቢ መስርሓትን ተዓጽዮም።",
      success: "ምትእስሳር ተዛዚሙ", error: "ምትእስሳር ኣይተዓወተን", conflicts: "ናይ ምትእስሳር ግጭታት",
      keepLocal: "ናይ መሳርሒ ስሪት ዓቅብ", useServer: "ናይ ሰርቨር ስሪት ተጠቐም",
    },
    home: {
      title: "ሓፈሻዊ እዋን መስክ", intro: "ካብ መስመር ወጻኢ መዝግቡ፣ ብውሕስነት ኣመሳስሉ፣ መስርሓት ምኽባር ሕጊ ተኸታተሉ።",
      suppliers: "ኣቕረብቲ", plots: "ግራውቲ ቡን", documents: "ሰነዳት",
    },
    suppliers: {
      title: "ኣቕረብቲ", description: "ኣቕረብቲ ካብ መስመር ወጻኢ ይፍጠሩን ብመስርዕ ልኡኽ ይመሳሰሉን።",
      add: "ኣቕራቢ ወስኽ", empty: "ገና ኣቕራቢ የለን።", producerCount: "ኣፍረይቲ", plotCount: "ግራውቲ",
    },
    plots: {
      title: "GeoJSON ግራውቲ", description: "እንተወሓደ ሰለስተ GPS ነጥቢ መዝግቡ ወይ GeoJSON Polygon ኣእትዉን ኣርሙን።",
      producer: "ኣፍራዪ", farm: "ስም ግራት ወይ ሕርሻ", area: "ስፍሓት (ሄክታር)",
      supplierId: "መለለዪ ኣቕራቢ (ኣማራጺ)", capturePoint: "ነጥቢ GPS ወስኽ", pointCount: "ነጥብታት",
      polygonJson: "GeoJSON Polygon", importGeoJson: "GeoJSON ኣእቱ", applyGeoJson: "GeoJSON ተግብር",
      saveDraft: "ግራት ካብ መስመር ወጻኢ ዓቅብ", empty: "ገና ንድፊ ግራት የለን።",
      invalidPolygon: "እቲ ፖሊጎን ቅኑዕ ኣይኮነን። እንተወሓደ ሰለስተ ዝተፈላለዩ ቦታታት የድልዩ።",
      gpsError: "እዋናዊ ቦታ ክፍለጥ ኣይከኣለን።", permissionError: "ፍቓድ ቦታ ኣይተዋህበን።",
      geofence: "Geofence", geofencePending: "ይጽበ ኣሎ", geofenceInside: "ውሽጢ",
      geofenceOutside: "ወጻኢ", geofenceReview: "ግምገማ የድሊ",
      geofenceApproved: "ጸዲቑ", geofenceBlocked: "ኣብ መሳርሒ ተዓጽዩ፤ ናይ መወዳእታ ውሳነ ናይ ሰርቨር እዩ።",
    },
    operations: {
      title: "መስርሓት ምኽባር ሕጊ", documents: "ሰነዳት", pickUpload: "ሰነድ ምረጽን ስቐልን",
      satellite: "ትንተና ሳተላይት", requestSatellite: "ትንተና ሕተት", evidence: "ጥርናፈ መርትዖ",
      requestEvidence: "ጥርናፈ መርትዖ ሕተት", dds: "ንድፊ DDS", createDds: "ንድፊ DDS ፍጠር",
      validateDds: "ኣረጋግጽ", submitDds: "ኣቕርብ", checkStatus: "ኩነታት ርአ",
      noItems: "ገና መስርሕ የለን።", providerBlocked: "ውቅር ኣቕራቢ የለን። እዚ መስርሕ ተዓጽዩ።",
    },
    help: {
      title: "ካብ መስመር ወጻኢን ብሕታውነትን",
      body: "GPSን ውልቃዊ ሓበሬታን ብፍቓድ ጥራይ መዝግቡ። ናይ መሳርሒ ለውጥታት ምትእስሳር ክሳብ ዝረጋገጽ ይጸንሑ። ግጭታት ብራስ-ሰር ኣይትክኡን።",
    },
    alerts: { required: "በጃኹም ኩሎም ዘድልዩ ቦታታት ምልኡ።", saved: "ካብ መስመር ወጻኢ ተዓቂቡ።", storageError: "ናይ መሳርሒ ዳታ ብውሕስነት ክዕቀብ ኣይከኣለን።" },
  },
} satisfies Record<Language, Translation>;

export function isLanguage(value: string | null): value is Language {
  return value !== null && (languages as readonly string[]).includes(value);
}
