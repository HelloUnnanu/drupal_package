<?php

namespace Drupal\dir_ai_search\Service;

use Drupal\Core\Config\ConfigFactoryInterface;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\RequestException;
use Psr\Log\LoggerInterface;

/**
 * Proxies all calls to the external Unnanu AI Search API.
 *
 * Centralises the API base URL (configured at dir_ai_search.settings) so the
 * frontend JS never needs to know the upstream origin — removing the need for
 * CORS headers on the external server and allowing the URL to be changed
 * without a code deploy.
 */
class AiSearchApiService {

  /**
   * @var \GuzzleHttp\ClientInterface
   */
  protected ClientInterface $httpClient;

  /**
   * @var \Drupal\Core\Config\ImmutableConfig
   */
  protected $config;

  /**
   * @var \Psr\Log\LoggerInterface
   */
  protected LoggerInterface $logger;

  /**
   * Default timeout in seconds for search / chat requests.
   */
  const TIMEOUT_SEARCH = 30;

  /**
   * Default timeout in seconds for autocomplete (fast path).
   */
  const TIMEOUT_AUTO = 10;

  public function __construct(
    ClientInterface $http_client,
    ConfigFactoryInterface $config_factory,
    $logger_factory
  ) {
    $this->httpClient = $http_client;
    $this->config = $config_factory->get('dir_ai_search.settings');
    $this->logger = $logger_factory->get('dir_ai_search');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────────────────

  protected function baseUrl(): string {
    // Try secret.json one level above docroot first.
    $secretFile = DRUPAL_ROOT . '/../secret.json';
    if (is_file($secretFile)) {
      $secrets = json_decode(file_get_contents($secretFile), TRUE);
      $url = $secrets['ai_search']['api_base_url'] ?? '';
      if ($url !== '') {
        return rtrim($url, '/');
      }
    }

    return rtrim(
      $this->config->get('api_base_url') ?: 'https://azapp-aisearch.azurewebsites.net',
      '/'
    );
  }

  /**
   * POST JSON to the upstream API and return decoded array.
   */
  protected function postJson(string $path, array $payload, int $timeout = self::TIMEOUT_SEARCH): array {
    try {
      $response = $this->httpClient->post($this->baseUrl() . $path, [
        'json'    => $payload,
        'timeout' => $timeout,
        'headers' => ['Accept' => 'application/json'],
      ]);
      return json_decode((string) $response->getBody(), TRUE) ?? [];
    }
    catch (RequestException $e) {
      $this->logger->error('AI Search POST @path failed: @msg', [
        '@path' => $path,
        '@msg'  => $e->getMessage(),
      ]);
      throw $e;
    }
  }

  /**
   * GET from the upstream API and return decoded array.
   */
  protected function getJson(string $path, array $query = [], int $timeout = self::TIMEOUT_AUTO): array {
    try {
      $response = $this->httpClient->get($this->baseUrl() . $path, [
        'query'   => $query,
        'timeout' => $timeout,
        'headers' => ['Accept' => 'application/json'],
      ]);
      return json_decode((string) $response->getBody(), TRUE) ?? [];
    }
    catch (RequestException $e) {
      $this->logger->error('AI Search GET @path failed: @msg', [
        '@path' => $path,
        '@msg'  => $e->getMessage(),
      ]);
      // Autocomplete failures should degrade gracefully.
      return [];
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Search endpoints
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * All-pages / content search.
   *
   * Maps to: POST /dirsearch  { query }
   * Response: { code, result, data: [...files], chat: [...faq] }
   */
  public function searchContent(string $query): array {
    return $this->postJson('/dirsearch', ['query' => $query]);
  }

  /**
   * Contracts & vendors search.
   *
   * Maps to: POST /search/  { query, view }
   * Response: { code, result, data: [...vendors], view: "..." }
   */
  public function searchContracts(string $query, string $view = ''): array {
    return $this->postJson('/search/', ['query' => $query, 'view' => $view]);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Chat endpoints
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Content chat.
   *
   * Maps to: POST /dirsearch/chat?query={q}&view={json}
   * Response: { code, result, data: [...files], chat: "text response" }
   *
   * The upstream API expects query + view as query-string params even though
   * the method is POST (matching the MVP _requestSearch.js behaviour).
   */
  public function chatContent(string $query, string $view): array {
    $path = '/dirsearch/chat?' . http_build_query([
      'query' => $query,
      'view'  => $view,
    ]);
    try {
      $response = $this->httpClient->post($this->baseUrl() . $path, [
        'timeout' => self::TIMEOUT_SEARCH,
        'headers' => ['Accept' => 'application/json'],
      ]);
      return json_decode((string) $response->getBody(), TRUE) ?? [];
    }
    catch (RequestException $e) {
      $this->logger->error('AI Search content chat failed: @msg', ['@msg' => $e->getMessage()]);
      throw $e;
    }
  }

  /**
   * Contracts chat.
   *
   * Maps to: POST /chat/  { query, view }
   * Response: { code, result, data: [...vendors], view: "..." }
   */
  public function chatContracts(string $query, string $view = ''): array {
    return $this->postJson('/chat/', ['query' => $query, 'view' => $view]);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Autocomplete endpoints
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Autocomplete for content / all-pages search.
   *
   * Maps to: GET /dir/search/autocomplete?query={q}
   */
  public function autocompleteContent(string $query): array {
    return $this->getJson('/dir/search/autocomplete', ['query' => $query]);
  }

  /**
   * Autocomplete for contracts search (initial search bar).
   *
   * Maps to: GET /suggestions?query={q}
   */
  public function autocompleteContracts(string $query): array {
    return $this->getJson('/suggestions', ['query' => $query]);
  }

  /**
   * Chat autocomplete for content (used in the in-chat input after results load).
   *
   * Maps to: GET /dir/chat/autocomplete?query={q}&view={json}
   */
  public function autocompleteContentChat(string $query, string $view = ''): array {
    return $this->getJson('/dir/chat/autocomplete', ['query' => $query, 'view' => $view]);
  }

  /**
   * Chat autocomplete for contracts.
   *
   * Maps to: GET /suggestions/chat?query={q}
   */
  public function autocompleteContractsChat(string $query): array {
    return $this->getJson('/suggestions/chat', ['query' => $query]);
  }

}
