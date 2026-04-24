(function() {
  document.addEventListener('DOMContentLoaded', function() {
    // The base API URL derived from the React app
    const API_URL = 'https://azapp-aisearch.azurewebsites.net';
    
    // IDs for the two megamenu inputs
    const inputAll = document.getElementById('megamenu-query-all');
    const inputContracts = document.getElementById('megamenu-query-contracts');

    // Forms
    const formAll = inputAll ? inputAll.closest('form') : null;
    const formContracts = inputContracts ? inputContracts.closest('form') : null;

    // Create a debounce function
    function debounce(func, wait) {
      let timeout;
      return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

    // Replace the input with a clone to strip jQuery Twitter Typeahead events
    function stripTypeahead(input) {
      if (!input) return null;
      const clone = input.cloneNode(true);
      // Remove any typeahead classes to avoid styling weirdness
      clone.classList.remove('tt-input', 'js-autocomplete');
      clone.removeAttribute('dir');
      input.parentNode.replaceChild(clone, input);
      
      // Also remove the injected typeahead DOM elements if present
      const parent = clone.parentElement;
      if (parent && parent.classList.contains('twitter-typeahead')) {
        const hint = parent.querySelector('.tt-hint');
        const menu = parent.querySelector('.tt-menu');
        const pre = parent.querySelector('pre');
        if (hint) hint.remove();
        if (menu) menu.remove();
        if (pre) pre.remove();
      }
      return clone;
    }

    const cleanInputAll = stripTypeahead(inputAll);
    const cleanInputContracts = stripTypeahead(inputContracts);

    // Common function to inject autocomplete list into DOM
    function renderDropdown(input, suggestions, searchType) {
      // Find or create wrapper and dropdown
      let dropdown = input.parentNode.querySelector('.unnanu-autocomplete');
      if (!dropdown) {
        dropdown = document.createElement('ul');
        dropdown.className = 'unnanu-autocomplete';
        dropdown.style.cssText = `
          position: absolute;
          top: 100%;
          left: 0;
          width: 100%;
          background: #fff;
          border: 1px solid #e2e5ea;
          border-radius: 4px;
          margin: 4px 0 0;
          padding: 0;
          list-style: none;
          max-height: 300px;
          overflow-y: auto;
          z-index: 1000;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        // input.parentNode should ideally be position: relative
        input.parentNode.style.position = 'relative';
        input.parentNode.appendChild(dropdown);
      }

      dropdown.innerHTML = '';
      if (suggestions.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      suggestions.forEach(item => {
        let text = '';
        if (typeof item === 'string') text = item;
        else text = item.autoquestion || item.Question || item.question || item.suggestion || item.text || item.name || '';

        if (!text) return;

        const li = document.createElement('li');
        li.textContent = text;
        li.style.cssText = `
          padding: 10px 14px;
          cursor: pointer;
          font-family: inherit;
          font-size: 0.95rem;
          color: #333;
          border-bottom: 1px solid #f1f1f1;
        `;
        li.addEventListener('mouseenter', () => li.style.background = '#f5f5f5');
        li.addEventListener('mouseleave', () => li.style.background = 'transparent');
        
        li.addEventListener('click', (e) => {
          e.preventDefault();
          input.value = text;
          dropdown.style.display = 'none';
          
          // Submit and redirect
          const url = searchType === 'contracts' ? '/ai-search-contracts' : '/ai-search-content';
          window.location.href = url + '?query=' + encodeURIComponent(text);
        });

        dropdown.appendChild(li);
      });
      dropdown.style.display = 'block';
    }

    // Fetch handlers
    const fetchAllPages = debounce(async (val, inputEl, type) => {
      if (!val.trim()) return renderDropdown(inputEl, [], type);
      try {
        const res = await fetch(`${API_URL}/dir/search/autocomplete?query=${encodeURIComponent(val)}`);
        const data = await res.json();
        renderDropdown(inputEl, Array.isArray(data) ? data : (data.data || []), type);
      } catch (e) {
        console.error(e);
      }
    }, 300);

    const fetchContracts = debounce(async (val, inputEl, type) => {
      if (!val.trim()) return renderDropdown(inputEl, [], type);
      try {
        const res = await fetch(`${API_URL}/suggestions?query=${encodeURIComponent(val)}`);
        const data = await res.json();
        renderDropdown(inputEl, Array.isArray(data) ? data : (data.data || []), type);
      } catch (e) {
        console.error(e);
      }
    }, 300);

    // Attach listeners
    if (cleanInputAll) {
      cleanInputAll.addEventListener('input', (e) => fetchAllPages(e.target.value, cleanInputAll, 'content'));
      cleanInputAll.addEventListener('blur', () => setTimeout(() => {
        const d = cleanInputAll.parentNode.querySelector('.unnanu-autocomplete');
        if (d) d.style.display = 'none';
      }, 200));
    }

    if (cleanInputContracts) {
      cleanInputContracts.addEventListener('input', (e) => fetchContracts(e.target.value, cleanInputContracts, 'contracts'));
      cleanInputContracts.addEventListener('blur', () => setTimeout(() => {
        const d = cleanInputContracts.parentNode.querySelector('.unnanu-autocomplete');
        if (d) d.style.display = 'none';
      }, 200));
    }

    // Override forms
    if (formAll && cleanInputAll) {
      formAll.addEventListener('submit', (e) => {
        e.preventDefault();
        window.location.href = '/ai-search-content?query=' + encodeURIComponent(cleanInputAll.value);
      });
    }

    if (formContracts && cleanInputContracts) {
      formContracts.addEventListener('submit', (e) => {
        e.preventDefault();
        window.location.href = '/ai-search-contracts?query=' + encodeURIComponent(cleanInputContracts.value);
      });
    }

    // Attach to the main search bar on the results page
    const mainForm = document.querySelector('main .searchresults-form form') || document.querySelector('#main-content form');
    if (mainForm) {
      let mainSearchType = null;
      const path = window.location.pathname;
      if (path.includes('/ai-search-content')) mainSearchType = 'content';
      else if (path.includes('/ai-search-contracts')) mainSearchType = 'contracts';
      
      if (mainSearchType) {
        const rawMainInput = mainForm.querySelector('input[type="search"], input[name="query"], input[name="keys"]');
        if (rawMainInput) {
          const cleanMainInput = stripTypeahead(rawMainInput);
          cleanMainInput.addEventListener('input', (e) => {
            if (mainSearchType === 'content') fetchAllPages(e.target.value, cleanMainInput, mainSearchType);
            else fetchContracts(e.target.value, cleanMainInput, mainSearchType);
          });
          cleanMainInput.addEventListener('blur', () => setTimeout(() => {
            const d = cleanMainInput.parentNode.querySelector('.unnanu-autocomplete');
            if (d) d.style.display = 'none';
          }, 200));
        }
      }
    }

  });
})();
