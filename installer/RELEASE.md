# Release & Maintenance Guide — `dir_ai_search`

Maintainer cheatsheet for cutting versions and keeping the `installer/install.sh` script operational for consumers. End users should never need this file.

---

## 1. Versioning (SemVer)

| Change type | Bump  | Example           |
| ----------- | ----- | ----------------- |
| Bug fix     | PATCH | `v1.0.0 → v1.0.1` |
| Feature     | MINOR | `v1.0.1 → v1.1.0` |
| Breaking    | MAJOR | `v1.1.0 → v2.0.0` |

"Breaking" = anything a consumer would notice after `--upgrade`: config schema changes, removed routes, renamed libraries, dropped Drupal core versions, changed backend API contract.

---

## 2. Cutting a release

Releases are **fully automated** by `.github/workflows/release.yml`. Pushing a SemVer tag is the only action required — the workflow creates a published, non-draft GitHub Release pointing at that tag.

From the repo root on `main`, with a clean working tree:

```bash
# 1. Make sure code is merged and CI is green
git checkout main && git pull --ff-only

# 2. Pick the next tag (SemVer)
TAG=v1.2.0

# 3. Tag & push — this triggers .github/workflows/release.yml
git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"
```

That's it. Within ~30 seconds the workflow run finishes and the release is live. GitHub automatically exposes the source tarball at:

```
GET https://api.github.com/repos/Unnanu/drupal_package/tarball/<TAG>
```

No manual asset upload is required — `install.sh` pulls this tarball directly.

### Watching the workflow

```bash
gh run list --workflow=release.yml --limit 5
gh run watch                       # interactive, picks the most recent run
```

If the workflow fails, the tag still exists but no release was published. Fix the issue, delete any partial release, and either re-run the workflow or delete and re-push the tag.

### Pre-release / release candidates

Tags containing a hyphen (`v1.2.0-rc.1`, `v2.0.0-beta.3`) are auto-detected by the workflow and published as prereleases — they are **not** marked "Latest", so `install.sh`'s default `/releases/latest` lookup keeps consumers on the last stable. Opt-in users pin via `--version vX.Y.Z-rc.N`.

### Adding richer release notes

The workflow generates minimal notes by default. To author custom notes, edit the release on GitHub after the workflow completes (`gh release edit <TAG> --notes-file notes.md`), or extend `release.yml` to read notes from a `CHANGELOG.md` block.

---

## 3. What goes into the tarball

Anything committed to the repo at the tagged SHA. `install.sh` excludes these paths at copy time (they never reach the consumer's `modules/custom/dir_ai_search/`):

- `installer/`
- `react_source/`
- `.git`, `.github`, `.gitignore`, `.gitattributes`
- `RELEASE.md`, `README.md`

If you add a new dev-only directory (fixtures, docs, build tooling), add it to the `EXCLUDES` array in `installer/install.sh` **and** ship that update in the same release.

---

## 4. Repository access & consumer distribution

`Unnanu/drupal_package` is **public**. `install.sh` calls the GitHub REST API anonymously — no PAT, no `Authorization` header, no embedded credentials.

### Why public + anonymous

- Anonymous public-repo calls don't expire — there's nothing to rotate.
- No risk of credential leakage in a script distributed to many consumers.
- Subject to GitHub's anonymous rate limit (60 req/h per IP), which is far above any real install workload.

### If the repo ever goes private again

The script no longer carries any PAT plumbing — it would need to be added back. The path is:

1. Generate a fine-grained, read-only PAT scoped to just this repo (`Contents: Read-only`, `Metadata: Read-only`).
2. In `install.sh`, add `GITHUB_PAT="github_pat_…"` near the config vars and modify `gh_curl()` to attach `-H "Authorization: Bearer $GITHUB_PAT"`.
3. Ship as a PATCH release.
4. Plan rotation every 90 days; consumers on older `install.sh` copies will hit `401` once the PAT expires and must re-download.

---

## 5. Smoke test before tagging

```bash
# Dry-run the installer against a throwaway DDEV project
cd /tmp && mkdir -p test-drupal/docroot/modules/custom && mkdir -p test-drupal/.ddev
bash path/to/install.sh \
  --api-url https://api.unnanu.ai \
  --target /tmp/test-drupal \
  --version vX.Y.Z \
  --force
ls /tmp/test-drupal/docroot/modules/custom/dir_ai_search
cat /tmp/test-drupal/docroot/modules/custom/dir_ai_search/VERSION
cat /tmp/test-drupal/secret.json
```

Expected:

- Module files are present, `installer/` is **not**.
- `VERSION` marker contains exactly the tag.
- `secret.json` at `/tmp/test-drupal/secret.json` contains `ai_search.api_base_url`.
- `drush en dir_ai_search` runs without error inside a real DDEV Drupal.

---

## 6. Consumer-facing commands (for reference)

```bash
# Install latest, injecting the API URL into secret.json
bash install.sh --api-url https://api.unnanu.ai

# Pin a specific version
bash install.sh --api-url https://api.unnanu.ai --version v1.1.0

# Upgrade to latest (updates secret.json only if --api-url is supplied)
bash install.sh --upgrade
bash install.sh --upgrade --api-url https://api.unnanu.ai

# Uninstall
bash install.sh --uninstall

# Scripted / non-interactive
bash install.sh --api-url https://api.unnanu.ai --target /path/to/project --force
```

---

## 7. Troubleshooting

| Symptom                                   | Likely cause / fix                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `404` on `/releases/latest`               | Release is in **Draft** state (invisible to the public API). Publish it: `gh release edit <TAG> --draft=false`.           |
| `404` on `/repos/.../releases/latest`     | No published releases at all — check `gh release list`. The workflow may have failed; inspect `gh run list`.               |
| `403 rate limit exceeded` on GitHub API   | Anonymous IP hit the 60 req/h cap. Wait an hour, or add a read-only PAT to `gh_curl()` (see §4).                          |
| `Could not determine latest release tag`  | No releases exist, or wrong org — check `gh release list`.                                                                 |
| `Neither docroot/ nor web/ found`         | User pointed `--target` at `docroot/` itself; should be the **project root**.                                              |
| `drush en` fails in DDEV                  | Project not started: `ddev start` then re-run `install.sh --force`.                                                        |
| Upgrade skips unexpectedly                | `VERSION` marker already matches latest tag. Use `--force` or bump a new release.                                          |
| Tag pushed but no release appears         | Workflow failed or didn't trigger. Check `gh run list --workflow=release.yml`. Tag must match `v*.*.*`.                    |
| `ai_search.api_base_url is missing`       | `secret.json` absent or empty. Re-run with `--api-url <url>`.                                                              |
