"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveSessionIdentity } = require("../src/session-key");
const {
  codexProfileIdentity,
  loadCodexProfiles,
  normalizeCodexProfileConfig,
  resolveCodexProfile,
} = require("../src/codex-profiles");

// Absolute fixture paths must use the host platform's separators and drive.
const TEST_HOME = path.join(os.tmpdir(), "clawd-codex-profiles-fixtures");

test("default profile preserves the existing home and optional profiles are validated and labeled", () => {
  const profiles = normalizeCodexProfileConfig({
    profiles: [{ id: "company", label: " Company ", home: "~/work-codex" }],
  }, { home: TEST_HOME, env: { CODEX_HOME: path.join(TEST_HOME, "personal-codex") } });

  assert.deepEqual(profiles.map(({ id, label, home, isDefault, quotaSource }) =>
    ({ id, label, home, isDefault, quotaSource })), [
    {
      id: "default",
      label: "Codex",
      home: path.join(TEST_HOME, "personal-codex"),
      isDefault: true,
      quotaSource: null,
    },
    {
      id: "company",
      label: "Company",
      home: path.join(TEST_HOME, "work-codex"),
      isDefault: false,
      quotaSource: "codex-profile:company",
    },
  ]);
});

test("invalid, duplicate, overlapping, or credential-shaped profile config fails closed", () => {
  const home = TEST_HOME;
  const work = path.join(home, "..", "work");
  const invalid = [
    { profiles: [{ id: "../work", label: "Work", home: work }] },
    { profiles: [{ id: "work", label: "Work", home: "relative" }] },
    { profiles: [{ id: "work", label: "Work", home: path.join(home, ".codex", "sessions") }] },
    { profiles: [{ id: "work", label: "Codex", home: work }] },
    { profiles: [{ id: "work", label: "Work", home: work, token: "ignored" }] },
    { profiles: [{ id: "work", label: "Work", home: work },
      { id: "work", label: "Again", home: path.join(home, "..", "again") }] },
    { profiles: [{ id: "work", label: "Work", home: work },
      { id: "again", label: "Again", home: path.join(work, "nested") }] },
  ];
  for (const config of invalid) {
    assert.deepEqual(normalizeCodexProfileConfig(config, { home, env: {} }).map((profile) => profile.id), ["default"]);
  }
});

test("loader treats a missing file as default and malformed JSON as fail-closed", () => {
  const configPath = path.join(TEST_HOME, ".clawd", "codex-profiles.json");
  const missing = loadCodexProfiles({
    home: TEST_HOME,
    env: {},
    configPath,
    readFileSync: () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
  });
  assert.equal(missing.length, 1);

  const malformed = loadCodexProfiles({
    home: TEST_HOME,
    env: {},
    configPath,
    readFileSync: () => "{ invalid",
  });
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].home, path.join(TEST_HOME, ".codex"));
});

test("profile identities isolate matching raw session ids while retaining their display id", () => {
  const [personal, company] = normalizeCodexProfileConfig({
    profiles: [{ id: "company", label: "Company", home: path.join(TEST_HOME, ".codex-company") }],
  }, { home: TEST_HOME, env: {} });
  const a = codexProfileIdentity("same-session", personal);
  const b = codexProfileIdentity("same-session", company);

  assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(a.rawSessionId, b.rawSessionId);
  assert.equal(b.codexProfileId, "company");
  assert.equal(b.codexProfileLabel, "Company");
  assert.equal(b.codexProfileIsDefault, false);
});

test("profile resolution uses transcript ownership and rejects profile-less hooks", () => {
  const profiles = normalizeCodexProfileConfig({
    profiles: [{ id: "company", label: "Company", home: path.join(TEST_HOME, ".codex-company") }],
  }, { home: TEST_HOME, env: {} });
  assert.equal(resolveCodexProfile(path.join(TEST_HOME, ".codex-company", "sessions", "a.jsonl"), profiles), profiles[1]);
  assert.equal(resolveCodexProfile(path.join(TEST_HOME, ".codex-company-other", "sessions", "a.jsonl"), profiles), null);
  assert.equal(resolveCodexProfile(null, profiles), "ambiguous");
});

