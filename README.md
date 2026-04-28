# DIR AI Search Integration — Drupal Module

A custom Drupal module that integrates the **Unnanu AI Search** engine natively into Drupal, providing AI-powered content search, contracts/vendors search, chat, and autocomplete — all proxied server-side so no CORS configuration is needed on the upstream API.

---

## File Structure

```
dir_ai_search/
├── assets/
│   ├── index-BieUgIMK.js       # Pre-built JS bundle (production asset)
│   └── index-CILFNRze.css      # Pre-built CSS bundle (production asset)
├── config/
│   └── install/
│       └── dir_ai_search.settings.yml   # Default config: API base URL
├── css/
│   └── dir_ai_search.css        # Module-level styles for the search UI
├── images/
│   └── unnanu-logo.webp         # Unnanu branding used in the chat footer
├── js/
│   ├── dir_ai_search.js         # Main search page logic (results + chat rendering)
│   └── ai-search-autocomplete.js # Megamenu / global autocomplete logic
├── src/
│   ├── Controller/
│   │   ├── AiSearchController.php       # Page controllers for search routes
│   │   └── AiSearchProxyController.php  # HTTP proxy controllers (search / chat / autocomplete)
│   └── Service/
│       └── AiSearchApiService.php       # Centralised Guzzle client for the Unnanu API
├── templates/
│   └── dir-ai-search-app.html.twig      # Twig template for the search results page layout
├── dir_ai_search.info.yml        # Module metadata (name, type, Drupal core version)
├── dir_ai_search.libraries.yml   # Asset library definitions (CSS/JS)
├── dir_ai_search.module          # Hook implementations (page_attachments, theme, theme_suggestions)
├── dir_ai_search.routing.yml     # Route definitions for page and proxy endpoints
├── dir_ai_search.schema.yml      # Config schema for dir_ai_search.settings
├── dir_ai_search.services.yml    # Drupal service container definition for AiSearchApiService
├── composer.json                 # Composer package metadata
└── README.md                     # This file
```

---

## File Details

### `dir_ai_search.info.yml`
Module declaration file. Declares the module as `DIR AI Search Integration`, sets the package to `DIR`, and requires Drupal core `^8 || ^9 || ^10`.

### `dir_ai_search.module`
Contains three hook implementations:
- **`hook_page_attachments`** — attaches the `autocomplete` JS library globally so the megamenu autocomplete works on every page.
- **`hook_theme`** — registers the `dir_ai_search_app` theme hook backed by `dir-ai-search-app.html.twig`, exposing a `search_type` variable (`content` or `contracts`).
- **`hook_theme_suggestions_page_alter`** — forces the AI search routes to reuse the existing `page--search-results.html.twig` template from the DIR Bootstrap theme, preserving the site header, footer, and search bar.

### `dir_ai_search.routing.yml`
Defines six routes:

| Route | Path | Method | Purpose |
|---|---|---|---|
| `dir_ai_search.content` | `/ai-search-content` | GET | Content search page |
| `dir_ai_search.contracts` | `/ai-search-contracts` | GET | Contracts & vendors search page |
| `dir_ai_search.proxy.search` | `/ai-search/proxy/search` | POST | Proxy: initial search |
| `dir_ai_search.proxy.chat` | `/ai-search/proxy/chat` | POST | Proxy: chat turn |
| `dir_ai_search.proxy.autocomplete` | `/ai-search/proxy/autocomplete` | GET | Proxy: autocomplete suggestions |

### `dir_ai_search.libraries.yml`
Defines two Drupal asset libraries:
- **`dir_ai_search`** (v1.4) — loads `dir_ai_search.css` and `dir_ai_search.js`, attached only on AI search pages.
- **`autocomplete`** (v1.0) — loads `ai-search-autocomplete.js`, attached globally on every page.

### `dir_ai_search.services.yml`
Registers `dir_ai_search.api_service` — an instance of `AiSearchApiService` — injecting Drupal's `http_client` (Guzzle), `config.factory`, and `logger.factory`.

### `dir_ai_search.schema.yml`
Defines the config schema for `dir_ai_search.settings`, exposing a single string key `api_base_url` for the Drupal config system.

### `config/install/dir_ai_search.settings.yml`
Default configuration installed when the module is enabled. Sets `api_base_url` to `https://azapp-aisearch.azurewebsites.net`. Can be overridden at runtime via `secret.json` (see below).

### `src/Controller/AiSearchController.php`
Extends `ControllerBase`. Provides two page-builder methods:
- **`buildContent()`** — renders the `dir_ai_search_app` theme hook with `search_type = content`.
- **`buildContracts()`** — renders the same hook with `search_type = contracts`.

