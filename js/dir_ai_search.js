/**
 * Vanilla JS orchestrator for DIR AI Search on Custom Routes.
 */
(function () {
  'use strict';
  // All API calls go through the Drupal proxy controller (AiSearchProxyController).
  // This avoids cross-origin fetch requirements on the upstream server and keeps
  // the API base URL configurable via dir_ai_search.settings without a JS deploy.
  const PROXY_BASE = '/ai-search/proxy';

  function debounce(fn, wait) {
    let t;
    return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
  }

  const ITEMS_PER_PAGE = 5;

  let state = {
    query: '',
    searchType: 'content',
    chatView: '',
    isLoading: false,
    vendors: [],
    contentData: [],
    allUniqueItems: [],
    filteredItems: [],
    activeModality: 'all',
    currentPage: 1,
    contractsVendors: []
  };

  const DOM = {
    app: null,
    resultsList: null,
    loading: null,
    error: null,
    metadata: null,
    chat: {
      messages: null,
      input: null,
      form: null,
      submit: null,
      typing: null,
      download: null
    },
    faq: {
      container: null,
      toggle: null,
      chevron: null,
      list: null
    }
  };

  function init() {
    const wrapper = document.getElementById('unnanu-ai-search-wrapper');
    if (!wrapper) return;

    state.searchType = wrapper.getAttribute('data-search-type') || 'content';

    const urlParams = new URLSearchParams(window.location.search);
    state.query = urlParams.get('query') || urlParams.get('keys') || urlParams.get('word') || '';

    DOM.app = wrapper;
    DOM.resultsList = document.getElementById('ai-search-results-list');
    DOM.loading = document.getElementById('ai-search-loading');
    DOM.error = document.getElementById('ai-search-error');
    DOM.metadata = document.getElementById('ai-search-metadata');
    
    // ai-chat-messages-list  = inner div where message nodes are appended
    // ai-chat-messages        = outer scroll container (for scrollTop)
    DOM.chat.messages = document.getElementById('ai-chat-messages-list');
    DOM.chat.scroll   = document.getElementById('ai-chat-messages');
    DOM.chat.input    = document.getElementById('ai-chat-input');
    DOM.chat.form     = document.getElementById('ai-chat-form');
    DOM.chat.submit   = document.getElementById('ai-chat-submit');
    DOM.chat.typing   = document.getElementById('ai-chat-typing');
    DOM.chat.download = document.getElementById('ai-chat-download');

    // Auto-resize textarea + focus styling
    if (DOM.chat.input) {
        DOM.chat.input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            handleChatAutocomplete(this.value);
        });
        DOM.chat.input.addEventListener('focus', function() {
            this.style.borderColor = '#1F40AF';
            this.style.background = '#fff';
            this.style.boxShadow = '0 0 0 1px #1F40AF';
        });
        DOM.chat.input.addEventListener('blur', function() {
            this.style.borderColor = '#e5e7eb';
            this.style.background = '#f9fafb';
            this.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
            setTimeout(hideChatAutocomplete, 200);
        });
        DOM.chat.input.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') hideChatAutocomplete();
        });
    }

    DOM.faq.container = document.getElementById('ai-faq-container');
    DOM.faq.toggle = document.getElementById('faq-toggle');
    DOM.faq.chevron = document.getElementById('faq-chevron');
    DOM.faq.list = document.getElementById('faq-list');

    // Bind Chat Events
    // Use direct click on submit button + keydown on textarea.
    // Avoid relying solely on the form "submit" event — Drupal's AJAX
    // behaviors can intercept it, silently swallowing the click.
    if (DOM.chat.submit) {
        DOM.chat.submit.addEventListener('click', function(e) {
            e.preventDefault();
            handleChatSubmit(e);
        });
    }
    if (DOM.chat.form) {
        // Belt-and-suspenders: also catch native form submit (e.g. Enter on non-textarea input)
        DOM.chat.form.addEventListener('submit', function(e) {
            e.preventDefault();
            handleChatSubmit(e);
        });
    }
    if (DOM.chat.input) {
        DOM.chat.input.addEventListener('keydown', function(e) {
            // Enter without Shift submits; Shift+Enter inserts newline
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleChatSubmit(e);
            }
        });
    }
    if (DOM.chat.download) {
        DOM.chat.download.addEventListener('click', downloadChat);
    }
    if (DOM.faq.toggle) {
        DOM.faq.toggle.addEventListener('click', () => {
            const isHidden = DOM.faq.list.classList.contains('hidden');
            if (isHidden) {
                DOM.faq.list.classList.remove('hidden');
                DOM.faq.chevron.style.transform = 'rotate(90deg)';
            } else {
                DOM.faq.list.classList.add('hidden');
                DOM.faq.chevron.style.transform = 'rotate(0deg)';
            }
        });
    }

    // Override the native tabs to point to our custom routes!
    const tabs = document.querySelectorAll('.searchresults-nav a');
    const navEl = document.querySelector('.searchresults-nav');
    const navUl = document.querySelector('.searchresults-nav ul');

    // Control nav bottom-border color via is-primary class:
    // content page → blue (#1F40AF), contracts page → gray (#cacaca)
    if (navEl) {
        if (state.searchType === 'content') {
            navEl.classList.add('is-primary');
        } else {
            navEl.classList.remove('is-primary');
        }
    }
    // Clear any JS-set border on the ul; SCSS handles the nav's border
    if (navUl) {
        navUl.style.borderBottom = 'none';
        navUl.style.marginBottom = '0';
    }

    tabs.forEach(tab => {
        const href = tab.getAttribute('href') || '';
        if (href.includes('/search-results')) {
            tab.setAttribute('href', href.replace('/search-results', '/ai-search-content'));
        } else if (href.includes('/search-contracts-vendors')) {
            tab.setAttribute('href', href.replace('/search-contracts-vendors', '/ai-search-contracts'));
        }

        const li = tab.parentElement;
        const isContent   = state.searchType === 'content'   && tab.textContent.includes('All Pages');
        const isContracts = state.searchType === 'contracts' && tab.textContent.includes('Contracts');

        if (isContent || isContracts) {
            li.classList.add('is-active');
            tab.setAttribute('aria-current', 'page');
            // Blue (primary) tab: bottom matches blue border for a seamless look
            // Gray tab: white bottom lifts the tab above the gray border
            const isPrimary = tab.classList.contains('primary');
            const borderColor = isPrimary ? '#1F40AF' : '#fff';
            li.style.cssText = 'border-bottom: 5px solid ' + borderColor + '; margin-bottom: -5px; position: relative; z-index: 1;';
        } else {
            li.classList.remove('is-active');
            li.removeAttribute('aria-current');
            li.style.cssText = '';
        }
    });

    // Replace "unnanu" text with logo image in the Powered-by footer (handles twig cache)
    document.querySelectorAll('#unnanu-ai-search-wrapper span').forEach(function(span) {
        if (span.textContent.trim() === 'unnanu') {
            const img = document.createElement('img');
            img.src = '/modules/custom/dir_ai_search/images/unnanu-logo.webp';
            img.alt = 'unnanu';
            img.style.cssText = 'height:16px;width:auto;margin-left:4px;vertical-align:middle';
            span.parentNode.replaceChild(img, span);
        }
    });

    // Make chat messages area scrollable with a fixed max-height on all screen sizes
    if (DOM.chat.scroll) {
        DOM.chat.scroll.style.maxHeight = '480px';
        DOM.chat.scroll.style.overflowY = 'auto';
        DOM.chat.scroll.style.overflowX = 'hidden';
    }

    // We also need to fix the Search Form so it submits to the correct route!
    const searchForm = document.querySelector('main .searchresults-form form');
    if (searchForm) {
        // Drupal form action might be set to the original view path
        searchForm.setAttribute('action', state.searchType === 'content' ? '/ai-search-content' : '/ai-search-contracts');
        // Pre-fill input
        const input = searchForm.querySelector('input[type="search"], input[name="query"], input[name="keys"]');
        if (input && state.query) input.value = state.query;
    }

    if (state.query) {
      performSearch();
    } else {
      DOM.loading.classList.add('hidden');
      DOM.resultsList.innerHTML = '<div class="p-8 text-center text-gray-500">Enter a query to begin your AI search.</div>';
    }
  }

  // Helper: stop all playing media inside a container before destroying it
  function stopAllMedia(container) {
      if (!container) return;
      container.querySelectorAll('video, audio').forEach(el => { el.pause(); el.src = ''; });
      container.querySelectorAll('iframe').forEach(el => { el.src = 'about:blank'; });
      if (state._captionRafId) { cancelAnimationFrame(state._captionRafId); state._captionRafId = null; }
  }

  function closePreview() {
      const overlay = document.getElementById('ai-preview-modal-overlay');
      if (!overlay) return;
      stopAllMedia(overlay);
      if (state._vttBlobUrl) { URL.revokeObjectURL(state._vttBlobUrl); state._vttBlobUrl = null; }
      overlay.remove();
      document.body.style.overflow = '';
      if (state._previewEscHandler) {
          document.removeEventListener('keydown', state._previewEscHandler);
          state._previewEscHandler = null;
      }
  }

  // Build a WebVTT blob URL from transcript text + media duration
  function buildVttBlobUrl(transcriptText, mediaDuration) {
      if (!transcriptText || !mediaDuration || mediaDuration <= 0) return null;
      const sentences = transcriptText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
      if (!sentences.length) return null;
      const segDur = mediaDuration / sentences.length;
      const lines = ['WEBVTT', ''];
      const fmt = (sec) => {
          const ms = Math.max(0, Math.floor(sec * 1000));
          const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
          const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
          const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
          const ml = String(ms % 1000).padStart(3, '0');
          return `${h}:${m}:${s}.${ml}`;
      };
      sentences.forEach((text, i) => {
          lines.push(String(i + 1));
          lines.push(`${fmt(i * segDur)} --> ${fmt((i + 1) * segDur)}`);
          lines.push(text.trim());
          lines.push('');
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/vtt' });
      return URL.createObjectURL(blob);
  }

  function openPreview(item, startTimeStr) {
      // Remove any existing modal first
      const existing = document.getElementById('ai-preview-modal-overlay');
      if (existing) { stopAllMedia(existing); existing.remove(); }
      if (state._vttBlobUrl) { URL.revokeObjectURL(state._vttBlobUrl); state._vttBlobUrl = null; }

      const modality = getModalityFromFile(item);
      const title = item.file_title || item.title || item.file_name || 'Untitled';
      const url = item.source_url || '';
      const isMedia = (modality === 'video' || modality === 'audio');
      const transcriptText = item.transcript_en || '';

      let startSeconds = 0;
      const timeStr = startTimeStr || item.file_start || '';
      if (timeStr) {
          const parts = timeStr.split(':').map(Number);
          if (parts.length === 3) startSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
          else if (parts.length === 2) startSeconds = parts[0] * 60 + parts[1];
          else if (parts.length === 1 && !isNaN(parts[0])) startSeconds = parts[0];
      }

      let mediaHtml = '';
      let embeddedVideoUrl = '';
      if (modality === 'video' && url.includes('youtu')) {
          const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
          if (m) embeddedVideoUrl = `https://www.youtube.com/embed/${m[1]}?autoplay=1&start=${startSeconds}`;
      }

      const iconBg = modality === 'audio' ? 'bg-purple-100 text-purple-700' : modality === 'video' ? 'bg-indigo-100 text-indigo-700' : modality === 'images' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700';
      const titleColor = modality === 'audio' ? 'text-purple-700' : modality === 'video' ? 'text-indigo-700' : modality === 'images' ? 'text-green-700' : 'text-blue-700';
      const headerBg = modality === 'audio' ? '#faf5ff' : modality === 'video' ? '#eef2ff' : modality === 'images' ? '#f0fdf4' : '#eff6ff';

      if (modality === 'video') {
          if (embeddedVideoUrl) {
              mediaHtml = `<iframe src="${embeddedVideoUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%;height:100%;min-height:300px;border:none;background:#000;border-radius:8px"></iframe>`;
          } else {
              mediaHtml = `<div style="width:100%;height:100%;position:relative;background:#000"><video id="preview-media" src="${url}#t=${startSeconds}" controls autoplay style="width:100%;height:100%;object-fit:contain;display:block;background:#000;border-radius:8px"></video><div id="caption-overlay" style="position:absolute;bottom:48px;left:0;right:0;display:none;justify-content:center;pointer-events:none;padding:0 16px"><div style="background:rgba(0,0,0,0.75);color:#fff;padding:6px 16px;border-radius:8px;max-width:85%;text-align:center"><p id="caption-text" style="margin:0;font-size:0.875rem;line-height:1.5"></p></div></div></div>`;
          }
      } else if (modality === 'audio') {
          mediaHtml = `<div style="width:100%;max-width:480px;padding:24px;background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center"><div style="background:#f3e8ff;padding:16px;border-radius:50%;width:64px;height:64px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;color:#7c3aed">${getModalityIcon('audio')}</div><p style="color:#374151;font-weight:500;font-size:0.875rem;margin:0 0 12px">${title}</p><audio id="preview-media" src="${url}#t=${startSeconds}" controls autoplay style="width:100%"></audio><div id="caption-overlay" style="display:none;margin-top:8px;background:rgba(0,0,0,0.8);border-radius:8px;padding:6px 12px"><p id="caption-text" style="margin:0;font-size:0.75rem;color:#fff;text-align:center"></p></div></div>`;
      } else if (modality === 'images') {
          mediaHtml = `<img src="${url}" alt="${title}" style="width:100%;height:100%;object-fit:contain;display:block" />`;
      } else if (url.toLowerCase().endsWith('.pdf')) {
          let ph = '';
          if (startTimeStr && !isNaN(startTimeStr)) ph = `#page=${startTimeStr}`;
          else if (item.file_start && !isNaN(item.file_start)) ph = `#page=${item.file_start}`;
          mediaHtml = `<iframe src="${url}${ph}" title="${title}" style="width:100%;height:100%;border:none;border-radius:8px;background:#fff"></iframe>`;
      } else {
          mediaHtml = `<div style="width:100%;height:100%;display:flex;flex-direction:column"><iframe src="${url}" title="${title}" style="flex:1;min-height:300px;border:none;border-radius:8px;background:#fff"></iframe><div style="text-align:center;padding:10px 16px;flex-shrink:0"><a href="${url}" onclick="window.location.href=this.href;return false;" style="color:#1F40AF;font-size:0.875rem;font-weight:500;text-decoration:underline">Open in this window</a></div></div>`;
      }

      let headerLeftContent = '';
      if (isMedia && !embeddedVideoUrl) {
          headerLeftContent = `
            <div style="display:flex;align-items:center;gap:6px">
              <select id="preview-lang-select" style="font-size:10px;border:1px solid #d1d5db;border-radius:6px;padding:2px 6px;background:#fff;color:#374151;cursor:pointer">
                <option value="en">EN</option>
                <option value="es">ES</option>
                <option value="fr">FR</option>
                <option value="ar">AR</option>
              </select>
              <button type="button" id="btn-cc-toggle" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;font-size:10px;font-weight:700;background:#dbeafe;color:#1d4ed8;border:1px solid #bfdbfe;cursor:pointer" title="Toggle Captions">CC</button>
            </div>`;
      } else {
          headerLeftContent = `<h3 style="font-weight:600;font-size:0.875rem;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="${titleColor}">${title}</h3>`;
      }

      // Build the full modal overlay
      const overlay = document.createElement('div');
      overlay.id = 'ai-preview-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';

      overlay.innerHTML = `
        <div id="ai-preview-modal" style="position:relative;width:92vw;height:92vh;max-width:1400px;background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 25px 60px rgba(0,0,0,0.5)">
          <!-- Header -->
          <div style="background:${headerBg};padding:12px 16px;border-bottom:1px solid #e5e7eb;flex-shrink:0">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
                <div class="${iconBg}" style="padding:8px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center"><div style="width:20px;height:20px">${getModalityIcon(modality)}</div></div>
                ${headerLeftContent}
              </div>
              <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
                <button class="btn-open-chat" style="padding:8px;border-radius:50%;background:transparent;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Close preview and open chat"><svg xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px;color:#2563eb" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg></button>
                <a href="${url}" target="_blank" rel="noopener noreferrer" style="padding:8px;border-radius:50%;display:flex;align-items:center;justify-content:center" title="Open in new tab"><svg xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px;color:#6b7280" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>
                <button class="btn-close-preview" style="padding:8px;border-radius:50%;background:transparent;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Close"><svg xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px;color:#6b7280" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
              </div>
            </div>
          </div>
          ${isMedia && !embeddedVideoUrl ? `<div style="padding:8px 16px;border-bottom:1px solid #e5e7eb;background:#fff;flex-shrink:0"><p class="${titleColor}" style="font-size:0.875rem;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</p></div>` : ''}
          <!-- Content area -->
          <div style="flex:1;min-height:0;background:#f3f4f6;display:flex;align-items:${modality === 'audio' ? 'center' : 'stretch'};justify-content:${modality === 'audio' ? 'center' : 'stretch'};padding:${modality === 'audio' ? '16px' : '0'};overflow:${modality === 'audio' ? 'auto' : 'hidden'}">
            ${mediaHtml}
          </div>
        </div>`;

      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';

      // Close on dark backdrop click (not on modal content)
      overlay.addEventListener('click', function(e) {
          if (e.target === overlay) closePreview();
      });

      // Escape key
      state._previewEscHandler = function(e) { if (e.key === 'Escape') closePreview(); };
      document.addEventListener('keydown', state._previewEscHandler);

      // Button handlers
      overlay.querySelector('.btn-close-preview').onclick = () => closePreview();
      overlay.querySelector('.btn-open-chat').onclick = () => closePreview();

      // === Caption logic (Native VTT for Video, rAF for Audio) ===
      if (isMedia && !embeddedVideoUrl) {
          const mediaEl = overlay.querySelector('#preview-media');
          if (!mediaEl) return;
          let captionsOn = true;

          const attachCaptions = () => {
              const dur = mediaEl.duration;
              if (!dur || !isFinite(dur) || dur <= 0 || !transcriptText.trim()) return;

              if (modality === 'video') {
                  const vttUrl = buildVttBlobUrl(transcriptText, dur);
                  if (vttUrl) {
                      state._vttBlobUrl = vttUrl;
                      const track = document.createElement('track');
                      track.kind = 'captions';
                      track.label = 'English';
                      track.srclang = 'en';
                      track.src = vttUrl;
                      track.default = true;
                      mediaEl.appendChild(track);
                      setTimeout(() => { if (mediaEl.textTracks && mediaEl.textTracks[0]) mediaEl.textTracks[0].mode = 'showing'; }, 100);
                  }
              } else if (modality === 'audio') {
                  const captionOverlay = overlay.querySelector('#caption-overlay');
                  const captionTextEl = overlay.querySelector('#caption-text');
                  if (!captionOverlay || !captionTextEl) return;

                  const sentences = transcriptText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
                  const segDur = dur / sentences.length;
                  const segments = sentences.map((text, i) => ({ text: text.trim(), start: i * segDur, end: (i + 1) * segDur }));

                  const tick = () => {
                      if (!captionsOn) { captionOverlay.style.display = 'none'; state._captionRafId = requestAnimationFrame(tick); return; }
                      const t = mediaEl.currentTime;
                      let active = null;
                      for (let i = segments.length - 1; i >= 0; i--) { if (t >= segments[i].start && t < segments[i].end) { active = segments[i]; break; } }
                      if (active) { captionTextEl.textContent = active.text; captionOverlay.style.display = 'block'; } else { captionOverlay.style.display = 'none'; }
                      state._captionRafId = requestAnimationFrame(tick);
                  };

                  const startTick = () => {
                      if (state._captionRafId) cancelAnimationFrame(state._captionRafId);
                      state._captionRafId = requestAnimationFrame(tick);
                  };
                  mediaEl.addEventListener('play', startTick);
                  mediaEl.addEventListener('pause', () => { if (state._captionRafId) { cancelAnimationFrame(state._captionRafId); state._captionRafId = null; } });
                  if (!mediaEl.paused) startTick();
              }
          };

          if (mediaEl.readyState >= 1) attachCaptions();
          else mediaEl.addEventListener('loadedmetadata', attachCaptions, { once: true });

          const ccBtn = overlay.querySelector('#btn-cc-toggle');
          if (ccBtn) {
              ccBtn.onclick = (e) => {
                  e.stopPropagation();
                  captionsOn = !captionsOn;
                  if (captionsOn) {
                      ccBtn.style.background = '#dbeafe'; ccBtn.style.color = '#1d4ed8'; ccBtn.style.borderColor = '#bfdbfe';
                      ccBtn.title = 'Captions ON';
                      if (modality === 'video' && mediaEl.textTracks && mediaEl.textTracks[0]) mediaEl.textTracks[0].mode = 'showing';
                  } else {
                      ccBtn.style.background = '#f3f4f6'; ccBtn.style.color = '#9ca3af'; ccBtn.style.borderColor = '#d1d5db';
                      ccBtn.title = 'Captions OFF';
                      if (modality === 'video' && mediaEl.textTracks && mediaEl.textTracks[0]) mediaEl.textTracks[0].mode = 'hidden';
                      if (modality === 'audio') {
                          const box = overlay.querySelector('#caption-overlay');
                          if (box) box.style.display = 'none';
                      }
                  }
              };
          }
      }
  }


  function setLoading(isLoading) {
    state.isLoading = isLoading;
    if (isLoading) {
      DOM.loading.innerHTML =
          '<div class="animate-spin rounded-full h-10 w-10 border-b-2 border-t-2 border-[#1F40AF]"></div>' +
          '<p class="text-sm text-gray-500 m-0">Fetching results, please wait\u2026</p>';
      DOM.loading.className = 'flex flex-col items-center justify-center gap-3 p-12';
      DOM.loading.classList.remove('hidden');
      DOM.resultsList.innerHTML = '';
      DOM.error.classList.add('hidden');
      DOM.metadata.classList.add('hidden');
    } else {
      DOM.loading.classList.add('hidden');
    }
  }

  function showError(msg) {
    DOM.error.textContent = msg;
    DOM.error.classList.remove('hidden');
    DOM.loading.classList.add('hidden');
  }

  async function performSearch() {
    setLoading(true);
    try {
      if (state.searchType === 'contracts') {
        const res = await fetch(`${PROXY_BASE}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ type: 'contracts', query: state.query, view: state.chatView })
        });
        if (!res.ok) throw new Error('Search API error');
        const data = await res.json();

        if (data.view) state.chatView = data.view;

        let vendors = Array.isArray(data) ? data : (data.data || []);
        vendors.sort((a, b) => (a.Vendor_Name || '').localeCompare(b.Vendor_Name || ''));
        state.vendors = vendors;

        renderContracts(vendors);

      } else {
        const res = await fetch(`${PROXY_BASE}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ type: 'content', query: state.query })
        });
        if (!res.ok) throw new Error('Content API error');
        const data = await res.json();

        let content = Array.isArray(data) ? data : (data.data || []);
        state.contentData = content;
        state.contentChatSuggestions = Array.isArray(data.chat) ? data.chat : [];

        renderContent(content);
      }
    } catch (err) {
      console.error(err);
      showError('Sorry, there was an error processing your search. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function getModalityFromFile(file) {
    if (file.source) {
      const s = file.source.toUpperCase();
      if (s === "A" || s === "AUDIO") return "audio";
      if (s === "V" || s === "VIDEO") return "video";
      if (s === "I" || s === "IMAGE" || s === "IMAGES") return "images";
      if (s === "D" || s === "DOCUMENT" || s === "DOCUMENTS" || s === "DOC") return "documents";
    }
    const rawUrl = (file.source_url || file.file_name || "").toLowerCase();
    const url = rawUrl.split(/[?#]/)[0];
    if (/\\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(url) || url.includes("/audio/")) return "audio";
    if (/\\.(mp4|mov|avi|mkv|webm|wmv)$/i.test(url) || url.includes("/video/")) return "video";
    if (/\\.(jpg|jpeg|png|gif|svg|webp|bmp)$/i.test(url) || url.includes("/images/") || url.includes("/image/")) return "images";
    return "documents";
  }

  function getModalityIcon(modality) {
    switch (modality) {
      case 'audio':
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-full w-full" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>`;
      case 'video':
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-full w-full" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>`;
      case 'images':
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-full w-full" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`;
      case 'documents':
      default:
        return `<svg xmlns="http://www.w3.org/2000/svg" class="h-full w-full" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>`;
    }
  }

  function renderContracts(vendors) {
    DOM.resultsList.innerHTML = '';

    if (vendors.length === 0) {
      DOM.resultsList.innerHTML = '<div class="p-8 text-center text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200">No vendors found matching your query.</div>';
      return;
    }

    DOM.metadata.classList.add('hidden');

    // ── Breadcrumb + count pill (matches Files search nav row) ───────────────
    const pillActiveClass = 'flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[15px] font-medium transition-colors border-[#1F40AF] bg-[#1F40AF] text-white shadow-sm cursor-default';
    const navRow = document.createElement('div');
    navRow.className = 'mb-4 flex items-center gap-3 flex-wrap';
    navRow.innerHTML = `
      <div class="flex items-center text-[15px] text-gray-500 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px;margin-right:5px;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
        <a href="/" class="hover:underline text-gray-500">Home</a><span class="mx-2">&gt;</span><span>Contracts &amp; Vendors</span>
      </div>
    `;
    const filtersContainer = document.getElementById('ai-search-filters-container');
    if (filtersContainer) {
        filtersContainer.innerHTML = '';
        filtersContainer.appendChild(navRow);
    }

    const activeMinority = vendors.reduce(
        (count, vendor) => vendor.Hub_Type !== "others" && vendor.Active_status === 1 ? 1 + count : count, 0
    );
    const activeContractsCount = vendors.reduce(
        (count, vendor) => vendor.Active_status === 1 ? count + (vendor.other_contracts_count || 0) : count, 0
    );

    // ── Summary stats (always visible, never paginated) ──────────────────────
    const summaryCards = document.createElement('div');
    summaryCards.className = 'grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 mt-2 text-[#1F40AF]';
    summaryCards.innerHTML = `
      <div class="bg-blue-100 rounded-xl text-left px-4 py-3">
        <p class="text-lg font-medium m-0"># of Active Vendors</p>
        <h1 class="text-4xl font-bold py-2 m-0">${vendors.length}</h1>
      </div>
      <div class="bg-blue-100 rounded-xl text-left py-3 px-4">
        <p class="text-lg font-medium m-0"># of Active Minority</p>
        <h1 class="text-4xl font-bold py-2 m-0">${activeMinority}</h1>
      </div>
      <div class="bg-blue-100 rounded-xl text-left px-4 py-3">
        <p class="text-lg font-medium m-0"># of Active Contracts</p>
        <h1 class="text-4xl font-bold py-2 m-0">${activeContractsCount}</h1>
      </div>
    `;
    DOM.resultsList.appendChild(summaryCards);

    const heading = document.createElement('h2');
    heading.className = 'text-xl text-gray-800 m-0 mb-4 pb-2 border-b border-gray-100';
    heading.innerHTML = `Here's <span class="font-semibold">a list of all vendors</span> who meet the above AI-Search query.`;
    DOM.resultsList.appendChild(heading);

    // ── Paginated vendor cards ────────────────────────────────────────────────
    const cardsContainer = document.createElement('div');
    cardsContainer.id = 'ai-cards-list';
    cardsContainer.className = 'space-y-3';
    DOM.resultsList.appendChild(cardsContainer);

    const paginationContainer = document.createElement('div');
    paginationContainer.id = 'ai-pagination';
    DOM.resultsList.appendChild(paginationContainer);

    state.contractsVendors = vendors;
    renderVendorPage(1);
  }

  // ─── Render one page of vendor cards ──────────────────────────────────────
  function renderVendorPage(page) {
    state.currentPage = page;
    const vendors    = state.contractsVendors || [];
    const totalPages = Math.ceil(vendors.length / ITEMS_PER_PAGE);
    const start      = (page - 1) * ITEMS_PER_PAGE;
    const pageVendors = vendors.slice(start, start + ITEMS_PER_PAGE);

    const cardsContainer = document.getElementById('ai-cards-list');
    if (!cardsContainer) return;
    cardsContainer.innerHTML = '';

    if (page > 1 && DOM.resultsList) {
        DOM.resultsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    pageVendors.forEach(vendor => {
      const isActive    = vendor.Active_status === 1;
      const statusColor = isActive ? 'text-green-600' : 'text-gray-500';
      const statusText  = isActive ? 'Active' : 'Inactive';
      const hubType     = vendor.Hub_Type !== 'others' ? vendor.Hub_Type : 'Non-HUB';

      let contractsHtml = '';
      if (vendor.other_contracts) {
          contractsHtml = vendor.other_contracts.split(',').map(c => c.trim()).map(c => `
              <a href="https://dir.texas.gov/contracts/${c}" target="_blank" class="inline-flex items-center justify-center bg-[#1F40AF] text-white text-sm font-semibold px-3 py-1 rounded-md leading-none no-underline hover:opacity-90">
                  ${c}
              </a>
          `).join('');
      }

      const vendorNameUrl = (vendor.Vendor_Name || '').replace(/^The\s+/i, '').trim()
          .replace(/\s+/g, '-').replace(/[,&()./]+/g, '').replace(/-+/g, '-');
      const overview = vendor.Contract_Overview || 'No description available.';
      const shortOverview = overview.length > 220 ? overview.substring(0, 220) + ' …' : overview;

      const card = document.createElement('div');
      card.className = 'rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden';
      card.innerHTML = `
        <div class="p-4">
          <div class="flex items-start justify-between gap-3 mb-1">
            <span class="text-sm font-semibold ${statusColor}">Vendor &bull; ${statusText}</span>
            <span class="inline-flex items-center justify-center bg-[#1F40AF] text-white text-xs font-semibold px-2.5 py-1 rounded-md whitespace-nowrap leading-none flex-shrink-0">
              ${hubType}
            </span>
          </div>
          <a href="https://dir.texas.gov/contracts/vendors/${vendorNameUrl}" target="_blank" rel="noopener noreferrer"
             class="block font-bold text-[#1F40AF] text-xl leading-snug hover:underline mb-2">
            ${vendor.Vendor_Name || 'Unknown Vendor'}
          </a>
          <p class="text-sm text-gray-600 leading-relaxed m-0 mb-3">${shortOverview}</p>
          ${contractsHtml ? `
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 m-0">Active Contracts</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${contractsHtml}</div>` : ''}
        </div>
      `;
      cardsContainer.appendChild(card);
    });

    renderPagination(page, totalPages);
  }

  function renderContent(items) {
    DOM.resultsList.innerHTML = '';
    
    if (items.length === 0) {
      DOM.resultsList.innerHTML = '<div class="p-8 text-center text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200">No content found matching your query.</div>';
      if (DOM.faq.container) DOM.faq.container.classList.add('hidden');
      return;
    }

    // Deduplicate items based on 'id' if possible
    const seenIds = new Set();
    const uniqueItems = items.filter(file => {
      if (!file.id) return true;
      if (seenIds.has(file.id)) return false;
      seenIds.add(file.id);
      return true;
    });

    const counts = { documents: 0, audio: 0, video: 0, images: 0 };
    uniqueItems.forEach(item => {
        counts[getModalityFromFile(item)]++;
    });

    // Create Breadcrumb and Filters Pill row
    const filtersRow = document.createElement('div');
    filtersRow.className = 'mb-7 flex items-center gap-3 flex-wrap';

    const pillActiveClass  = 'flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[15px] font-medium transition-colors border-[#1F40AF] bg-[#1F40AF] text-white shadow-sm cursor-pointer';
    const pillInactiveClass = 'flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[15px] font-medium transition-colors border-gray-200 bg-gray-50 text-gray-800 hover:border-[#1F40AF] hover:text-[#1F40AF] shadow-sm cursor-pointer';

    let pillsHtml = `
      <div class="flex items-center text-[15px] text-gray-500 shrink-0 mr-2">
        <svg xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px;margin-right:5px;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
        <a href="/" class="hover:underline text-gray-500">Home</a><span class="mx-2">&gt;</span><span>Files &amp; Content</span>
      </div>
      <div id="filter-pills-row" class="flex flex-wrap gap-3">
        <button data-modality="all" class="${pillActiveClass}">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16M2 6h.01M2 12h.01M2 18h.01" />
          </svg>
          <span class="font-semibold leading-none">${uniqueItems.length}</span>
        </button>
    `;

    ['documents', 'audio', 'video', 'images'].forEach(modality => {
       if (counts[modality] > 0) {
          pillsHtml += `
            <button data-modality="${modality}" class="${pillInactiveClass}">
               <span class="h-4 w-4 flex items-center justify-center">${getModalityIcon(modality)}</span>
               <span class="font-semibold leading-none">${counts[modality]}</span>
            </button>
          `;
       }
    });

    pillsHtml += `</div>`;
    filtersRow.innerHTML = pillsHtml;

    const filtersContainer = document.getElementById('ai-search-filters-container');
    if (filtersContainer) {
        filtersContainer.innerHTML = '';
        filtersContainer.appendChild(filtersRow);
    } else {
        DOM.resultsList.appendChild(filtersRow);
    }

    // Containers for cards + pagination (reused across page/filter changes)
    const listContainer = document.createElement('div');
    listContainer.id = 'ai-cards-list';
    listContainer.className = 'space-y-3';
    const paginationContainer = document.createElement('div');
    paginationContainer.id = 'ai-pagination';
    DOM.resultsList.appendChild(listContainer);
    DOM.resultsList.appendChild(paginationContainer);

    // Store items in state and render page 1
    state.allUniqueItems = uniqueItems;
    state.filteredItems  = uniqueItems;
    state.activeModality = 'all';
    state.currentPage    = 1;
    renderPageCards(1);

    // Filter pill handlers — re-render cards instead of CSS show/hide
    const pillsRow = filtersRow.querySelector('#filter-pills-row');
    if (pillsRow) {
        pillsRow.querySelectorAll('button[data-modality]').forEach(pill => {
            pill.onclick = () => {
                const target = pill.dataset.modality;
                state.activeModality = target;
                state.filteredItems  = target === 'all'
                    ? state.allUniqueItems
                    : state.allUniqueItems.filter(i => getModalityFromFile(i) === target);
                pillsRow.querySelectorAll('button[data-modality]').forEach(p => {
                    p.className = p === pill ? pillActiveClass : pillInactiveClass;
                });
                renderPageCards(1);
            };
        });
    }

    renderFaq();
  }

  // ─── Render one page of cards ─────────────────────────────────────────────
  function renderPageCards(page) {
    state.currentPage = page;
    const items      = state.filteredItems;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const start      = (page - 1) * ITEMS_PER_PAGE;
    const pageItems  = items.slice(start, start + ITEMS_PER_PAGE);

    const listContainer = document.getElementById('ai-cards-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    // Scroll results into view smoothly on page change
    if (page > 1 && DOM.resultsList) {
        DOM.resultsList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    pageItems.forEach(item => {
      const title = item.file_title || item.title || item.file_name || 'Untitled Document';
      const url = item.source_url || '#';
      let snippet = item.fileabstract || item.summary || item.body || item.content || '';
      const modality = getModalityFromFile(item);
      
      let bgClass = '', textClass = '';
      if (modality === 'documents') {
         bgClass = 'bg-blue-100'; textClass = 'text-blue-700';
      } else if (modality === 'audio') {
         bgClass = 'bg-purple-100'; textClass = 'text-purple-700';
      } else if (modality === 'video') {
         bgClass = 'bg-indigo-100'; textClass = 'text-indigo-700';
      } else if (modality === 'images') {
         bgClass = 'bg-green-100'; textClass = 'text-green-700';
      }

      // Thumbnail logic
      let thumbImg = item.thumbnail_url;
      if (!thumbImg && modality === 'video' && url.includes('youtu')) {
         const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
         if (match) {
             thumbImg = `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
         }
      }

      let visualHtml = '';
      if (thumbImg) {
          visualHtml = `
            <div style="position:relative;width:100%;height:100%">
               <img src="${thumbImg}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
               <div style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;background:#f9fafb">
                  <div class="${bgClass} ${textClass}" style="padding:8px;border-radius:8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center">
                    ${getModalityIcon(modality)}
                  </div>
               </div>
               ${modality === 'video' ? `
               <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.2)">
                 <div style="background:#fff;border-radius:50%;padding:6px;box-shadow:0 2px 4px rgba(0,0,0,0.2)">
                   <svg style="width:16px;height:16px;color:#dc2626;margin-left:2px" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                 </div>
               </div>` : ''}
            </div>
          `;
      } else {
          visualHtml = `
            <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px">
              <div class="${bgClass} ${textClass}" style="padding:8px;border-radius:8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center">
                ${getModalityIcon(modality)}
              </div>
            </div>
          `;
      }

      let topicsCount = 0;
      if (item.DocSectionResult && Array.isArray(item.DocSectionResult)) {
          topicsCount = item.DocSectionResult.length;
      }

      const card = document.createElement('div');
      card.className = 'rounded-xl p-3 transition-all border border-gray-200 bg-white hover:shadow-sm cursor-pointer relative';
      card.dataset.modality = modality;

      // Determine if this item can be previewed in a modal
      const canPreview = (modality === 'video' || modality === 'audio' || modality === 'images')
                       || (modality === 'documents' && url.toLowerCase().endsWith('.pdf'));

      // Make whole card clickable
      card.onclick = (e) => {
          if (!e.target.closest('a, button, details, summary')) {
              if (canPreview) {
                  openPreview(item, null);
              } else if (url && url !== '#') {
                  window.open(url, '_blank', 'noopener noreferrer');
              }
          }
      };
      card.innerHTML = `
        <div class="absolute top-3 right-3 z-10 hidden sm:block">
          <div class="relative inline-block text-left group">
            <button type="button" class="inline-flex justify-center items-center w-full rounded-md border border-gray-200 px-3 py-1.5 bg-white text-[13px] font-medium text-gray-700 hover:bg-gray-50 focus:outline-none">
              <svg class="mr-1.5 h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              English
              <svg class="-mr-1 ml-1 h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
            <div class="origin-top-right absolute right-0 mt-1 w-32 rounded-xl shadow-lg bg-white ring-1 ring-black ring-opacity-5 hidden group-hover:block overflow-hidden">
              <div class="py-1">
                <a href="#" class="bg-blue-500 text-white block px-4 py-2 text-sm no-underline">English</a>
                <a href="#" class="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100 no-underline">Español</a>
                <a href="#" class="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100 no-underline">Français</a>
                <a href="#" class="text-gray-700 block px-4 py-2 text-sm hover:bg-gray-100 no-underline">العربية</a>
              </div>
            </div>
          </div>
        </div>
        <div class="flex gap-3">
          <div class="relative rounded-lg overflow-hidden flex-shrink-0 bg-gray-50 border border-gray-100 shadow-sm" style="width:72px;height:72px;min-width:72px">
            ${visualHtml}
          </div>
          <div class="flex-1 min-w-0 pr-0 sm:pr-24">
            <div class="flex items-start justify-between gap-2 mb-1">
              <button type="button" class="btn-open-preview font-bold text-[#1F40AF] text-base leading-snug line-clamp-2 hover:underline m-0 text-left bg-transparent border-0 p-0 cursor-pointer flex-1">
                  ${title}
              </button>
              <div class="shrink-0 ml-2 hidden sm:block">
                  <button type="button" class="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors shadow-sm cursor-pointer">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
                      English
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                  </button>
              </div>
            </div>
            <p class="card-snippet text-gray-500 text-sm leading-snug line-clamp-2 transition-all" style="margin:0 0 4px">
                ${snippet}
            </p>
            <button class="btn-view-more text-[#1F40AF] text-xs font-medium hover:underline bg-transparent border-0 p-0 cursor-pointer inline-flex items-center" style="margin-bottom:4px">
                <span>View More</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            <div class="flex flex-col gap-0 mt-1">
              <button class="btn-summary flex items-center text-xs font-semibold text-[#0E2A84] hover:opacity-80 transition-opacity bg-transparent border-0 p-0 cursor-pointer">
                <svg class="h-5 w-5 mr-1.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
                <span>${(modality === 'audio' || modality === 'video') ? 'Show Transcript' : 'Show Summary'}</span>
              </button>
              <div class="summary-container hidden mt-2 bg-gray-50 rounded-lg p-3 text-[14px] text-gray-600 max-h-48 overflow-y-auto">
                 ${(modality === 'audio' || modality === 'video') ? (item.transcript_en || snippet) : (item.summary || snippet)}
              </div>
              
              ${topicsCount > 0 ? `
              <div class="mt-1">
                <button class="btn-topics flex items-center text-xs font-semibold text-[#0E2A84] hover:opacity-80 transition-opacity bg-transparent border-0 p-0 cursor-pointer">
                  <svg class="h-5 w-5 mr-1.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                  <span>Show Topics (${topicsCount})</span>
                </button>
                <div class="topics-container hidden mt-2 space-y-2">
                   ${item.DocSectionResult.map((t, idx) => {
                     const tTitle = t.file_title || "Section";
                     const tAbstract = t.fileabstract || "";
                     const tSummary = t.summary || "";
                     const hasAbstract = Boolean(tAbstract);
                     const hasSummary = Boolean(tSummary);
                     
                     return `
                     <div class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                       <div class="flex items-start justify-between gap-2">
                         <button type="button" class="btn-topic-link flex-1 text-left text-[14px] font-medium text-[#1F40AF] leading-snug hover:underline bg-transparent border-0 p-0 cursor-pointer w-full pr-2" data-topic-index="${idx}" data-start-time="${t.file_start || ''}">
                           ${tTitle}
                         </button>
                         <button type="button" class="btn-topic-expand shrink-0 rounded p-0.5 text-[#1F40AF] hover:bg-white/60 transition-colors bg-transparent border-0 cursor-pointer" data-topic-index="${idx}">
                           <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transform transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                           </svg>
                         </button>
                       </div>
                       <div class="topic-content hidden mt-2 space-y-2" data-topic-content="${idx}">
                         ${hasAbstract ? `<p class="text-[14px] text-gray-600 leading-relaxed m-0">${tAbstract}</p>` : ''}
                         ${hasSummary ? `
                         <details class="border-t border-gray-200 pt-2 group/summary outline-none">
                           <summary class="text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer list-none flex items-center justify-between hover:text-[#1F40AF] transition-colors outline-none">
                             <span>Summary</span>
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transform transition-transform group-open/summary:rotate-180 outline-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                             </svg>
                           </summary>
                           <p class="mt-2 text-[14px] text-gray-600 leading-relaxed m-0">${tSummary}</p>
                         </details>
                         ` : ''}
                       </div>
                     </div>
                     `;
                   }).join('')}
                </div>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;
      
      // Attach Event Listeners
      const viewMoreBtn = card.querySelector('.btn-view-more');
      if (viewMoreBtn) {
          viewMoreBtn.onclick = (e) => {
              e.stopPropagation();
              const p = card.querySelector('.card-snippet');
              const span = viewMoreBtn.querySelector('span');
              const svg = viewMoreBtn.querySelector('svg');
              if (p.classList.contains('line-clamp-3')) {
                  p.classList.remove('line-clamp-3');
                  span.textContent = 'View Less';
                  svg.classList.add('rotate-180');
              } else {
                  p.classList.add('line-clamp-3');
                  span.textContent = 'View More';
                  svg.classList.remove('rotate-180');
              }
          };
      }

      const summaryBtn = card.querySelector('.btn-summary');
      if (summaryBtn) {
          summaryBtn.onclick = (e) => {
              e.stopPropagation();
              const container = card.querySelector('.summary-container');
              const svg = summaryBtn.querySelector('svg');
              const span = summaryBtn.querySelector('span');
              const baseText = (modality === 'audio' || modality === 'video') ? 'Transcript' : 'Summary';
              
              if (container.classList.contains('hidden')) {
                  container.classList.remove('hidden');
                  svg.classList.add('rotate-180');
                  span.textContent = `Hide ${baseText}`;
              } else {
                  container.classList.add('hidden');
                  svg.classList.remove('rotate-180');
                  span.textContent = `Show ${baseText}`;
              }
          };
      }

      const topicsBtn = card.querySelector('.btn-topics');
      if (topicsBtn) {
          topicsBtn.onclick = (e) => {
              e.stopPropagation();
              const container = card.querySelector('.topics-container');
              const svg = topicsBtn.querySelector('svg');
              const span = topicsBtn.querySelector('span');
              
              if (container.classList.contains('hidden')) {
                  container.classList.remove('hidden');
                  svg.classList.add('rotate-180');
                  span.textContent = `Hide Topics (${topicsCount})`;
              } else {
                  container.classList.add('hidden');
                  svg.classList.remove('rotate-180');
                  span.textContent = `Show Topics (${topicsCount})`;
              }
          };
      }
      
      const titleBtn = card.querySelector('.btn-open-preview');
      if (titleBtn) {
          titleBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (canPreview) {
                  openPreview(item, null);
              } else if (url && url !== '#') {
                  window.open(url, '_blank', 'noopener noreferrer');
              }
          };
      }

      const topicLinks = card.querySelectorAll('.btn-topic-link');
      topicLinks.forEach(btn => {
          btn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const startTimeStr = btn.getAttribute('data-start-time');
              if (canPreview) {
                  openPreview(item, startTimeStr);
              } else if (url && url !== '#') {
                  window.open(url, '_blank', 'noopener noreferrer');
              }
          };
      });
      
      const topicExpandBtns = card.querySelectorAll('.btn-topic-expand');
      topicExpandBtns.forEach(btn => {
          btn.onclick = (e) => {
              e.stopPropagation();
              const idx = btn.getAttribute('data-topic-index');
              const content = card.querySelector(`[data-topic-content="${idx}"]`);
              const svg = btn.querySelector('svg');
              if (content.classList.contains('hidden')) {
                  content.classList.remove('hidden');
                  svg.classList.add('rotate-180');
              } else {
                  content.classList.add('hidden');
                  svg.classList.remove('rotate-180');
              }
          };
      });
      
      listContainer.appendChild(card);
    });

    renderPagination(page, totalPages);
  }

  // ─── Pagination controls ──────────────────────────────────────────────────
  function renderPagination(currentPage, totalPages) {
    const container = document.getElementById('ai-pagination');
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    const btnBase = 'display:inline-flex;align-items:center;justify-content:center;min-width:36px;height:36px;padding:0 10px;border-radius:8px;font-size:0.875rem;font-weight:500;cursor:pointer;border:1px solid;transition:background 0.15s;';
    const btnActive   = btnBase + 'background:#1F40AF;color:#fff;border-color:#1F40AF;';
    const btnInactive = btnBase + 'background:#fff;color:#374151;border-color:#e5e7eb;';
    const btnDisabled = btnBase + 'background:#f9fafb;color:#9ca3af;border-color:#e5e7eb;cursor:default;';

    // Build page window: always show first, last, current ±1, with ellipsis
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            pages.push(i);
        } else if (pages[pages.length - 1] !== '...') {
            pages.push('...');
        }
    }

    let html = '<div style="display:flex;align-items:center;justify-content:center;gap:6px;padding:20px 0">';

    // Prev button
    html += `<button data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} style="${currentPage === 1 ? btnDisabled : btnInactive}">
        <svg xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
    </button>`;

    pages.forEach(p => {
        if (p === '...') {
            html += `<span style="${btnDisabled}pointer-events:none">…</span>`;
        } else {
            html += `<button data-page="${p}" style="${p === currentPage ? btnActive : btnInactive}">${p}</button>`;
        }
    });

    // Next button
    html += `<button data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} style="${currentPage === totalPages ? btnDisabled : btnInactive}">
        <svg xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
    </button>`;

    html += `<span style="font-size:0.8rem;color:#6b7280;margin-left:8px">Page ${currentPage} of ${totalPages}</span>`;
    html += '</div>';

    container.innerHTML = html;

    container.querySelectorAll('button[data-page]:not([disabled])').forEach(btn => {
        btn.addEventListener('mouseenter', () => { if (parseInt(btn.dataset.page) !== currentPage) btn.style.background = '#f3f4f6'; });
        btn.addEventListener('mouseleave', () => { if (parseInt(btn.dataset.page) !== currentPage) btn.style.background = '#fff'; });
        btn.onclick = () => renderPageCards(parseInt(btn.dataset.page));
    });
  }

  function renderFaq() {
      if (!DOM.faq.container) return;
      if (!state.contentChatSuggestions || state.contentChatSuggestions.length === 0) {
          DOM.faq.container.classList.add('hidden');
          return;
      }

      const suggestions = state.contentChatSuggestions.filter(item => {
          const source = (item.source || '').toLowerCase();
          return source !== 'images' && source !== 'image';
      });

      if (suggestions.length === 0) {
          DOM.faq.container.classList.add('hidden');
          return;
      }

      DOM.faq.container.classList.remove('hidden');
      DOM.faq.container.classList.add('flex');
      DOM.faq.list.innerHTML = '';

      // Render each suggestion as a clickable pill inside the FAQ panel
      const pillsWrapper = document.createElement('div');
      pillsWrapper.className = 'flex flex-col gap-1 p-2';

      suggestions.forEach(item => {
          const q = item.question || '';
          if (!q) return;
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-full transition-colors cursor-pointer border-0 text-left w-full';
          pill.textContent = q;
          pill.onclick = () => {
              DOM.chat.input.value = q;
              handleChatSubmit(null);
          };
          pillsWrapper.appendChild(pill);
      });

      DOM.faq.list.appendChild(pillsWrapper);
  }

  // ─── Helper: scroll to bottom of the chat scroll container ──────────────────
  function chatScrollBottom() {
      if (DOM.chat.scroll) DOM.chat.scroll.scrollTop = DOM.chat.scroll.scrollHeight;
  }

  // ─── Download chat transcript ─────────────────────────────────────────────
  function downloadChat() {
      if (!DOM.chat.messages) return;
      const lines = [];
      DOM.chat.messages.querySelectorAll('[data-chat-role]').forEach(el => {
          const role = el.getAttribute('data-chat-role');
          lines.push((role === 'user' ? 'User: ' : 'AI: ') + el.textContent.trim());
      });
      if (!lines.length) return;
      const blob = new Blob([lines.join('\n\n')], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'ai-chat-transcript.txt';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // ─── InputMessage — user's question (matches original: italic blue right-aligned) ──
  function appendUserMessage(text) {
      const el = document.createElement('div');
      el.setAttribute('data-chat-role', 'user');
      el.className = 'text-sm italic text-right text-blue-800 font-medium px-2 py-1 rounded';
      const span = document.createElement('span');
      span.className = 'bg-blue-100 px-2 py-1 rounded inline-block';
      span.textContent = text;
      el.appendChild(span);
      DOM.chat.messages.appendChild(el);
      chatScrollBottom();
  }

  // ─── TextMessage — AI plain-text reply (matches original TextMessage component) ──
  function appendTextMessage(text) {
      const el = document.createElement('div');
      el.setAttribute('data-chat-role', 'ai');
      el.className = 'space-y-2';

      const header = document.createElement('div');
      header.className = 'flex items-center space-x-1 mb-2';
      header.innerHTML =
          '<img src="/favicon.ico" class="h-4" alt="" onerror="this.style.display=\'none\'">' +
          '<strong class="text-gray-800 text-sm">Response:</strong>';
      el.appendChild(header);

      const p = document.createElement('p');
      p.className = 'text-gray-700 text-sm m-0';
      p.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      el.appendChild(p);

      DOM.chat.messages.appendChild(el);
      chatScrollBottom();
  }

  // ─── ErrorMessage ─────────────────────────────────────────────────────────
  function appendErrorMessage(text) {
      const el = document.createElement('div');
      el.setAttribute('data-chat-role', 'ai');
      el.className = 'bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded relative';
      el.innerHTML = '<span class="block text-red-800 text-sm">' + text + '</span>';
      DOM.chat.messages.appendChild(el);
      chatScrollBottom();
  }

  // Build the view object from current content search results, grouping file IDs by modality.
  // Matches exactly what the original React app sends via buildViewFromFilesData().
  function buildViewFromContentData() {
      const audioIds = [], videoIds = [], docIds = [], imageIds = [];
      state.contentData.forEach(function(file) {
          var modality = getModalityFromFile(file);
          if (modality === 'audio') audioIds.push(file.id);
          else if (modality === 'video') videoIds.push(file.id);
          else if (modality === 'images') imageIds.push(file.id);
          else docIds.push(file.id);
      });
      return {
          A: audioIds.join(','),
          V: videoIds.join(','),
          D: docIds.join(','),
          I: imageIds.join(',')
      };
  }

  // ─── ChatResponseMessage — content file cards (matches original exactly) ────
  // Original: favicon + "Response:" header, then one card per file (rounded-lg,
  // colored border/bg by modality, icon + title + snippet + View More toggle),
  // then outputAction icon row at bottom.
  function appendChatFiles(files) {
      if (!files || files.length === 0) return;

      const el = document.createElement('div');
      el.setAttribute('data-chat-role', 'ai');
      el.className = 'space-y-3';

      // Header: favicon + "Response:"
      const header = document.createElement('div');
      header.className = 'flex items-center space-x-1 mb-2';
      header.innerHTML =
          '<img src="/favicon.ico" class="h-4" alt="" onerror="this.style.display=\'none\'">' +
          '<strong class="text-gray-500 text-sm">Response:</strong>';
      el.appendChild(header);

      // One card per file
      const cardsWrap = document.createElement('div');
      cardsWrap.className = 'space-y-2';

      const modalityColors = {
          audio:     { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', iconBg: 'bg-purple-100' },
          video:     { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', iconBg: 'bg-indigo-100' },
          documents: { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   iconBg: 'bg-blue-100'   },
          images:    { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  iconBg: 'bg-green-100'  }
      };

      files.forEach(function(file) {
          const modality  = getModalityFromFile(file);
          const c         = modalityColors[modality] || modalityColors.documents;
          const title     = file.file_title || file.title || file.file_name || 'Untitled';
          const snippet   = file.fileabstract || file.summary || file.body || file.content || '';
          const startTime = file.file_start || null;
          const isLong    = snippet.length > 180;

          // card — matches: `w-full rounded-lg border ${colors.border} ${colors.bg} p-3`
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'w-full rounded-lg border ' + c.border + ' ' + c.bg +
              ' p-3 text-left hover:shadow-sm transition-shadow cursor-pointer block';

          // inner layout: icon + text
          const row = document.createElement('div');
          row.className = 'flex items-start gap-2';

          // modality icon
          const iconWrap = document.createElement('div');
          iconWrap.className = 'mt-0.5 flex-shrink-0 ' + c.text;
          iconWrap.innerHTML = '<div class="h-4 w-4">' + getModalityIcon(modality) + '</div>';
          row.appendChild(iconWrap);

          // text column
          const textCol = document.createElement('div');
          textCol.className = 'flex-1 min-w-0';

          const titleEl = document.createElement('p');
          titleEl.className = 'font-medium text-sm ' + c.text + ' line-clamp-2 m-0 leading-snug';
          titleEl.textContent = title;
          textCol.appendChild(titleEl);

          if (snippet) {
              const snipEl = document.createElement('p');
              snipEl.className = 'mt-1 text-xs text-gray-600 m-0 line-clamp-2 leading-relaxed snip-text';
              snipEl.textContent = snippet;
              textCol.appendChild(snipEl);

              if (isLong) {
                  const moreBtn = document.createElement('button');
                  moreBtn.type = 'button';
                  moreBtn.className = 'mt-1 text-xs font-medium text-blue-700 hover:underline bg-transparent border-0 p-0 cursor-pointer';
                  moreBtn.textContent = 'View More';
                  moreBtn.onclick = function(e) {
                      e.stopPropagation();
                      const expanded = snipEl.classList.toggle('line-clamp-2');
                      moreBtn.textContent = snipEl.classList.contains('line-clamp-2') ? 'View More' : 'View Less';
                  };
                  textCol.appendChild(moreBtn);
              }
          }

          row.appendChild(textCol);
          card.appendChild(row);

          // clicking the card opens the preview at the correct page / timestamp
          card.onclick = function() { openPreview(file, startTime); };

          cardsWrap.appendChild(card);
      });

      el.appendChild(cardsWrap);

      // outputAction row — small icon matching original (use a share-like icon as stand-in)
      const actionRow = document.createElement('div');
      actionRow.className = 'flex items-center gap-3 mt-1';
      actionRow.innerHTML =
          '<button type="button" title="Helpful" class="text-gray-300 hover:text-green-500 transition-colors bg-transparent border-0 cursor-pointer p-0">' +
              '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"/></svg>' +
          '</button>' +
          '<button type="button" title="Not helpful" class="text-gray-300 hover:text-red-500 transition-colors bg-transparent border-0 cursor-pointer p-0">' +
              '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"/></svg>' +
          '</button>' +
          '<button type="button" title="Share" class="text-gray-300 hover:text-blue-500 transition-colors bg-transparent border-0 cursor-pointer p-0">' +
              '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>' +
          '</button>' +
          '<button type="button" title="More" class="text-gray-300 hover:text-gray-600 transition-colors bg-transparent border-0 cursor-pointer p-0">' +
              '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01"/></svg>' +
          '</button>';
      el.appendChild(actionRow);

      DOM.chat.messages.appendChild(el);
      chatScrollBottom();
  }

  // ─── OutputMessage — vendor results ─────────────────────────────────────────
  function appendChatVendors(vendors) {
      if (!vendors || vendors.length === 0) return;

      const el = document.createElement('div');
      el.setAttribute('data-chat-role', 'ai');
      el.className = 'space-y-2';

      const header = document.createElement('div');
      header.className = 'flex items-center space-x-1';
      header.innerHTML =
          '<img src="/favicon.ico" class="h-4" alt="" onerror="this.style.display=\'none\'">' +
          '<strong class="text-gray-800">Response:</strong>';
      el.appendChild(header);

      const listWrap = document.createElement('div');
      const CHAT_VISIBLE_LIMIT = 20;
      const renderedItems = [];

      vendors.forEach(function(v, idx) {
          const item = document.createElement('div');
          item.className = 'rounded-md my-2';

          const detailFields = [];
          const contactFields = [
              ['Contact', v.Contact_Name],
              ['Email', v.Contact_Email],
              ['Phone', v.Contact_Phone],
              ['Address', v.Address],
              ['City', v.City],
              ['State', v.State],
              ['Zip', v.Zip_Code]
          ];
          contactFields.forEach(function(pair) {
              if (pair[1]) detailFields.push({ label: pair[0], value: pair[1] });
          });
          if (!detailFields.length && v.Contract_Overview) {
              detailFields.push({ label: 'Overview', value: v.Contract_Overview.substring(0, 300) });
          }

          const rowEl = document.createElement('div');
          rowEl.className = 'flex justify-between items-center';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'font-normal text-sm text-gray-800';
          nameSpan.textContent = (idx + 1) + '. ' + (v.Vendor_Name || 'Unknown Vendor');

          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'text-blue-600 hover:underline text-sm bg-transparent border-0 cursor-pointer p-0 ml-2 flex-shrink-0';
          toggleBtn.textContent = 'View Details';

          rowEl.appendChild(nameSpan);
          rowEl.appendChild(toggleBtn);
          item.appendChild(rowEl);

          const detailsEl = document.createElement('div');
          detailsEl.className = 'mt-2 space-y-1 text-sm text-gray-700 pl-4 hidden';
          detailFields.forEach(function(f) {
              const p = document.createElement('p');
              p.className = 'm-0';
              p.innerHTML = '<strong>' + f.label + ':</strong> ' + f.value;
              detailsEl.appendChild(p);
          });
          if (!detailFields.length) {
              const p = document.createElement('p');
              p.className = 'm-0 text-gray-500';
              p.textContent = 'No additional details available.';
              detailsEl.appendChild(p);
          }
          item.appendChild(detailsEl);

          toggleBtn.onclick = function() {
              const isHidden = detailsEl.classList.toggle('hidden');
              toggleBtn.textContent = isHidden ? 'View Details' : 'Hide Details';
          };

          listWrap.appendChild(item);
          renderedItems.push(item);
      });

      // Show first 20 results; add Show More / Show Less toggle for larger result sets
      if (vendors.length > CHAT_VISIBLE_LIMIT) {
          for (var i = CHAT_VISIBLE_LIMIT; i < renderedItems.length; i++) {
              renderedItems[i].style.display = 'none';
          }
          var showToggleBtn = document.createElement('button');
          showToggleBtn.type = 'button';
          showToggleBtn.className = 'text-blue-600 hover:underline text-sm bg-transparent border-0 cursor-pointer p-0 mt-2 block';
          showToggleBtn.textContent = 'Show More (' + (vendors.length - CHAT_VISIBLE_LIMIT) + ' more)';
          var chatListExpanded = false;
          showToggleBtn.onclick = function() {
              chatListExpanded = !chatListExpanded;
              for (var j = CHAT_VISIBLE_LIMIT; j < renderedItems.length; j++) {
                  renderedItems[j].style.display = chatListExpanded ? '' : 'none';
              }
              showToggleBtn.textContent = chatListExpanded
                  ? 'Show Less'
                  : 'Show More (' + (vendors.length - CHAT_VISIBLE_LIMIT) + ' more)';
          };
          listWrap.appendChild(showToggleBtn);
      }

      el.appendChild(listWrap);
      DOM.chat.messages.appendChild(el);
      chatScrollBottom();
  }

  async function handleChatSubmit(e) {
      if (e && e.preventDefault) e.preventDefault();

      // Guard: if the input element is missing for any reason, bail out cleanly
      if (!DOM.chat.input) {
          console.error('[AI Search] handleChatSubmit: DOM.chat.input is null');
          return;
      }

      const input = (DOM.chat.input.value || '').trim();
      if (!input) return;

      appendUserMessage(input);
      DOM.chat.input.value = '';
      // Reset textarea height
      if (DOM.chat.input.style) DOM.chat.input.style.height = 'auto';

      if (DOM.chat.typing) DOM.chat.typing.classList.remove('hidden');
      chatScrollBottom();
      if (DOM.chat.submit) DOM.chat.submit.disabled = true;
      DOM.chat.input.disabled = true;

      try {
          if (state.searchType === 'contracts') {
              const res = await fetch(`${PROXY_BASE}/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                  body: JSON.stringify({ type: 'contracts', query: input, view: state.chatView })
              });
              if (!res.ok) throw new Error('Chat API failed');
              const data = await res.json();
              if (data.view) state.chatView = data.view;

              const vendorData = data.data || [];
              if (vendorData.length > 0) {
                  const names    = vendorData.map(v => v.Vendor_Name);
                  const filtered = state.vendors.filter(v => names.includes(v.Vendor_Name));
                  const toShow   = filtered.length > 0 ? filtered : vendorData;
                  renderContracts(toShow);
                  appendChatVendors(toShow);
              } else {
                  appendTextMessage("I couldn't find any vendors matching that request. Try rephrasing or broadening your question.");
              }

          } else {
              // Build the view from current search results so the API has context
              // (empty view = no context = empty [] response — this was the original bug)
              const view     = buildViewFromContentData();
              const viewJson = JSON.stringify(view);
              const res = await fetch(`${PROXY_BASE}/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                  body: JSON.stringify({ type: 'content', query: input, view: viewJson })
              });
              if (!res.ok) throw new Error('Chat API failed');
              const data = await res.json();

              // API returns { chat: "string text", data: [...files] }
              const chatMessage = typeof data.chat === 'string' ? data.chat : '';
              const files       = data.data || [];

              if (chatMessage) appendTextMessage(chatMessage);
              if (files.length > 0) appendChatFiles(files);
              if (!chatMessage && files.length === 0) {
                  appendTextMessage("I couldn't find relevant content for that question. Try rephrasing or asking about a specific topic from the results.");
              }
          }
      } catch (err) {
          console.error('[AI Search] Chat error:', err);
          appendErrorMessage("Sorry, I encountered an error communicating with the AI. Please try again.");
      } finally {
          if (DOM.chat.typing) DOM.chat.typing.classList.add('hidden');
          if (DOM.chat.submit) DOM.chat.submit.disabled = false;
          if (DOM.chat.input) {
              DOM.chat.input.disabled = false;
              DOM.chat.input.focus();
          }
          chatScrollBottom();
      }
  }

  // ─── Chat-input autocomplete ─────────────────────────────────────────────
  // Mirrors the MVP SearchBox behaviour: typing in the chat textarea fetches
  // suggestions and shows them in a fixed-position dropdown above the input.
  // Uses document.body + position:fixed so overflow:hidden on parent containers
  // never clips the list.

  let _chatAutoEl = null;

  function getChatAutoDropdown() {
    if (_chatAutoEl && document.body.contains(_chatAutoEl)) return _chatAutoEl;
    const ul = document.createElement('ul');
    ul.id = 'chat-autocomplete-dropdown';
    ul.style.cssText = [
      'position:fixed', 'background:#fff',
      'border:1px solid #e2e5ea', 'border-radius:4px',
      'margin:0', 'padding:0', 'list-style:none',
      'max-height:280px', 'overflow-y:auto', 'z-index:9999',
      'box-shadow:0 4px 12px rgba(0,0,0,0.10)', 'display:none'
    ].join(';');
    document.body.appendChild(ul);
    _chatAutoEl = ul;
    return ul;
  }

  function positionChatAutocomplete() {
    if (!_chatAutoEl || !DOM.chat.input) return;
    const r = DOM.chat.input.getBoundingClientRect();
    // Appear BELOW the input, aligned to its left edge, same width
    _chatAutoEl.style.left   = r.left + 'px';
    _chatAutoEl.style.width  = r.width + 'px';
    _chatAutoEl.style.bottom = 'auto';
    _chatAutoEl.style.top    = (r.bottom + 2) + 'px';
  }

  function hideChatAutocomplete() {
    if (_chatAutoEl) { _chatAutoEl.style.display = 'none'; _chatAutoEl.innerHTML = ''; }
  }

  function renderChatAutocomplete(suggestions) {
    const ul = getChatAutoDropdown();
    if (!ul) return;
    ul.innerHTML = '';

    const items = (suggestions || []).map(item =>
      typeof item === 'string' ? item
        : (item.question || item.file_title || item.title || item.autoquestion || item.Question || item.text || '')
    ).filter(t => t && t.trim());

    if (!items.length) { ul.style.display = 'none'; return; }

    items.forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      li.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:0.95rem;color:#333;border-bottom:1px solid #f1f1f1;list-style:none;font-family:inherit;line-height:1.4';
      li.addEventListener('mouseenter', () => { li.style.background = '#f9fafb'; });
      li.addEventListener('mouseleave', () => { li.style.background = ''; });
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus on textarea
        if (DOM.chat.input) {
          DOM.chat.input.value = text;
          DOM.chat.input.style.height = 'auto';
          DOM.chat.input.style.height = Math.min(DOM.chat.input.scrollHeight, 120) + 'px';
        }
        hideChatAutocomplete();
        handleChatSubmit(null);
      });
      ul.appendChild(li);
    });

    positionChatAutocomplete();
    ul.style.display = 'block';
  }

  // Reposition on scroll or resize so the dropdown tracks the input
  window.addEventListener('scroll', positionChatAutocomplete, { passive: true });
  window.addEventListener('resize', positionChatAutocomplete, { passive: true });

  const handleChatAutocomplete = debounce(async function(query) {
    if (!query || query.trim().length < 1) { hideChatAutocomplete(); return; }
    try {
      const params = new URLSearchParams({
        type:  state.searchType,
        mode:  'chat',
        query: query.trim()
      });
      if (state.searchType === 'content' && state.contentData.length > 0) {
        params.set('view', JSON.stringify(buildViewFromContentData()));
      }
      const res = await fetch(`${PROXY_BASE}/autocomplete?${params.toString()}`);
      if (!res.ok) { hideChatAutocomplete(); return; }
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.data || []);
      renderChatAutocomplete(list);
    } catch (e) {
      hideChatAutocomplete();
    }
  }, 250);

  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
  } else {
      init();
  }

})();
