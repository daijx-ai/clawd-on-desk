# Multiple local Codex profiles

Clawd uses `CODEX_HOME` when it resolves to a local absolute path; otherwise it monitors `~/.codex`. To monitor other local Codex homes at the same time, create `~/.clawd/codex-profiles.json` (on Windows, use `%USERPROFILE%\.clawd\codex-profiles.json`) and list the additional profiles:

```json
{
  "profiles": [
    {
      "id": "company",
      "label": "Company",
      "home": "~/.codex-work"
    }
  ]
}
```

Each profile needs a stable `id`, a unique display `label`, and a local Codex home path. Paths may use `~/...` or be absolute. Keep profile homes separate; nested or duplicate homes are rejected. Up to four additional profiles are supported. The resolved default home cannot be repeated in the list. Restart Clawd after editing the file.

Clawd reads each profile's local session logs and archive metadata. The Dashboard, Session HUD, quota views, and completion notifications show the configured label. Session state, pending permission associations, archive checks, and quota sources are separated by profile, including when two profiles reuse the same raw session ID.

Additional profile sessions are display-only for focus actions. A Codex deep link opens whichever profile is active in Codex, so Clawd leaves the focus action unavailable for non-default profiles instead of risking a jump to the wrong account. Permission requests without a transcript path are only associated when an existing session makes the profile unambiguous; otherwise Clawd hands the request back to Codex's native prompt.

The file contains only profile IDs, display labels, and paths. Do not add credentials. Clawd does not read Codex authentication files for this feature. If the file is missing, Clawd keeps the default single-profile behavior. An invalid file is ignored as a whole and Clawd uses only the default profile.