### `src/Controller/AiSearchProxyController.php`
Thin HTTP proxy between the Drupal front-end JS and the upstream Unnanu API. Handles:
- **`search(Request)`** — POST proxy for initial searches (content or contracts), dispatching to `AiSearchApiService`.
- **`chat(Request)`** — POST proxy for conversational chat turns.
- **`autocomplete(Request)`** — GET proxy for autocomplete suggestions; dispatches by `type` (`content`/`contracts`) and `mode` (`search`/`chat`).

All three methods parse request bodies/query-strings, validate required fields, and return `JsonResponse`. Upstream failures return `502 Bad Gateway`.

### `src/Service/AiSearchApiService.php`
Centralised Guzzle-based HTTP client. Resolves the API base URL from `secret.json` one level above the Drupal root (if present) and falls back to the configured value. Implements:

| Method | Upstream Endpoint | Type |
|---|---|---|
| `searchContent($query)` | `POST /dirsearch` | Search |
| `searchContracts($query, $view)` | `POST /search/` | Search |
| `chatContent($query, $view)` | `POST /dirsearch/chat?query=&view=` | Chat |
| `chatContracts($query, $view)` | `POST /chat/` | Chat |
| `autocompleteContent($query)` | `GET /dir/search/autocomplete` | Autocomplete |
| `autocompleteContracts($query)` | `GET /suggestions` | Autocomplete |
| `autocompleteContentChat($query, $view)` | `GET /dir/chat/autocomplete` | Autocomplete |
| `autocompleteContractsChat($query)` | `GET /suggestions/chat` | Autocomplete |

Timeouts: 30 s for search/chat, 10 s for autocomplete. Autocomplete errors degrade gracefully (returns `[]`).

### `templates/dir-ai-search-app.html.twig`
Renders the full two-column search results layout:
- **Left column** — filter pills container, results list, loading spinner, and error box.
- **Right column** — collapsible FAQ / suggested questions panel, sticky AI chat box with scrollable message history, a `<textarea>` input with send button, and a "Powered by Unnanu" branding footer.

### `css/dir_ai_search.css`
Module-level CSS for the search results page. Styles the filter pills, result cards, and responsive layout overrides that complement the Tailwind utility classes used in the Twig template.

### `js/dir_ai_search.js`
Main search page JavaScript. On `DOMContentLoaded`, reads the `data-search-type` attribute from the wrapper element, fires the initial search using `URLSearchParams`, renders result cards, handles chat interactions, manages the FAQ panel, autocomplete on the chat input, file preview modal, and the "Download Chat" action.

### `js/ai-search-autocomplete.js`
Global autocomplete script attached to every page. Hooks into the megamenu search input, debounces keystrokes, calls `/ai-search/proxy/autocomplete`, and renders a dropdown of suggestions below the input.

### `assets/index-BieUgIMK.js` / `assets/index-CILFNRze.css`
Pre-built production bundles (likely from a Vite/React front-end build). Served as static assets; referenced via the library or template as needed.

### `images/unnanu-logo.webp`
Unnanu branding image displayed in the chat panel footer ("Powered by Unnanu").

---

## Configuration

### API Base URL
The upstream API URL is resolved in this order:

1. **`secret.json`** at `<drupal_root>/../secret.json`:
   ```json
   {
     "ai_search": {
       "api_base_url": "https://your-api-host.example.com"
     }
   }
   ```
2. **Drupal config** — `dir_ai_search.settings` (`api_base_url` key), manageable via `drush config:set` or the Config UI.
3. **Hard-coded default** — `https://azapp-aisearch.azurewebsites.net`.

> **Note:** `secret.json` must be placed **outside** the Drupal docroot (one level above) and must **not** be committed to version control. It is listed in `.gitignore`.

---

## Installation

```bash
# 1. Place the module in your Drupal installation
cp -r dir_ai_search /path/to/drupal/docroot/modules/custom/

# 2. Enable the module
drush en dir_ai_search -y

# 3. (Optional) Override the API URL via secret.json
echo '{"ai_search":{"api_base_url":"https://your-api.example.com"}}' \
  > /path/to/drupal/../secret.json

# 4. Clear caches
drush cr
```

---

## Routes Reference

| URL | Description |
|---|---|
| `/ai-search-content` | AI-powered content & pages search |
| `/ai-search-contracts` | Contracts & vendors search |
| `/ai-search/proxy/search` | Internal proxy — do not call directly from browsers |
| `/ai-search/proxy/chat` | Internal proxy — do not call directly from browsers |
| `/ai-search/proxy/autocomplete` | Internal proxy — do not call directly from browsers |

---

## Requirements

- **Drupal** `^8 || ^9 || ^10`
- **PHP** `^8.1`
- **Guzzle** (bundled with Drupal core)
- The external **Unnanu AI Search API** reachable from the Drupal server

---

## License

Proprietary — DIR / Unnanu. All rights reserved.
