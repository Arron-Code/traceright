import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SUPPORTED_LANGUAGES,
  translate,
  translations,
} from "../src/i18n.mjs";

test("all supported languages contain the same translation keys", () => {
  const reference = Object.keys(translations.de).sort();

  for (const language of SUPPORTED_LANGUAGES) {
    assert.deepEqual(Object.keys(translations[language]).sort(), reference);
  }
});

test("translation lookup resolves German, English, and Amharic", () => {
  assert.equal(translate("de", "nav.overview"), "Überblick");
  assert.equal(translate("en", "nav.overview"), "Overview");
  assert.equal(translate("am", "nav.overview"), "አጠቃላይ እይታ");
});

test("all translation keys referenced by the web UI exist", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const keyPattern =
    /data-(?:i18n|i18n-aria-label|i18n-content|title-key|toast-key)="([^"]+)"/g;
  const referencedKeys = [...html.matchAll(keyPattern)].map((match) => match[1]);

  assert.ok(referencedKeys.length > 0);

  for (const language of SUPPORTED_LANGUAGES) {
    const missingKeys = referencedKeys.filter(
      (key) => !Object.hasOwn(translations[language], key),
    );
    assert.deepEqual(missingKeys, [], `${language} is missing UI translation keys`);
  }
});
