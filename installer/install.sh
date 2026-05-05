#!/usr/bin/env bash
#
# dir_ai_search — one-command installer
# Installs / upgrades / uninstalls the private DIR AI Search Drupal module
# from GitHub Releases into a Drupal project under docroot/modules/custom/.
#
# Usage:
#   bash install.sh --api-url <url>                       # install latest
#   bash install.sh --api-url <url> --version v1.0.0      # pin a specific tag
#   bash install.sh --upgrade [--api-url <url>]           # upgrade to latest
#   bash install.sh --uninstall                           # remove module
#   bash install.sh --target <path>                       # non-interactive target
#   bash install.sh --force                               # overwrite existing install
#   bash install.sh --help
#
set -euo pipefail

# ---------- Config ----------
GITHUB_OWNER="HelloUnnanu"
GITHUB_REPO="drupal_package"
MODULE_NAME="dir_ai_search"

# Repo is public — no auth needed for GitHub API tarball downloads.
# If you ever flip this repo back to private, set a fine-grained read-only PAT here.
GITHUB_PAT=""

API_BASE="https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}"

# Files/dirs inside the release tarball that must NOT be copied into the
# installed module directory.
EXCLUDES=(
  "installer"
  "react_source"
  ".git"
  ".github"
  ".gitignore"
  ".gitattributes"
  "RELEASE.md"
  "README.md"
)

# ---------- Colors ----------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_DIM=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

log()   { printf "${C_BLUE}==>${C_RESET} %s\n" "$*"; }
ok()    { printf "${C_GREEN}✓${C_RESET}  %s\n" "$*"; }
warn()  { printf "${C_YELLOW}!${C_RESET}  %s\n" "$*" >&2; }
err()   { printf "${C_RED}✗${C_RESET}  %s\n" "$*" >&2; }
die()   { err "$*"; exit 1; }

# ---------- CLI args ----------
MODE="install"      # install | upgrade | uninstall
VERSION=""
TARGET=""
FORCE=0
API_URL=""

print_help() {
  cat <<EOF
${C_BOLD}dir_ai_search installer${C_RESET}

Usage:
  bash install.sh [--version <tag>] [--target <path>] [--force]
  bash install.sh --upgrade [--target <path>]
  bash install.sh --uninstall [--target <path>]
  bash install.sh --help

Options:
  --api-url <url>   AI Search API base URL (e.g. https://api.unnanu.ai).
                    Written into secret.json. Required for install; prompted if omitted.
                    Optional for upgrade — updates secret.json only when supplied.
  --version <tag>   Install a specific release tag (e.g. v1.0.0). Default: latest.
  --target <path>   Drupal project root (contains docroot/ or web/). Prompted if omitted.
  --upgrade         Upgrade the already-installed module to the latest tag.
  --uninstall       Uninstall the module (drush pmu + rm -rf).
  --force           Overwrite an existing install without prompting.
  --help            Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upgrade)    MODE="upgrade"; shift ;;
    --uninstall)  MODE="uninstall"; shift ;;
    --version)    VERSION="${2:-}"; shift 2 ;;
    --target)     TARGET="${2:-}"; shift 2 ;;
    --api-url)    API_URL="${2:-}"; shift 2 ;;
    --force)      FORCE=1; shift ;;
    -h|--help)    print_help; exit 0 ;;
    *)            die "Unknown argument: $1 (try --help)" ;;
  esac
done

# ---------- Step 2: dependency check ----------
check_deps() {
  log "Checking dependencies"
  command -v curl >/dev/null 2>&1 || die "curl is required but not installed."
  command -v tar  >/dev/null 2>&1 || die "tar is required but not installed."
  if command -v jq >/dev/null 2>&1; then
    HAS_JQ=1
  else
    HAS_JQ=0
    warn "jq not found — falling back to sed for JSON parsing."
  fi
  ok "curl, tar present ($([[ $HAS_JQ -eq 1 ]] && echo 'jq available' || echo 'jq missing, using sed'))"
}

# ---------- Step 3: resolve target ----------
expand_path() {
  local p="$1"
  # Expand leading ~
  if [[ "$p" == "~" || "$p" == "~/"* ]]; then
    p="${HOME}${p:1}"
  fi
  printf "%s" "$p"
}

