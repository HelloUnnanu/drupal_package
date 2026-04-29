# Release & Maintenance Guide — `dir_ai_search`

Maintainer cheatsheet for cutting versions and keeping the `installer/install.sh` script operational for consumers. End users should never need this file.

---

## 1. Versioning (SemVer)

| Change type | Bump  | Example          |
| ----------- | ----- | ---------------- |
| Bug fix     | PATCH | `v1.0.0 → v1.0.1`|
| Feature     | MINOR | `v1.0.1 → v1.1.0`|
| Breaking    | MAJOR | `v1.1.0 → v2.0.0`|

"Breaking" = anything a consumer would notice after `--upgrade`: config schema changes, removed routes, renamed libraries, dropped Drupal core versions, changed backend API contract.

---

## 2. Cutting a release

Releases are **fully automated** by `.github/workflows/release.yml`. Pushing a SemVer tag is the only action required — the workflow creates a published, non-draft GitHub Release pointing at that tag.

From the repo root on `main`, with a clean working tree:

```bash
# 1. Make sure code is merged and CI is green
git checkout main && git pull --ff-only

# 2. Pick the next tag (SemVer)
TAG=v1.1.0

# 3. Tag & push — this triggers .github/workflows/release.yml
git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"
```

That's it. Within ~30 seconds the workflow run finishes and the release is live at:

```
https://github.com/HelloUnnanu/drupal_package/releases/tag/<TAG>
```

GitHub automatically exposes the source tarball at:

```
GET https://api.github.com/repos/HelloUnnanu/drupal_package/tarball/<TAG>
```

No manual asset upload is required — `install.sh` pulls this tarball directly.

### Watching the workflow

```bash
gh run list --workflow=release.yml --limit 5
gh run watch                       # interactive, picks the most recent run
```

If the workflow fails, the tag still exists but no release was published. Fix the issue (usually permissions or workflow YAML), delete the GitHub-side release if a partial one was created, and either re-run the failed workflow or delete & re-push the tag.

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

## 4. PAT (GitHub Personal Access Token)

Because the repo is private, `install.sh` ships with an embedded **fine-grained PAT**, read-only, scoped to only this repo.

### Creating the PAT

1. https://github.com/settings/tokens?type=beta → **Generate new token**
2. **Resource owner**: `HelloUnnanu`
3. **Repository access**: *Only select repositories* → `HelloUnnanu/drupal_package`
4. **Permissions (Repository)**:
   - **Contents**: Read-only
   - **Metadata**: Read-only *(automatically selected)*
5. **Expiration**: 90 days (max practical).
6. Copy the token and paste it into `install.sh`:

   ```bash
   GITHUB_PAT="github_pat_XXXXXXXXXXXXXXXXXXXXXXXXXX"
   ```
7. Commit the change in a new release (`PATCH` bump).

### Why fine-grained + read-only

- Cannot push code, create releases, or read any other repo — worst-case leakage is source-read access to this one module.
- GitHub audit log records every call, scoped by token ID.

### Rotation

| Event                                    | Action                                              |
| ---------------------------------------- | --------------------------------------------------- |
| PAT nearing expiry (7 days before)       | Generate new PAT, ship as PATCH release             |
| Suspected leak                           | Revoke in GitHub settings immediately, then rotate  |
| Maintainer change (owner of the PAT)     | Revoke old PAT, generate under new owner, rotate    |
| Every 90 days (calendar reminder)        | Scheduled rotation even if no incident              |

After rotation, the old `install.sh` keeps working only until the previous PAT's expiry. Consumers on older copies will hit `401 Unauthorized` and must re-download `install.sh`.

### Distribution to consumers

Consumers download `install.sh` via the authenticated GitHub web UI (they must be collaborators or have org read access to browse the private repo). The PAT inside the script is not exposed on any public surface.

---

## 5. Smoke test before tagging

```bash
# Dry-run the installer against a throwaway DDEV project
cd /tmp && mkdir -p test-drupal/docroot/modules/custom && mkdir -p test-drupal/.ddev
bash path/to/install.sh --target /tmp/test-drupal --version vX.Y.Z --force
ls /tmp/test-drupal/docroot/modules/custom/dir_ai_search
cat /tmp/test-drupal/docroot/modules/custom/dir_ai_search/VERSION
```

Expected:

- Module files are present, `installer/` is **not**.
- `VERSION` marker contains exactly the tag.
- `drush en dir_ai_search` runs without error inside a real DDEV Drupal.

---

## 6. Consumer-facing commands (for reference)

```bash
bash install.sh                      # install latest into prompted path
bash install.sh --version v1.0.0     # pin a specific tag
bash install.sh --upgrade            # bump to latest (skips if already current)
bash install.sh --uninstall          # remove module + drush pmu
bash install.sh --target /path/to/project --force   # scripted/non-interactive
```

---

## 7. Troubleshooting

| Symptom                                   | Likely cause / fix                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `401 Unauthorized` on GitHub API          | PAT expired or revoked → maintainer ships a new release with a rotated PAT.       |
| `Could not determine latest release tag`  | No releases exist, or the repo/tag was renamed — check `gh release list`.         |
| `Neither docroot/ nor web/ found`         | User pointed `--target` at `docroot/` itself; should be the **project root**.     |
| `drush en` fails in DDEV                  | Project not started: `ddev start` then re-run `install.sh --force`.               |
| Upgrade skips unexpectedly                | `VERSION` marker already matches latest tag. Use `--force` or bump a new release. |
