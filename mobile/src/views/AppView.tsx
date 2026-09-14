import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ApiError,
  getApiBaseUrl,
  getCurrentAuthHeaders,
  getOperation,
  requestOperation,
  submitDds,
  uploadDocument,
  validateDds,
} from "../api";
import {
  closePolygon,
  createUuid,
  evaluatePlotGeofence,
  parsePolygon,
  type GeoJsonPolygon,
  type OperationalRequest,
  type PersistedState,
  type Plot,
  type Position,
  type Supplier,
  type SyncConflict,
} from "../domain";
import {
  languages,
  translations,
  type Language,
  type Translation,
} from "../i18n";
import type { AppController } from "../controllers/useAppController";

const palette = {
  ink: "#14251D",
  forest: "#1F5A43",
  dark: "#174735",
  paper: "#F4F2EA",
  panel: "#FFFEFA",
  line: "#DDE0D8",
  muted: "#68766F",
  lime: "#CADB84",
  amber: "#C88124",
  red: "#A64536",
  softGreen: "#DDEADF",
  softAmber: "#F8E8CE",
  softRed: "#F7DED9",
};

function statusLabel(status: string, t: Translation) {
  if (status === "synced" || status === "completed") return t.common.synced;
  if (status === "conflict") return t.common.conflict;
  if (status === "failed" || status === "not_configured") return t.common.failed;
  return t.common.pending;
}

function Button({
  label,
  icon,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Ionicons name={icon} size={18} color={secondary ? palette.forest : "#FFFFFF"} />
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  placeholder,
  keyboardType,
  autoCapitalize = "sentences",
  secureTextEntry = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad" | "number-pad" | "email-address";
  autoCapitalize?: "none" | "sentences";
  secureTextEntry?: boolean;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#98A29C"
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secureTextEntry}
        style={[styles.input, multiline && styles.textArea]}
        accessibilityLabel={label}
      />
    </View>
  );
}

function Badge({ status, t }: { status: string; t: Translation }) {
  const bad = status === "failed" || status === "conflict" || status === "not_configured";
  const good = status === "synced" || status === "completed" || status === "uploaded";
  return (
    <View style={[styles.badge, good && styles.badgeGood, bad && styles.badgeBad]}>
      <Text style={[styles.badgeText, good && styles.goodText, bad && styles.badText]}>
        {statusLabel(status, t)}
      </Text>
    </View>
  );
}

function GeofenceBadge({
  status,
  t,
}: {
  status: Plot["geofenceStatus"] | Plot["localGeofenceResult"];
  t: Translation;
}) {
  const labels = {
    pending: t.plots.geofencePending,
    inside: t.plots.geofenceInside,
    outside: t.plots.geofenceOutside,
    review_required: t.plots.geofenceReview,
    approved: t.plots.geofenceApproved,
  };
  const blocked = status === "outside" || status === "review_required";
  const good = status === "inside" || status === "approved";
  return (
    <View style={[styles.badge, good && styles.badgeGood, blocked && styles.badgeBad]}>
      <Text style={[styles.badgeText, good && styles.goodText, blocked && styles.badText]}>
        {t.plots.geofence}: {labels[status]}
      </Text>
    </View>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children}
    </View>
  );
}

function HomeScreen({ state, t }: { state: PersistedState; t: Translation }) {
  return (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{t.home.title}</Text>
        <Text style={styles.heroBody}>{t.home.intro}</Text>
        <View style={styles.metrics}>
          {[
            [t.home.suppliers, state.suppliers.length],
            [t.home.plots, state.plots.length],
            [t.home.documents, state.documents.length],
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.metric}>
              <Text style={styles.metricValue}>{value}</Text>
              <Text style={styles.metricLabel}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t.sync.lastSync}</Text>
        <Text style={styles.description}>
          {state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString() : t.sync.never}
        </Text>
        <Text style={styles.caption}>{state.outbox.length} {t.sync.queued}</Text>
      </View>
    </>
  );
}

