<?php

namespace Drupal\dir_ai_search\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\dir_ai_search\Service\AiSearchApiService;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Thin HTTP proxy between the Drupal front-end JS and the upstream Unnanu API.
 *
 * All browser fetch() calls in dir_ai_search.js and ai-search-autocomplete.js
 * point here instead of directly to the external domain, which:
 *  - eliminates browser-side CORS requirements on the upstream server,
 *  - keeps the API base URL configurable in Drupal (dir_ai_search.settings),
 *  - allows future authentication / rate-limiting to be added server-side.
 *
 * Routes (defined in dir_ai_search.routing.yml):
 *   POST /ai-search/proxy/search       → searchContent() | searchContracts()
 *   POST /ai-search/proxy/chat         → chatContent()   | chatContracts()
 *   GET  /ai-search/proxy/autocomplete → autocompleteContent() | autocompleteContracts()
 *                                        autocompleteContentChat() | autocompleteContractsChat()
 *
 * Request body / query-string for each action uses a `type` field:
 *   type = "content"   → all-pages / files search
 *   type = "contracts" → contracts & vendors search
 *
 * For autocomplete, an additional `mode` field selects the variant:
 *   mode = "search" (default) → search-bar autocomplete
 *   mode = "chat"             → in-chat autocomplete
 */
class AiSearchProxyController extends ControllerBase {

  protected AiSearchApiService $apiService;

  public function __construct(AiSearchApiService $api_service) {
    $this->apiService = $api_service;
  }

  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('dir_ai_search.api_service')
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST /ai-search/proxy/search
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Proxies initial search requests (both content and contracts).
   *
   * Expected JSON body:
   *   { "type": "content|contracts", "query": "...", "view": "..." }
   */
  public function search(Request $request): JsonResponse {
    $body  = $this->parseBody($request);
    $type  = $body['type']  ?? 'content';
    $query = trim($body['query'] ?? '');
    $view  = $body['view']  ?? '';

    if ($query === '') {
      return new JsonResponse(['error' => 'query is required'], 400);
    }

    try {
      $data = $type === 'contracts'
        ? $this->apiService->searchContracts($query, $view)
        : $this->apiService->searchContent($query);

      return new JsonResponse($data);
    }
    catch (\Exception $e) {
      return new JsonResponse(['error' => 'Upstream search failed'], 502);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POST /ai-search/proxy/chat
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Proxies chat turn requests (both content and contracts).
   *
   * Expected JSON body:
   *   { "type": "content|contracts", "query": "...", "view": "..." }
   *
   * For content mode, `view` is the JSON-encoded object grouping file IDs
   * by modality that the frontend builds with buildViewFromContentData().
   */
  public function chat(Request $request): JsonResponse {
    $body  = $this->parseBody($request);
    $type  = $body['type']  ?? 'content';
    $query = trim($body['query'] ?? '');
    $view  = $body['view']  ?? '';

    if ($query === '') {
      return new JsonResponse(['error' => 'query is required'], 400);
    }

    try {
      $data = $type === 'contracts'
        ? $this->apiService->chatContracts($query, $view)
        : $this->apiService->chatContent($query, $view);

      return new JsonResponse($data);
    }
    catch (\Exception $e) {
      return new JsonResponse(['error' => 'Upstream chat failed'], 502);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /ai-search/proxy/autocomplete
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Proxies autocomplete requests.
   *
   * Query parameters:
   *   query  - the text typed so far
   *   type   - "content" (default) | "contracts"
   *   mode   - "search" (default) | "chat"
   *   view   - (optional) JSON view object for content-chat autocomplete
   */
  public function autocomplete(Request $request): JsonResponse {
    $query = trim($request->query->get('query', ''));
    $type  = $request->query->get('type', 'content');
    $mode  = $request->query->get('mode', 'search');
    $view  = $request->query->get('view', '');

    if ($query === '') {
      return new JsonResponse([]);
    }

    try {
      if ($type === 'contracts') {
        $data = $mode === 'chat'
          ? $this->apiService->autocompleteContractsChat($query)
          : $this->apiService->autocompleteContracts($query);
      }
      else {
        $data = $mode === 'chat'
          ? $this->apiService->autocompleteContentChat($query, $view)
          : $this->apiService->autocompleteContent($query);
      }

      return new JsonResponse($data);
    }
    catch (\Exception $e) {
      // Autocomplete must never break the page — return empty list silently.
      return new JsonResponse([]);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  protected function parseBody(Request $request): array {
    $raw = $request->getContent();
    if (!$raw) {
      return [];
    }
    return json_decode($raw, TRUE) ?? [];
  }

}
