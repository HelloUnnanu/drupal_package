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

Releases are automated via `.github/workflows/release.yml`. Push a SemVer tag from `main` and a GitHub Release is created automatically.

```bash
# 1. Make sure code is merged and CI is green
git checkout main && git pull --ff-only

# 2. Pick the next tag
TAG=v1.2.0

# 3. Tag & push — the workflow does the rest
git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"
```

GitHub automatically exposes the source tarball at:

```
GET https://api.github.com/repos/Unnanu/drupal_package/tarball/<TAG>
```

No manual asset upload is required — `install.sh` pulls this tarball directly.

### Pre-release / release candidates

Tags containing a hyphen (e.g. `v1.2.0-rc.1`) are published as prereleases and do **not** take the "latest" slot. Consumers on the default install path stay on the last stable; opt-in with `--version v1.2.0-rc.1`.

---

## 3. What goes into the tarball

Anything committed to the repo at the tagged SHA. `install.sh` excludes these paths at copy time (they never reach the consumer's `modules/custom/dir_ai_search/`):

- `installer/`
- `react_source/`
- `.git`, `.github`, `.gitignore`, `.gitattributes`
- `RELEASE.md`, `README.md`

If you add a new dev-only directory (fixtures, docs, build tooling), add it to the `EXCLUDES` array in `installer/install.sh` **and** ship that update in the same release.

---

## 4. Smoke test before tagging

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

## 5. Consumer-facing commands (for reference)

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

## 6. Troubleshooting

| Symptom                                   | Likely cause / fix                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `Could not determine latest release tag`  | No releases exist yet, or wrong org — check `gh release list`.                    |
| `Neither docroot/ nor web/ found`         | User pointed `--target` at `docroot/` itself; should be the **project root**.     |
| `drush en` fails in DDEV                  | Project not started: `ddev start` then re-run `install.sh --force`.               |
| Upgrade skips unexpectedly                | `VERSION` marker already matches latest tag. Use `--force` or bump a new release. |
| `ai_search.api_base_url is missing`       | `secret.json` absent or empty. Re-run with `--api-url <url>`.                     |