function SuppliersScreen({
  state,
  update,
  t,
}: {
  state: PersistedState;
  update: (recipe: (current: PersistedState) => PersistedState) => void;
  t: Translation;
}) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");

  function addSupplier() {
    if (!name.trim() || !region.trim()) {
      Alert.alert(t.alerts.required);
      return;
    }
    const now = new Date().toISOString();
    const supplier: Supplier = {
      id: createUuid(),
      name: name.trim(),
      region: region.trim(),
      producerCount: 0,
      plotCount: 0,
      updatedAt: now,
      syncStatus: "pending",
    };
    update((current) => ({
      ...current,
      suppliers: [supplier, ...current.suppliers],
      outbox: [
        ...current.outbox,
        {
          id: createUuid(),
          idempotencyKey: createUuid(),
          entityType: "supplier",
          entityId: supplier.id,
          action: "upsert",
          payload: supplier,
          createdAt: now,
          attempts: 0,
        },
      ],
    }));
    setName("");
    setRegion("");
    Alert.alert(t.alerts.saved);
  }

  return (
    <>
      <Section title={t.suppliers.title} description={t.suppliers.description} />
      <View style={styles.card}>
        <Field label={t.common.name} value={name} onChangeText={setName} />
        <Field label={t.common.region} value={region} onChangeText={setRegion} />
        <Button label={t.suppliers.add} icon="person-add" onPress={addSupplier} />
      </View>
      {state.suppliers.length === 0 ? <Text style={styles.empty}>{t.suppliers.empty}</Text> : null}
      {state.suppliers.map((supplier) => (
        <View key={supplier.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{supplier.name}</Text>
              <Text style={styles.caption}>{supplier.region} · {supplier.id}</Text>
            </View>
            <Badge status={supplier.syncStatus} t={t} />
          </View>
          <Text style={styles.description}>
            {supplier.producerCount} {t.suppliers.producerCount} · {supplier.plotCount} {t.suppliers.plotCount}
          </Text>
        </View>
      ))}
    </>
  );
}

