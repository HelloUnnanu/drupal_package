<?php

namespace Drupal\dir_ai_search\Controller;

use Drupal\Core\Controller\ControllerBase;

/**
 * Controller for the AI Search pages.
 */
class AiSearchController extends ControllerBase {

  /**
   * Builds the content search page.
   */
  public function buildContent() {
    return [
      '#theme' => 'dir_ai_search_app',
      '#search_type' => 'content',
      '#attached' => [
        'library' => [
          'dir_ai_search/dir_ai_search',
        ],
      ],
    ];
  }

  /**
   * Builds the contracts and vendors search page.
   */
  public function buildContracts() {
    return [
      '#theme' => 'dir_ai_search_app',
      '#search_type' => 'contracts',
      '#attached' => [
        'library' => [
          'dir_ai_search/dir_ai_search',
        ],
      ],
    ];
  }

}
