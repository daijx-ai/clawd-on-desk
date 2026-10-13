"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeSessionKey, resolveSessionIdentity } = require("./session-key");

const DEFAULT_CODEX_PROFILE_ID = "default";
const CODEX_PROFILES_CONFIG_PATH = path.join(os.homedir(), ".clawd", "codex-profiles.json");
const MAX_ADDITIONAL_CODEX_PROFILES = 4;
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const LABEL_CONTROL_RE = /[\x00-\x1f\x7f-\x9f\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/g;
const PROFILE_CONFIG_KEYS = new Set(["id", "label", "home"]);

function normalizeHomePath(value, home = os.homedir()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const input = value.trim();
  let expanded = input;
  if (input === "~") expanded = home;
  else if (input.startsWith("~/") || input.startsWith("~\\")) expanded = path.join(home, input.slice(2));
  if (!path.isAbsolute(expanded)) return null;
  return path.resolve(expanded);
}

function normalizeProfileLabel(value) {
  if (typeof value !== "string") return null;
  const label = value.replace(LABEL_CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  if (!label) return null;
  const characters = Array.from(label);
  return characters.length > 48 ? characters.slice(0, 48).join("") : label;
}

function pathContains(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative)
    && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function normalizeCodexProfileConfig(config, options = {}) {
  const home = typeof options.home === "string" && path.isAbsolute(options.home)
    ? path.resolve(options.home)
    : os.homedir();
  const env = options.env && typeof options.env === "object" && !Array.isArray(options.env)
    ? options.env
    : process.env;
  const defaultHome = normalizeHomePath(env.CODEX_HOME, home) || path.join(home, ".codex");
  const profiles = [{
    id: DEFAULT_CODEX_PROFILE_ID,
    label: "Codex",
    home: defaultHome,
    isDefault: true,
    quotaSource: null,
  }];
  const failClosed = () => {
    if (typeof options.logWarn === "function") {
      options.logWarn("Clawd: local Codex profile config is invalid; using the default profile only.");
    }
    return profiles.map(Object.freeze);
  };

  if (config === undefined || config === null) return profiles.map(Object.freeze);
  if (!config || typeof config !== "object" || Array.isArray(config)
    || Object.keys(config).some((key) => key !== "profiles")
    || !Array.isArray(config.profiles)
    || config.profiles.length > MAX_ADDITIONAL_CODEX_PROFILES) return failClosed();

  const accepted = [];
  const ids = new Set([DEFAULT_CODEX_PROFILE_ID]);
  const labels = new Set(["codex"]);
  const homes = [defaultHome];
  for (const entry of config.profiles) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some((key) => !PROFILE_CONFIG_KEYS.has(key))) return failClosed();
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const label = normalizeProfileLabel(entry.label);
    const profileHome = normalizeHomePath(entry.home, home);
    const labelKey = label && label.toLocaleLowerCase();
    if (!PROFILE_ID_RE.test(id) || ids.has(id) || !label || labels.has(labelKey) || !profileHome) {
      return failClosed();
    }
    if (homes.some((existing) => pathContains(existing, profileHome) || pathContains(profileHome, existing))) {
      return failClosed();
    }
    ids.add(id);
    labels.add(labelKey);
    homes.push(profileHome);
    accepted.push({
      id,
      label,
      home: profileHome,
      isDefault: false,
      quotaSource: `codex-profile:${id}`,
    });
  }
  return profiles.concat(accepted).map(Object.freeze);
}

function loadCodexProfiles(options = {}) {
  const configPath = typeof options.configPath === "string"
    ? options.configPath
    : CODEX_PROFILES_CONFIG_PATH;
  const readFileSync = typeof options.readFileSync === "function"
    ? options.readFileSync
    : fs.readFileSync;
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      if (typeof options.logWarn === "function") {
        options.logWarn("Clawd: local Codex profile config is invalid; using the default profile only.");
      }
    }
    config = null;
  }
  return normalizeCodexProfileConfig(config, options);
}

function resolveCodexProfile(transcriptPath, profiles) {
  const configuredProfiles = Array.isArray(profiles) && profiles.length
    ? profiles
    : normalizeCodexProfileConfig(null);
  if (typeof transcriptPath === "string" && transcriptPath.trim()) {
    const normalizedTranscript = normalizeHomePath(transcriptPath, os.homedir());
    if (!normalizedTranscript) return null;
    const matches = configuredProfiles.filter((profile) => pathContains(profile.home, normalizedTranscript));
    if (matches.length === 1) return matches[0];
    return matches.length === 0 && configuredProfiles.length === 1
      ? configuredProfiles[0]
      : null;
  }

  return configuredProfiles.length === 1 ? configuredProfiles[0] : "ambiguous";
}

function codexProfileIdentity(rawSessionId, profile, fallback = "default") {
  const identity = resolveSessionIdentity(rawSessionId, "local", fallback);
  if (!profile || profile.id === DEFAULT_CODEX_PROFILE_ID) {
    return Object.freeze({
      ...identity,
      codexProfileId: DEFAULT_CODEX_PROFILE_ID,
      codexProfileLabel: "Codex",
      codexProfileIsDefault: true,
    });
  }
  return Object.freeze({
    ...identity,
    sessionId: makeSessionKey({
      profileId: "local",
      rawSessionId: `codex-profile:${profile.id}:${identity.rawSessionId}`,
    }),
    codexProfileId: profile.id,
    codexProfileLabel: profile.label,
    codexProfileIsDefault: false,
  });
}

module.exports = {
  CODEX_PROFILES_CONFIG_PATH,
  DEFAULT_CODEX_PROFILE_ID,
  MAX_ADDITIONAL_CODEX_PROFILES,
  codexProfileIdentity,
  loadCodexProfiles,
  normalizeCodexProfileConfig,
  normalizeHomePath,
  normalizeProfileLabel,
  pathContains,
  resolveCodexProfile,
};