resolve_target() {
  if [[ -z "$TARGET" ]]; then
    printf "${C_BOLD}Drupal project root${C_RESET} (path containing ${C_DIM}docroot/${C_RESET} or ${C_DIM}web/${C_RESET}): "
    read -r TARGET </dev/tty
  fi
  TARGET="$(expand_path "$TARGET")"
  [[ -d "$TARGET" ]] || die "Target directory does not exist: $TARGET"

  if   [[ -d "$TARGET/docroot" ]]; then DOCROOT="$TARGET/docroot"
  elif [[ -d "$TARGET/web"     ]]; then DOCROOT="$TARGET/web"
  else die "Neither docroot/ nor web/ found in: $TARGET"
  fi

  MODULE_DIR="$DOCROOT/modules/custom/$MODULE_NAME"
  mkdir -p "$DOCROOT/modules/custom"

  if [[ -d "$TARGET/.ddev" ]]; then
    HAS_DDEV=1
    ok "Detected DDEV project at $TARGET"
  else
    HAS_DDEV=0
    warn "No .ddev/ directory found. Drush will be invoked directly instead of via ddev."
  fi

  ok "Target resolved: $MODULE_DIR"
}

# ---------- Step 4: resolve version ----------
gh_curl() {
  local url="$1" out="$2"
  local headers=(-H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
  # Auth is optional. Public repo → anonymous calls work (60 req/hr per IP).
  # Private repo → set GITHUB_PAT above to a fine-grained read-only PAT.
  if [[ -n "$GITHUB_PAT" && "$GITHUB_PAT" != "__REPLACE_WITH_FINE_GRAINED_READONLY_PAT__" ]]; then
    headers+=(-H "Authorization: Bearer $GITHUB_PAT")
  fi
  curl -fsSL "${headers[@]}" -o "$out" "$url" \
    || die "GitHub API request failed: $url"
}

resolve_version() {
  if [[ -n "$VERSION" ]]; then
    ok "Using pinned version: $VERSION"
    return
  fi
  log "Resolving latest release tag"
  local tmp; tmp="$(mktemp)"
  gh_curl "${API_BASE}/releases/latest" "$tmp"

  if [[ $HAS_JQ -eq 1 ]]; then
    VERSION="$(jq -r '.tag_name' "$tmp")"
  else
    VERSION="$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp" | head -n1)"
  fi
  rm -f "$tmp"
  [[ -n "$VERSION" && "$VERSION" != "null" ]] \
    || die "Could not determine latest release tag. Does the repo have any releases?"
  ok "Latest release: $VERSION"
}

# ---------- Step 5: download + extract ----------
download_and_extract() {
  log "Downloading tarball for $VERSION"
  WORK_DIR="$(mktemp -d)"
  trap 'rm -rf "$WORK_DIR"' EXIT
  local tarball="$WORK_DIR/src.tar.gz"

  gh_curl "${API_BASE}/tarball/${VERSION}" "$tarball"

  tar -xzf "$tarball" -C "$WORK_DIR"
  # GitHub tarballs extract to a single top-level folder like OWNER-REPO-<sha>/
  EXTRACTED_DIR="$(find "$WORK_DIR" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  [[ -n "$EXTRACTED_DIR" && -d "$EXTRACTED_DIR" ]] \
    || die "Failed to locate extracted folder inside tarball."
  ok "Extracted to $EXTRACTED_DIR"
}

# ---------- Step 6: install files ----------
is_excluded() {
  local name="$1"
  for ex in "${EXCLUDES[@]}"; do
    [[ "$name" == "$ex" ]] && return 0
  done
  return 1
}