function PlotsScreen({
  state,
  update,
  t,
  organizationId,
}: {
  state: PersistedState;
  update: (recipe: (current: PersistedState) => PersistedState) => void;
  t: Translation;
  organizationId: string;
}) {
  const [producer, setProducer] = useState("");
  const [farm, setFarm] = useState("");
  const [area, setArea] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [points, setPoints] = useState<Position[]>([]);
  const [geoJsonText, setGeoJsonText] = useState("");
  const [polygon, setPolygon] = useState<GeoJsonPolygon | null>(null);
  const [locating, setLocating] = useState(false);

  function applyPolygonText(value = geoJsonText) {
    try {
      const next = parsePolygon(value);
      setPolygon(next);
      setPoints(next.coordinates[0].slice(0, -1));
      setGeoJsonText(JSON.stringify(next, null, 2));
    } catch {
      Alert.alert(t.plots.invalidPolygon);
    }
  }

  async function capturePoint() {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(t.plots.permissionError);
        return;
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const next: Position[] = [
        ...points,
        [location.coords.longitude, location.coords.latitude],
      ];
      setPoints(next);
      if (next.length >= 3) {
        const nextPolygon = closePolygon(next);
        setPolygon(nextPolygon);
        setGeoJsonText(JSON.stringify(nextPolygon, null, 2));
      }
    } catch {
      Alert.alert(t.plots.gpsError);
    } finally {
      setLocating(false);
    }
  }

  async function importGeoJson() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/geo+json", "application/json", "text/json"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    try {
      const text = await fetch(result.assets[0].uri).then((response) => response.text());
      setGeoJsonText(text);
      applyPolygonText(text);
    } catch {
      Alert.alert(t.plots.invalidPolygon);
    }
  }

  function savePlot() {
    if (!producer.trim() || !farm.trim() || !area.trim() || !polygon) {
      Alert.alert(t.alerts.required);
      return;
    }
    const parsedArea = Number(area.replace(",", "."));
    if (!Number.isFinite(parsedArea) || parsedArea <= 0) {
      Alert.alert(t.plots.invalidPolygon);
      return;
    }
    const now = new Date().toISOString();
    const localGeofenceResult = evaluatePlotGeofence(
      polygon,
      state.geofences.filter((item) => item.organizationId === organizationId),
    );
    const plot: Plot = {
      id: createUuid(),
      supplierId: supplierId.trim() || undefined,
      producer: producer.trim(),
      farmName: farm.trim(),
      areaHa: parsedArea.toFixed(2),
      polygon,
      localGeofenceResult,
      geofenceStatus: localGeofenceResult === "outside"
        ? "review_required"
        : localGeofenceResult,
      capturedAt: now,
      updatedAt: now,
      syncStatus: "pending",
    };
    update((current) => ({
      ...current,
      plots: [plot, ...current.plots],
      outbox: [
        ...current.outbox,
        {
          id: createUuid(),
          idempotencyKey: createUuid(),
          entityType: "plot",
          entityId: plot.id,
          action: "upsert",
          payload: plot,
          createdAt: now,
          attempts: 0,
        },
      ],
    }));
    setProducer("");
    setFarm("");
    setArea("");
    setSupplierId("");
    setPoints([]);
    setPolygon(null);
    setGeoJsonText("");
    Alert.alert(t.alerts.saved);
  }

  return (
    <>
      <Section title={t.plots.title} description={t.plots.description} />
      <View style={styles.card}>
        <Field label={t.plots.producer} value={producer} onChangeText={setProducer} />
        <Field label={t.plots.farm} value={farm} onChangeText={setFarm} />
        <Field label={t.plots.area} value={area} onChangeText={setArea} keyboardType="decimal-pad" />
        <Field label={t.plots.supplierId} value={supplierId} onChangeText={setSupplierId} />
        <Text style={styles.caption}>{t.plots.pointCount}: {points.length}</Text>
        <Button
          label={locating ? "GPS ..." : t.plots.capturePoint}
          icon="locate"
          onPress={() => void capturePoint()}
          secondary
          disabled={locating}
        />
        <Button label={t.plots.importGeoJson} icon="document-attach" onPress={() => void importGeoJson()} secondary />
        <Field
          label={t.plots.polygonJson}
          value={geoJsonText}
          onChangeText={setGeoJsonText}
          multiline
          placeholder='{"type":"Polygon","coordinates":[...]}'
        />
        <Button label={t.plots.applyGeoJson} icon="checkmark-circle" onPress={() => applyPolygonText()} secondary />
        <Button label={t.plots.saveDraft} icon="save" onPress={savePlot} />
      </View>
      {state.plots.length === 0 ? <Text style={styles.empty}>{t.plots.empty}</Text> : null}
      {state.plots.map((plot) => (
        <View key={plot.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{plot.farmName}</Text>
              <Text style={styles.caption}>{plot.producer} · {plot.areaHa} ha</Text>
            </View>
            <Badge status={plot.syncStatus} t={t} />
          </View>
          <View style={styles.buttonRow}>
            <GeofenceBadge status={plot.localGeofenceResult} t={t} />
            {plot.geofenceStatus !== plot.localGeofenceResult ? (
              <GeofenceBadge status={plot.geofenceStatus} t={t} />
            ) : null}
          </View>
          {plot.geofenceStatus === "outside" || plot.geofenceStatus === "review_required" ? (
            <Text style={styles.errorText}>{t.plots.geofenceBlocked}</Text>
          ) : null}
          <Text style={styles.mono}>{JSON.stringify(plot.polygon)}</Text>
        </View>
      ))}
    </>
  );
}

