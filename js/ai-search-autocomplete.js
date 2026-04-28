(function() {
  document.addEventListener('DOMContentLoaded', function() {

    // All autocomplete calls go through the Drupal proxy to avoid CORS.
    const PROXY_AUTO = '/ai-search/proxy/autocomplete';

    // IDs for the two megamenu inputs.
    const inputAll       = document.getElementById('megamenu-query-all');
    const inputContracts = document.getElementById('megamenu-query-contracts');

    const formAll       = inputAll       ? inputAll.closest('form')       : null;
    const formContracts = inputContracts ? inputContracts.closest('form') : null;

    // ──────────────────────────────────────────────────────────────────────
    // Utilities
    // ──────────────────────────────────────────────────────────────────────

    function debounce(func, wait) {
      let timeout;
      return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

    // Strip jQuery Typeahead events/DOM injected by the DIR theme so our
    // custom dropdown renders cleanly without competing widgets.
    function stripTypeahead(input) {
      if (!input) return null;
      const clone = input.cloneNode(true);
      clone.classList.remove('tt-input', 'js-autocomplete');
      clone.removeAttribute('dir');
      input.parentNode.replaceChild(clone, input);

      const parent = clone.parentElement;
      if (parent && parent.classList.contains('twitter-typeahead')) {
        ['tt-hint', 'tt-menu', 'pre'].forEach(sel => {
          const el = parent.querySelector('.' + sel) || parent.querySelector(sel);
          if (el) el.remove();
        });
      }
      return clone;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Dropdown renderer
    // ──────────────────────────────────────────────────────────────────────

    function renderDropdown(input, suggestions, searchType) {
      let dropdown = input.parentNode.querySelector('.unnanu-autocomplete');
      if (!dropdown) {
        dropdown = document.createElement('ul');
        dropdown.className = 'unnanu-autocomplete';
        dropdown.style.cssText = [
          'position:absolute', 'top:100%', 'left:0', 'width:100%',
          'background:#fff', 'border:1px solid #e2e5ea', 'border-radius:4px',
          'margin:4px 0 0', 'padding:0', 'list-style:none',
          'max-height:300px', 'overflow-y:auto', 'z-index:1000',
          'box-shadow:0 4px 6px rgba(0,0,0,0.1)'
        ].join(';');
        input.parentNode.style.position = 'relative';
        input.parentNode.appendChild(dropdown);
      }

      dropdown.innerHTML = '';

      if (!suggestions || suggestions.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      suggestions.forEach(item => {
        // The upstream API returns heterogeneous shapes across endpoints —
        // normalise to a plain string before rendering.
        let text = '';
        if (typeof item === 'string') {
          text = item;
        } else {
          text = item.autoquestion || item.Question || item.question
              || item.suggestion  || item.text     || item.name || '';
        }
        if (!text) return;

        const li = document.createElement('li');
        li.textContent = text;
        li.style.cssText = [
          'padding:10px 14px', 'cursor:pointer', 'font-family:inherit',
          'font-size:0.95rem', 'color:#333', 'border-bottom:1px solid #f1f1f1'
        ].join(';');
        li.addEventListener('mouseenter', () => { li.style.background = '#f5f5f5'; });
        li.addEventListener('mouseleave', () => { li.style.background = 'transparent'; });
        li.addEventListener('click', (e) => {
          e.preventDefault();
          input.value = text;
          dropdown.style.display = 'none';
          const base = searchType === 'contracts' ? '/ai-search-contracts' : '/ai-search-content';
          window.location.href = base + '?query=' + encodeURIComponent(text);
        });

        dropdown.appendChild(li);
      });

      dropdown.style.display = 'block';
    }

    function hideDropdown(input) {
      setTimeout(() => {
        const d = input.parentNode.querySelector('.unnanu-autocomplete');
        if (d) d.style.display = 'none';
      }, 200);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Fetch handlers (debounced, 300 ms — matches MVP SearchBox behaviour)
    // ──────────────────────────────────────────────────────────────────────

    const fetchContent = debounce(async (val, inputEl) => {
      if (!val.trim()) { renderDropdown(inputEl, [], 'content'); return; }
      try {
        const res  = await fetch(`${PROXY_AUTO}?type=content&query=${encodeURIComponent(val)}`);
        const data = await res.json();
        renderDropdown(inputEl, Array.isArray(data) ? data : (data.data || []), 'content');
      } catch (e) {
        console.error('[AI Autocomplete] content error:', e);
      }
    }, 300);

    const fetchContracts = debounce(async (val, inputEl) => {
      if (!val.trim()) { renderDropdown(inputEl, [], 'contracts'); return; }
      try {
        const res  = await fetch(`${PROXY_AUTO}?type=contracts&query=${encodeURIComponent(val)}`);
        const data = await res.json();
        renderDropdown(inputEl, Array.isArray(data) ? data : (data.data || []), 'contracts');
      } catch (e) {
        console.error('[AI Autocomplete] contracts error:', e);
      }
    }, 300);

    // ──────────────────────────────────────────────────────────────────────
    // Megamenu inputs
    // ──────────────────────────────────────────────────────────────────────

    const cleanAll       = stripTypeahead(inputAll);
    const cleanContracts = stripTypeahead(inputContracts);

    if (cleanAll) {
      cleanAll.addEventListener('input',  (e) => fetchContent(e.target.value, cleanAll));
      cleanAll.addEventListener('blur',   ()  => hideDropdown(cleanAll));
    }

    if (cleanContracts) {
      cleanContracts.addEventListener('input',  (e) => fetchContracts(e.target.value, cleanContracts));
      cleanContracts.addEventListener('blur',   ()  => hideDropdown(cleanContracts));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Override megamenu form submissions → redirect to AI search routes
    // ──────────────────────────────────────────────────────────────────────

    if (formAll && cleanAll) {
      formAll.addEventListener('submit', (e) => {
        e.preventDefault();
        window.location.href = '/ai-search-content?query=' + encodeURIComponent(cleanAll.value);
      });
    }

    if (formContracts && cleanContracts) {
      formContracts.addEventListener('submit', (e) => {
        e.preventDefault();
        window.location.href = '/ai-search-contracts?query=' + encodeURIComponent(cleanContracts.value);
      });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Results-page main search bar autocomplete
    // Also overrides form submission to keep the user on the AI search route.
    // ──────────────────────────────────────────────────────────────────────

    const mainForm = document.querySelector('main .searchresults-form form')
                  || document.querySelector('#main-content form');

    if (mainForm) {
      const path = window.location.pathname;
      let mainType = null;
      if      (path.includes('/ai-search-content'))   mainType = 'content';
      else if (path.includes('/ai-search-contracts')) mainType = 'contracts';

      if (mainType) {
        const rawInput = mainForm.querySelector(
          'input[type="search"], input[name="query"], input[name="keys"]'
        );
        if (rawInput) {
          const cleanMain = stripTypeahead(rawInput);
          const fetchFn   = mainType === 'contracts' ? fetchContracts : fetchContent;

          cleanMain.addEventListener('input', (e) => fetchFn(e.target.value, cleanMain));
          cleanMain.addEventListener('blur',  ()  => hideDropdown(cleanMain));

          mainForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const base = mainType === 'contracts' ? '/ai-search-contracts' : '/ai-search-content';
            window.location.href = base + '?query=' + encodeURIComponent(cleanMain.value);
          });
        }
      }
    }

  });
})();