copy_module_files() {
  mkdir -p "$MODULE_DIR"
  local entry base
  for entry in "$EXTRACTED_DIR"/* "$EXTRACTED_DIR"/.[!.]* ; do
    [[ -e "$entry" ]] || continue
    base="$(basename "$entry")"
    if is_excluded "$base"; then
      continue
    fi
    cp -R "$entry" "$MODULE_DIR/"
  done
  printf "%s\n" "$VERSION" > "$MODULE_DIR/VERSION"
  ok "Installed files into $MODULE_DIR"
}

install_files() {
  if [[ -d "$MODULE_DIR" ]]; then
    if [[ $FORCE -ne 1 && "$MODE" == "install" ]]; then
      die "Module already installed at $MODULE_DIR. Use --upgrade or --force."
    fi
    log "Removing existing module directory"
    rm -rf "$MODULE_DIR"
  fi
  copy_module_files
}

# ---------- Step 7: activate ----------
drush() {
  if [[ $HAS_DDEV -eq 1 ]]; then
    ( cd "$TARGET" && ddev drush "$@" )
  else
    if command -v drush >/dev/null 2>&1; then
      ( cd "$DOCROOT" && command drush "$@" )
    else
      warn "drush not available on PATH and no DDEV detected. Skipping: drush $*"
      return 1
    fi
  fi
}

prompt_yn() {
  local prompt="$1" default="${2:-n}" reply
  local hint="[y/N]"; [[ "$default" == "y" ]] && hint="[Y/n]"
  printf "%s %s " "$prompt" "$hint"
  read -r reply </dev/tty || reply=""
  [[ -z "$reply" ]] && reply="$default"
  [[ "$reply" =~ ^[Yy]$ ]]
}

activate_module() {
  log "Enabling module via drush"
  drush en "$MODULE_NAME" -y || die "drush en $MODULE_NAME failed"
  ok "Module enabled"

  if [[ "$MODE" == "upgrade" ]]; then
    if prompt_yn "Run drush updb -y now?" "y"; then
      drush updb -y || warn "drush updb reported an error"
    fi
  fi

  if prompt_yn "Run drush cr (cache rebuild) now?" "y"; then
    drush cr || warn "drush cr reported an error"
  fi
}

# ---------- Step 8: secret.json ----------
prompt_api_url() {
  if [[ -z "$API_URL" ]]; then
    printf "${C_BOLD}AI Search API base URL${C_RESET} (e.g. https://api.unnanu.ai): "
    read -r API_URL </dev/tty
  fi
  [[ -n "$API_URL" ]] || die "--api-url is required for install."
}

write_secret_json() {
  local secret_file="$TARGET/secret.json"
  log "Writing API URL to $secret_file"
  if [[ $HAS_JQ -eq 1 ]]; then
    jq -n --arg url "$API_URL" '{"ai_search":{"api_base_url":$url}}' > "$secret_file"
  else
    printf '{\n  "ai_search": {\n    "api_base_url": "%s"\n  }\n}\n' "$API_URL" > "$secret_file"
  fi
  ok "secret.json written: ai_search.api_base_url = $API_URL"
}

configure_secret() {
  if [[ "$MODE" == "install" ]]; then
    prompt_api_url
    write_secret_json
  elif [[ "$MODE" == "upgrade" ]]; then
    if [[ -n "$API_URL" ]]; then
      write_secret_json
    elif [[ ! -f "$TARGET/secret.json" ]]; then
      warn "secret.json not found at $TARGET/secret.json. Pass --api-url to create it."
    fi
  fi
}

# ---------- Modes ----------
read_installed_version() {
  if [[ -f "$MODULE_DIR/VERSION" ]]; then
    tr -d '[:space:]' < "$MODULE_DIR/VERSION"
  else
    printf ""
  fi
}

do_install() {
  resolve_version
  download_and_extract
  install_files
  configure_secret
  activate_module
  ok "Install complete: $MODULE_NAME@$VERSION"
}

do_upgrade() {
  [[ -d "$MODULE_DIR" ]] || die "No existing install at $MODULE_DIR. Run without --upgrade first."
  local current; current="$(read_installed_version)"
  resolve_version
  if [[ -n "$current" && "$current" == "$VERSION" ]]; then
    ok "Already on $current — nothing to do."
    exit 0
  fi
  log "Upgrading ${current:-unknown} → $VERSION"
  download_and_extract
  FORCE=1
  install_files
  configure_secret
  activate_module
  ok "Upgrade complete: $MODULE_NAME@$VERSION"
}

do_uninstall() {
  [[ -d "$MODULE_DIR" ]] || die "No install found at $MODULE_DIR"
  if ! prompt_yn "Uninstall $MODULE_NAME from $MODULE_DIR?" "n"; then
    log "Aborted."
    exit 0
  fi
  log "Disabling module via drush pmu"
  drush pmu "$MODULE_NAME" -y || warn "drush pmu reported an error (continuing)"
  log "Removing $MODULE_DIR"
  rm -rf "$MODULE_DIR"
  if prompt_yn "Run drush cr (cache rebuild) now?" "y"; then
    drush cr || warn "drush cr reported an error"
  fi
  ok "Uninstalled $MODULE_NAME"
}

# ---------- Main ----------
main() {
  printf "${C_BOLD}dir_ai_search installer${C_RESET} — mode: ${C_BOLD}%s${C_RESET}\n" "$MODE"
  check_deps
  resolve_target
  case "$MODE" in
    install)   do_install ;;
    upgrade)   do_upgrade ;;
    uninstall) do_uninstall ;;
    *)         die "Unknown mode: $MODE" ;;
  esac
}

main "$@"