test("single-profile routing preserves legacy custom transcript paths", () => {
  const profiles = normalizeCodexProfileConfig(null, {
    home: TEST_HOME,
    env: { CODEX_HOME: path.join(TEST_HOME, "custom-codex") },
  });

  assert.equal(profiles[0].home, path.join(TEST_HOME, "custom-codex"));
  assert.equal(resolveCodexProfile(path.join(TEST_HOME, "synthetic", "legacy-session.jsonl"), profiles), profiles[0]);
  assert.equal(resolveCodexProfile(null, profiles), profiles[0]);
});

test("zero-config preserves the legacy local session identity and quota source", () => {
  const rawId = "codex:legacy-session";
  const [defaultProfile] = normalizeCodexProfileConfig(undefined, { home: TEST_HOME, env: {} });
  assert.equal(defaultProfile.quotaSource, null);
  assert.equal(defaultProfile.id, "default");
  assert.equal(codexProfileIdentity(rawId, defaultProfile).sessionId,
    resolveSessionIdentity(rawId, "local").sessionId);
  assert.equal(resolveCodexProfile(null, [defaultProfile]), defaultProfile);
  assert.equal(resolveCodexProfile(path.join(TEST_HOME, "unexpected.jsonl"), [defaultProfile]), defaultProfile);
});

test("symlinked homes cannot duplicate or overlap a physical Codex home", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-codex-realpath-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const defaultHome = path.join(root, "personal");
  const aliasHome = path.join(root, "company-alias");
  fs.mkdirSync(defaultHome);
  fs.symlinkSync(defaultHome, aliasHome, process.platform === "win32" ? "junction" : "dir");
  const options = { home: root, env: { CODEX_HOME: defaultHome } };
  for (const home of [aliasHome, path.join(aliasHome, "sessions")]) {
    const profiles = normalizeCodexProfileConfig({
      profiles: [{ id: "company", label: "Company", home }],
    }, options);
    assert.deepEqual(profiles.map((profile) => profile.id), ["default"]);
  }
});

test("transcript ownership resolves real paths and symlink aliases identically", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-codex-ownership-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const defaultHome = path.join(root, "personal");
  const companyHome = path.join(root, "company");
  const aliasHome = path.join(root, "company-alias");
  fs.mkdirSync(defaultHome);
  fs.mkdirSync(companyHome);
  fs.symlinkSync(companyHome, aliasHome, process.platform === "win32" ? "junction" : "dir");
  const profiles = normalizeCodexProfileConfig({
    profiles: [{ id: "company", label: "Company", home: aliasHome }],
  }, { home: root, env: { CODEX_HOME: defaultHome } });
  assert.equal(profiles.length, 2);
  assert.equal(resolveCodexProfile(path.join(companyHome, "sessions", "a.jsonl"), profiles), profiles[1]);
  assert.equal(resolveCodexProfile(path.join(aliasHome, "sessions", "a.jsonl"), profiles), profiles[1]);
});

test("profile configuration reads only its JSON config, never credentials or tokens", () => {
  const configPath = path.join(TEST_HOME, ".clawd", "codex-profiles.json");
  const readPaths = [];
  const profiles = loadCodexProfiles({
    home: TEST_HOME,
    env: {},
    configPath,
    readFileSync(file) {
      readPaths.push(file);
      assert.equal(file, configPath, "only profile metadata configuration may be read");
      return JSON.stringify({ profiles: [
        { id: "company", label: "Company", home: path.join(TEST_HOME, "company") },
      ] });
    },
  });
  assert.equal(profiles.length, 2);
  assert.deepEqual(readPaths, [configPath]);
});
