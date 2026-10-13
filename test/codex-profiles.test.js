"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  codexProfileIdentity,
  loadCodexProfiles,
  normalizeCodexProfileConfig,
  resolveCodexProfile,
} = require("../src/codex-profiles");

test("default profile preserves the existing home and optional profiles are validated and labeled", () => {
  const profiles = normalizeCodexProfileConfig({
    profiles: [{ id: "company", label: " Company ", home: "~/work-codex" }],
  }, { home: "/users/test", env: { CODEX_HOME: "/users/test/personal-codex" } });

  assert.deepEqual(profiles.map(({ id, label, home, isDefault, quotaSource }) =>
    ({ id, label, home, isDefault, quotaSource })), [
    {
      id: "default",
      label: "Codex",
      home: "/users/test/personal-codex",
      isDefault: true,
      quotaSource: null,
    },
    {
      id: "company",
      label: "Company",
      home: "/users/test/work-codex",
      isDefault: false,
      quotaSource: "codex-profile:company",
    },
  ]);
});

test("invalid, duplicate, overlapping, or credential-shaped profile config fails closed", () => {
  const home = "/users/test";
  const invalid = [
    { profiles: [{ id: "../work", label: "Work", home: "/users/work" }] },
    { profiles: [{ id: "work", label: "Work", home: "relative" }] },
    { profiles: [{ id: "work", label: "Work", home: "/users/test/.codex/sessions" }] },
    { profiles: [{ id: "work", label: "Codex", home: "/users/work" }] },
    { profiles: [{ id: "work", label: "Work", home: "/users/work", token: "ignored" }] },
    { profiles: [{ id: "work", label: "Work", home: "/users/work" },
      { id: "work", label: "Again", home: "/users/again" }] },
    { profiles: [{ id: "work", label: "Work", home: "/users/work" },
      { id: "again", label: "Again", home: "/users/work/nested" }] },
  ];
  for (const config of invalid) {
    assert.deepEqual(normalizeCodexProfileConfig(config, { home, env: {} }).map((profile) => profile.id), ["default"]);
  }
});

test("loader treats a missing file as default and malformed JSON as fail-closed", () => {
  const missing = loadCodexProfiles({
    home: "/users/test",
    env: {},
    configPath: "/users/test/.clawd/codex-profiles.json",
    readFileSync: () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
  });
  assert.equal(missing.length, 1);

  const malformed = loadCodexProfiles({
    home: "/users/test",
    env: {},
    configPath: "/users/test/.clawd/codex-profiles.json",
    readFileSync: () => "{ invalid",
  });
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].home, path.join("/users/test", ".codex"));
});

test("profile identities isolate matching raw session ids while retaining their display id", () => {
  const [personal, company] = normalizeCodexProfileConfig({
    profiles: [{ id: "company", label: "Company", home: "/users/test/.codex-company" }],
  }, { home: "/users/test", env: {} });
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
    profiles: [{ id: "company", label: "Company", home: "/users/test/.codex-company" }],
  }, { home: "/users/test", env: {} });
  assert.equal(resolveCodexProfile("/users/test/.codex-company/sessions/a.jsonl", profiles), profiles[1]);
  assert.equal(resolveCodexProfile("/users/test/.codex-company-other/sessions/a.jsonl", profiles), null);
  assert.equal(resolveCodexProfile(null, profiles), "ambiguous");
});

test("single-profile routing preserves legacy custom transcript paths", () => {
  const profiles = normalizeCodexProfileConfig(null, {
    home: "/users/test",
    env: { CODEX_HOME: "/users/test/custom-codex" },
  });

  assert.equal(profiles[0].home, "/users/test/custom-codex");
  assert.equal(resolveCodexProfile("/synthetic/legacy-session.jsonl", profiles), profiles[0]);
  assert.equal(resolveCodexProfile(null, profiles), profiles[0]);
});