function OperationsScreen({
  state,
  update,
  t,
}: {
  state: PersistedState;
  update: (recipe: (current: PersistedState) => PersistedState) => void;
  t: Translation;
}) {
  const [subjectId, setSubjectId] = useState("");
  const configured = getApiBaseUrl() !== null;

  function providerError(error: unknown): string {
    if (error instanceof ApiError && error.code === "NOT_CONFIGURED") {
      return t.operations.providerBlocked;
    }
    return error instanceof Error ? error.message : String(error);
  }

  async function pickAndUpload() {
    if (!configured) {
      Alert.alert(t.sync.notConfigured, t.operations.providerBlocked);
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    const localId = createUuid();
    update((current) => ({
      ...current,
      documents: [{
        id: localId,
        fileName: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
        size: asset.size ?? 0,
        status: "uploading",
        createdAt: new Date().toISOString(),
      }, ...current.documents],
    }));
    try {
      const uploaded = await uploadDocument({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
        size: asset.size ?? 0,
        idempotencyKey: localId,
      });
      update((current) => ({
        ...current,
        documents: current.documents.map((document) =>
          document.id === localId
            ? { ...document, id: uploaded.id, status: "uploaded" }
            : document,
        ),
      }));
    } catch (error) {
      update((current) => ({
        ...current,
        documents: current.documents.map((document) =>
          document.id === localId ? { ...document, status: "failed" } : document,
        ),
      }));
      Alert.alert(t.common.failed, providerError(error));
    }
  }

  async function create(kind: OperationalRequest["kind"]) {
    if (!subjectId.trim()) {
      Alert.alert(t.alerts.required);
      return;
    }
    if (!configured) {
      Alert.alert(t.sync.notConfigured, t.operations.providerBlocked);
      return;
    }
    try {
      const result = await requestOperation(kind, subjectId.trim(), createUuid());
      update((current) => ({ ...current, operations: [result, ...current.operations] }));
    } catch (error) {
      Alert.alert(t.common.failed, providerError(error));
    }
  }

  async function refresh(operation: OperationalRequest) {
    try {
      const result = await getOperation(operation.kind, operation.id);
      update((current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === result.id ? result : item),
      }));
    } catch (error) {
      Alert.alert(t.common.failed, providerError(error));
    }
  }

  async function mutateDds(operation: OperationalRequest, action: "validate" | "submit") {
    try {
      const result = action === "validate"
        ? await validateDds(operation.id, createUuid())
        : await submitDds(operation.id, createUuid());
      update((current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === result.id ? result : item),
      }));
    } catch (error) {
      Alert.alert(t.common.failed, providerError(error));
    }
  }

  async function downloadAndShare(operation: OperationalRequest) {
    if (!operation.downloadUrl) return;
    try {
      const destination = new File(Paths.cache, `evidence-${operation.id}.json`);
      const headers = await getCurrentAuthHeaders();
      const file = await File.downloadFileAsync(operation.downloadUrl, destination, {
        headers,
        idempotent: true,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri);
      } else {
        Alert.alert(t.common.download, file.uri);
      }
    } catch (error) {
      Alert.alert(t.common.failed, providerError(error));
    }
  }

  return (
    <>
      <Section title={t.operations.title} />
      {!configured ? (
        <View style={styles.blocking}>
          <Ionicons name="warning" size={23} color={palette.red} />
          <View style={styles.flex}>
            <Text style={styles.blockingTitle}>{t.sync.notConfigured}</Text>
            <Text style={styles.description}>{t.sync.notConfiguredDetail}</Text>
          </View>
        </View>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t.operations.documents}</Text>
        <Button label={t.operations.pickUpload} icon="cloud-upload" onPress={() => void pickAndUpload()} disabled={!configured} />
        {state.documents.map((document) => (
          <View key={document.id} style={styles.listRow}>
            <View style={styles.flex}>
              <Text style={styles.itemTitle}>{document.fileName}</Text>
              <Text style={styles.caption}>{document.mimeType} · {document.size} B</Text>
            </View>
            <Badge status={document.status} t={t} />
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <Field label={t.common.subjectId} value={subjectId} onChangeText={setSubjectId} />
        <Text style={styles.cardTitle}>{t.operations.satellite}</Text>
        <Button label={t.operations.requestSatellite} icon="planet" onPress={() => void create("satellite")} disabled={!configured} />
        <Text style={styles.cardTitle}>{t.operations.evidence}</Text>
        <Button label={t.operations.requestEvidence} icon="archive" onPress={() => void create("evidence_pack")} disabled={!configured} />
        <Text style={styles.cardTitle}>{t.operations.dds}</Text>
        <Button label={t.operations.createDds} icon="document-text" onPress={() => void create("dds")} disabled={!configured} />
      </View>
      {state.operations.length === 0 ? <Text style={styles.empty}>{t.operations.noItems}</Text> : null}
      {state.operations.map((operation) => (
        <View key={operation.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{operation.kind.replace("_", " ")}</Text>
              <Text style={styles.caption}>{operation.subjectId} · {operation.id}</Text>
            </View>
            <Badge status={operation.status} t={t} />
          </View>
          {operation.status === "not_configured" ? (
            <Text style={styles.errorText}>{t.operations.providerBlocked}</Text>
          ) : null}
          {operation.message ? <Text style={styles.description}>{operation.message}</Text> : null}
          <Button label={t.operations.checkStatus} icon="refresh" onPress={() => void refresh(operation)} secondary />
          {operation.kind === "dds" ? (
            <View style={styles.buttonRow}>
              <Button label={t.operations.validateDds} icon="checkmark" onPress={() => void mutateDds(operation, "validate")} secondary />
              <Button label={t.operations.submitDds} icon="send" onPress={() => void mutateDds(operation, "submit")} />
            </View>
          ) : null}
          {operation.kind === "evidence_pack" && operation.downloadUrl ? (
            <Button label={`${t.common.download} / ${t.common.share}`} icon="share" onPress={() => void downloadAndShare(operation)} />
          ) : null}
        </View>
      ))}
    </>
  );
}

function ConflictCard({
  conflict,
  resolve,
  t,
}: {
  conflict: SyncConflict;
  resolve: (conflict: SyncConflict, choice: "local" | "remote") => void;
  t: Translation;
}) {
  return (
    <View style={styles.conflictCard}>
      <Text style={styles.blockingTitle}>{t.common.conflict}: {conflict.entityType}</Text>
      <Text style={styles.caption}>{conflict.entityId}</Text>
      <Text style={styles.mono}>Local: {JSON.stringify(conflict.local)}</Text>
      <Text style={styles.mono}>Server: {JSON.stringify(conflict.remote)}</Text>
      <View style={styles.buttonRow}>
        <Button label={t.sync.keepLocal} icon="phone-portrait" onPress={() => resolve(conflict, "local")} secondary />
        <Button label={t.sync.useServer} icon="cloud" onPress={() => resolve(conflict, "remote")} />
      </View>
    </View>
  );
}

function LanguageChooser({
  visible,
  language,
  onSelect,
  onClose,
  t,
}: {
  visible: boolean;
  language: Language;
  onSelect: (language: Language) => void;
  onClose: () => void;
  t: Translation;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.dialog}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{t.chooseLanguage}</Text>
              <Text style={styles.description}>{t.languageHint}</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t.close}>
              <Ionicons name="close" size={25} color={palette.ink} />
            </Pressable>
          </View>
          {languages.map((item) => (
            <Pressable
              key={item}
              onPress={() => onSelect(item)}
              style={[styles.language, item === language && styles.languageActive]}
              accessibilityRole="radio"
              accessibilityState={{ checked: item === language }}
            >
              <Text style={[styles.itemTitle, item === language && styles.languageText]}>
                {translations[item].languageCode} · {translations[item].languageName}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function LoginScreen({ controller }: { controller: AppController }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const { auth, t, configured } = controller;

  async function submit() {
    if (!email.trim() || !password) {
      Alert.alert(t.alerts.required);
      return;
    }
    try {
      await auth.login(email, password, organizationSlug);
    } catch {
      // The controller exposes a localized-screen-safe error string.
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.login}>
        <View style={styles.loginBrand}>
          <View style={styles.logo}><Text style={styles.logoText}>SC</Text></View>
          <Text style={styles.loginTitle}>SCTracker</Text>
          <Text style={styles.headerSub}>{t.brandSubtitle}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>{t.auth.title}</Text>
          {!configured ? <Text style={styles.errorText}>{t.sync.notConfiguredDetail}</Text> : null}
          <Field
            label={t.auth.email}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Field
            label={t.auth.password}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            secureTextEntry
          />
          <Field
            label={t.auth.organizationSlug}
            value={organizationSlug}
            onChangeText={setOrganizationSlug}
            autoCapitalize="none"
          />
          {auth.error ? <Text style={styles.errorText}>{auth.error}</Text> : null}
          <Button
            label={auth.busy ? `${t.auth.signIn} ...` : t.auth.signIn}
            icon="log-in"
            onPress={() => void submit()}
            disabled={auth.busy || !configured}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function OrganizationScreen({ controller }: { controller: AppController }) {
  const { auth, t } = controller;
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.login}>
        <View style={styles.card}>
          <Text style={styles.heading}>{t.auth.selectOrganization}</Text>
          {auth.session?.organizations.map((organization) => (
            <Button
              key={organization.id}
              label={organization.name}
              icon="business"
              onPress={() => void auth.selectOrganization(organization.id)}
              secondary
            />
          ))}
          {auth.error ? <Text style={styles.errorText}>{auth.error}</Text> : null}
          <Button label={t.auth.signOut} icon="log-out" onPress={() => void auth.logout()} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function OrganizationChooser({
  controller,
  visible,
  onClose,
}: {
  controller: AppController;
  visible: boolean;
  onClose: () => void;
}) {
  const { auth, t } = controller;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.dialog}>
          <Text style={styles.cardTitle}>{t.auth.selectOrganization}</Text>
          {auth.session?.organizations.map((organization) => (
            <Button
              key={organization.id}
              label={organization.name}
              icon="business"
              secondary={organization.id !== auth.session?.selectedOrganizationId}
              onPress={() => {
                void auth.selectOrganization(organization.id);
                onClose();
              }}
            />
          ))}
          <Button
            label={t.auth.signOut}
            icon="log-out"
            onPress={() => {
              void auth.logout();
              onClose();
            }}
          />
          <Button label={t.close} icon="close" onPress={onClose} secondary />
        </View>
      </View>
    </Modal>
  );
}

export function AppView({ controller }: { controller: AppController }) {
  const [languageOpen, setLanguageOpen] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const {
    auth,
    activeTab,
    setActiveTab,
    language,
    setLanguage,
    state,
    update,
    online,
    syncing,
    syncError,
    storageError,
    geofenceError,
    syncNow,
    resolveConflict,
    t,
    configured,
  } = controller;

  const screen = useMemo(() => {
    if (!state) return null;
    if (activeTab === "suppliers") return <SuppliersScreen state={state} update={update} t={t} />;
    if (activeTab === "plots") {
      return (
        <PlotsScreen
          state={state}
          update={update}
          t={t}
          organizationId={auth.session?.selectedOrganizationId ?? ""}
        />
      );
    }
    if (activeTab === "operations") return <OperationsScreen state={state} update={update} t={t} />;
    if (activeTab === "help") return <Section title={t.help.title} description={t.help.body} />;
    return <HomeScreen state={state} t={t} />;
  }, [activeTab, state, t, update, auth.session?.selectedOrganizationId]);

  if ((!state || !auth.ready) && !storageError && !auth.error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator style={styles.loader} size="large" color={palette.lime} />
      </SafeAreaView>
    );
  }

  if (!state || !auth.ready) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.login}>
          <View style={styles.blocking}>
            <Ionicons name="warning" size={23} color={palette.red} />
            <Text style={styles.errorText}>{storageError ?? auth.error}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!auth.session) {
    return <LoginScreen controller={controller} />;
  }

  if (!auth.session.selectedOrganizationId) {
    return <OrganizationScreen controller={controller} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.logo}><Text style={styles.logoText}>SC</Text></View>
        <View style={styles.flex}>
          <Text style={styles.brand}>SCTracker</Text>
          <Text style={styles.headerSub}>{t.brandSubtitle}</Text>
        </View>
        <View style={[styles.connectivity, !configured && styles.connectivityBlocked]}>
          <View style={[styles.dot, !online && styles.dotOffline]} />
          <Text style={styles.connectivityText}>
            {!configured ? t.sync.notConfigured : online ? t.sync.online : t.sync.offline}
          </Text>
        </View>
        <Pressable
          style={styles.languageButton}
          onPress={() => setOrganizationOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t.auth.selectOrganization}
        >
          <Ionicons name="business" size={20} color="#FFFFFF" />
        </Pressable>
        <Pressable
          style={styles.languageButton}
          onPress={() => setLanguageOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t.chooseLanguage}
        >
          <Ionicons name="language" size={20} color="#FFFFFF" />
          <Text style={styles.languageCode}>{t.languageCode}</Text>
        </Pressable>
      </View>
      <View style={styles.syncBar}>
        <Text style={[styles.syncText, syncError && styles.errorText]} numberOfLines={2}>
          {syncing ? t.sync.syncing : syncError ?? `${state.outbox.length} ${t.sync.queued}`}
        </Text>
        <Button
          label={syncing ? t.sync.syncing : syncError ? t.common.retry : t.sync.syncNow}
          icon={syncError ? "refresh" : "cloud-upload"}
          onPress={() => void syncNow()}
          secondary
          disabled={syncing || !online || !configured}
        />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {storageError || geofenceError || auth.error ? (
          <View style={styles.blocking}>
            <Ionicons name="warning" size={23} color={palette.red} />
            <View style={styles.flex}>
              {storageError ? <Text style={styles.errorText}>{storageError}</Text> : null}
              {geofenceError ? <Text style={styles.errorText}>{geofenceError}</Text> : null}
              {auth.error ? <Text style={styles.errorText}>{auth.error}</Text> : null}
            </View>
          </View>
        ) : null}
        {!configured ? (
          <View style={styles.blocking}>
            <Ionicons name="warning" size={23} color={palette.red} />
            <View style={styles.flex}>
              <Text style={styles.blockingTitle}>{t.sync.notConfigured}</Text>
              <Text style={styles.description}>{t.sync.notConfiguredDetail}</Text>
            </View>
          </View>
        ) : null}
        {state.conflicts.length > 0 ? (
          <Section title={t.sync.conflicts}>
            {state.conflicts.map((conflict) => (
              <ConflictCard key={conflict.id} conflict={conflict} resolve={resolveConflict} t={t} />
            ))}
          </Section>
        ) : null}
        {screen}
      </ScrollView>
      <View style={styles.tabs}>
        {([
          ["home", "home", t.tabs.home],
          ["suppliers", "people", t.tabs.suppliers],
          ["plots", "map", t.tabs.plots],
          ["operations", "briefcase", t.tabs.operations],
          ["help", "help-circle", t.tabs.help],
        ] as const).map(([tab, icon, label]) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
          >
            <Ionicons name={activeTab === tab ? icon : `${icon}-outline`} size={21} color={activeTab === tab ? palette.forest : palette.muted} />
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]} numberOfLines={1}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <LanguageChooser
        visible={languageOpen}
        language={language}
        onClose={() => setLanguageOpen(false)}
        onSelect={(next) => {
          void setLanguage(next).catch(() => Alert.alert(translations[next].alerts.storageError));
          setLanguageOpen(false);
        }}
        t={t}
      />
      <OrganizationChooser
        controller={controller}
        visible={organizationOpen}
        onClose={() => setOrganizationOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, paddingTop: Platform.OS === "android" ? NativeStatusBar.currentHeight : 0, backgroundColor: palette.ink },
  loader: { flex: 1 },
  login: { flex: 1, justifyContent: "center", gap: 24, padding: 24, backgroundColor: palette.paper },
  loginBrand: { alignItems: "center", gap: 8 },
  loginTitle: { color: palette.ink, fontSize: 28, fontWeight: "900" },
  header: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14, backgroundColor: palette.ink },
  logo: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: palette.lime },
  logoText: { color: palette.ink, fontWeight: "900" },
  brand: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  headerSub: { color: "#AFC0B7", fontSize: 9 },
  flex: { flex: 1 },
  connectivity: { maxWidth: 100, flexDirection: "row", alignItems: "center", gap: 5, padding: 7, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.1)" },
  connectivityBlocked: { backgroundColor: "rgba(166,69,54,0.35)" },
  connectivityText: { flexShrink: 1, color: "#FFFFFF", fontSize: 8, fontWeight: "700" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.lime },
  dotOffline: { backgroundColor: palette.amber },
  languageButton: { minWidth: 45, height: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.1)" },
  languageCode: { color: "#FFFFFF", fontSize: 8, fontWeight: "800" },
  syncBar: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, backgroundColor: palette.softGreen },
  syncText: { flex: 1, color: palette.forest, fontSize: 10, fontWeight: "700" },
  scroll: { flex: 1, backgroundColor: palette.paper },
  content: { gap: 13, padding: 15, paddingBottom: 28 },
  section: { gap: 8, marginBottom: 3 },
  heading: { color: palette.ink, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }), fontSize: 25, fontWeight: "700" },
  description: { color: palette.muted, fontSize: 11, lineHeight: 17 },
  hero: { gap: 12, padding: 21, borderRadius: 18, backgroundColor: palette.dark },
  heroTitle: { color: "#FFFFFF", fontSize: 25, fontWeight: "800" },
  heroBody: { color: "#D7E1DB", fontSize: 12, lineHeight: 19 },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, padding: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.09)" },
  metricValue: { color: palette.lime, fontSize: 21, fontWeight: "900" },
  metricLabel: { color: "#FFFFFF", fontSize: 9 },
  card: { gap: 10, padding: 16, borderWidth: 1, borderColor: palette.line, borderRadius: 14, backgroundColor: palette.panel },
  cardTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  itemTitle: { color: palette.ink, fontSize: 12, fontWeight: "700" },
  caption: { color: palette.muted, fontSize: 9, lineHeight: 14 },
  label: { marginBottom: 5, color: palette.ink, fontSize: 10, fontWeight: "700" },
  input: { minHeight: 45, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.line, borderRadius: 9, color: palette.ink, backgroundColor: "#FFFFFF", fontSize: 12 },
  textArea: { minHeight: 130, paddingTop: 10, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), textAlignVertical: "top" },
  button: { minHeight: 45, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: palette.forest },
  buttonSecondary: { borderWidth: 1, borderColor: palette.forest, backgroundColor: "#FFFFFF" },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", textAlign: "center" },
  buttonTextSecondary: { color: palette.forest },
  buttonRow: { flexDirection: "row", gap: 8 },
  rowBetween: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 9 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: palette.line },
  empty: { padding: 18, color: palette.muted, textAlign: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, backgroundColor: palette.softAmber },
  badgeGood: { backgroundColor: palette.softGreen },
  badgeBad: { backgroundColor: palette.softRed },
  badgeText: { color: "#83530C", fontSize: 8, fontWeight: "800" },
  goodText: { color: palette.forest },
  badText: { color: palette.red },
  blocking: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderWidth: 1, borderColor: palette.red, borderRadius: 12, backgroundColor: palette.softRed },
  blockingTitle: { color: palette.red, fontSize: 12, fontWeight: "900" },
  conflictCard: { gap: 8, padding: 13, borderWidth: 1, borderColor: palette.red, borderRadius: 10, backgroundColor: palette.softRed },
  errorText: { color: palette.red, fontSize: 10, fontWeight: "700" },
  mono: { color: palette.muted, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 8, lineHeight: 12 },
  tabs: { minHeight: 70, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.panel },
  tab: { flex: 1, alignItems: "center", gap: 3, paddingHorizontal: 2 },
  tabText: { color: palette.muted, fontSize: 7, fontWeight: "600" },
  tabTextActive: { color: palette.forest, fontWeight: "900" },
  modal: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(10,25,18,0.65)" },
  dialog: { gap: 9, padding: 19, borderRadius: 16, backgroundColor: palette.panel },
  language: { minHeight: 48, justifyContent: "center", paddingHorizontal: 13, borderWidth: 1, borderColor: palette.line, borderRadius: 9 },
  languageActive: { borderColor: palette.forest, backgroundColor: palette.forest },
  languageText: { color: "#FFFFFF" },
});
