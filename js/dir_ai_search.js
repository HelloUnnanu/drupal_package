/**
 * Vanilla JS orchestrator for DIR AI Search on Custom Routes.
 */
(function () {
  'use strict';
  const API_BASE_URL = 'https://azapp-aisearch.azurewebsites.net';

  let state = {
    query: '',
    searchType: 'content',
    chatView: '',
    isLoading: false,
    vendors: [],
    contentData: []
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
    
    DOM.chat.messages = document.getElementById('ai-chat-messages');
    DOM.chat.input = document.getElementById('ai-chat-input');
    DOM.chat.form = document.getElementById('ai-chat-form');
    DOM.chat.submit = document.getElementById('ai-chat-submit');
    DOM.chat.typing = document.getElementById('ai-chat-typing');
    DOM.chat.download = document.getElementById('ai-chat-download');

    DOM.faq.container = document.getElementById('ai-faq-container');
    DOM.faq.toggle = document.getElementById('faq-toggle');
    DOM.faq.chevron = document.getElementById('faq-chevron');
    DOM.faq.list = document.getElementById('faq-list');

    // Bind Chat Events
    DOM.chat.form.addEventListener('submit', handleChatSubmit);
    DOM.chat.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleChatSubmit(e);
        }
    });
    if (DOM.chat.download) {
        DOM.chat.download.addEventListener('click', downloadChat);
    }
    if (DOM.faq.toggle) {
        DOM.faq.toggle.addEventListener('click', () => {
            const isHidden = DOM.faq.list.classList.contains('hidden');
            if (isHidden) {
                DOM.faq.list.classList.remove('hidden');
                DOM.faq.chevron.classList.remove('-rotate-90');
            } else {
                DOM.faq.list.classList.add('hidden');
                DOM.faq.chevron.classList.add('-rotate-90');
            }
        });
    }

    // Override the native tabs to point to our custom routes!
    const tabs = document.querySelectorAll('.searchresults-nav a');
    tabs.forEach(tab => {
        const href = tab.getAttribute('href');
        if (href.includes('/search-results')) {
            tab.setAttribute('href', href.replace('/search-results', '/ai-search-content'));
        } else if (href.includes('/search-contracts-vendors')) {
            tab.setAttribute('href', href.replace('/search-contracts-vendors', '/ai-search-contracts'));
        }
        
        // Fix active class based on current route
        if (state.searchType === 'content' && tab.textContent.includes('All Pages')) {
            tab.parentElement.classList.add('is-active');
            tab.setAttribute('aria-current', 'page');
        } else if (state.searchType === 'contracts' && tab.textContent.includes('Contracts')) {
            tab.parentElement.classList.add('is-active');
            tab.setAttribute('aria-current', 'page');
        } else {
            tab.parentElement.classList.remove('is-active');
            tab.removeAttribute('aria-current');
        }
    });

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
      const chatFaq = document.getElementById('ai-chat-faq-wrapper');
      const preview = document.getElementById('ai-preview-panel-wrapper');
      if (!preview) return;
      stopAllMedia(preview);
      preview.classList.add('hidden');
      preview.innerHTML = '';
      if (chatFaq) chatFaq.classList.remove('hidden');
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
      const chatFaqContainer = document.getElementById('ai-chat-faq-wrapper');
      const previewContainer = document.getElementById('ai-preview-panel-wrapper');
      if (!chatFaqContainer || !previewContainer) return;

      stopAllMedia(previewContainer);
      if (state._vttBlobUrl) { URL.revokeObjectURL(state._vttBlobUrl); state._vttBlobUrl = null; }

      chatFaqContainer.classList.add('hidden');
      previewContainer.classList.remove('hidden');

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

      const bgColor = modality === 'audio' ? 'bg-purple-50' : modality === 'video' ? 'bg-indigo-50' : modality === 'images' ? 'bg-green-50' : 'bg-blue-50';
      const iconBg = modality === 'audio' ? 'bg-purple-100 text-purple-700' : modality === 'video' ? 'bg-indigo-100 text-indigo-700' : modality === 'images' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700';
      const titleColor = modality === 'audio' ? 'text-purple-700' : modality === 'video' ? 'text-indigo-700' : modality === 'images' ? 'text-green-700' : 'text-blue-700';

      if (modality === 'video') {
          if (embeddedVideoUrl) {
              mediaHtml = `<iframe src="${embeddedVideoUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen class="w-full h-[70vh] min-h-[240px] rounded-lg shadow-lg bg-black border-none"></iframe>`;
          } else {
              mediaHtml = `<div class="w-full max-w-5xl"><div class="relative w-full" style="background:#000"><video id="preview-media" src="${url}#t=${startSeconds}" controls autoplay class="w-full h-auto max-h-[70vh] min-h-[240px] rounded-lg shadow-lg object-contain bg-black"></video><div id="caption-overlay" class="absolute bottom-12 left-0 right-0 flex justify-center pointer-events-none px-4 z-10 hidden"><div class="bg-black/75 text-white px-4 py-2 rounded-lg max-w-[85%] text-center backdrop-blur-sm"><p id="caption-text" class="text-sm leading-relaxed m-0"></p></div></div></div></div>`;
          }
      } else if (modality === 'audio') {
          mediaHtml = `<div class="w-full max-w-xl p-4 bg-white rounded-xl shadow-lg"><div class="bg-purple-100 p-4 rounded-full text-purple-700 mx-auto w-16 h-16 mb-4 flex items-center justify-center">${getModalityIcon('audio')}</div><p class="text-center text-gray-700 font-medium mb-3 text-sm m-0">${title}</p><div class="relative"><audio id="preview-media" src="${url}#t=${startSeconds}" controls autoplay class="w-full"></audio></div><div id="caption-overlay" class="hidden mt-2 bg-black/80 rounded-lg px-3 py-1.5 text-xs text-white text-center"><p id="caption-text" class="m-0"></p></div></div>`;
      } else if (modality === 'images') {
          mediaHtml = `<img src="${url}" alt="${title}" class="w-full h-auto max-h-[80vh] rounded-lg shadow-lg object-contain" />`;
      } else if (url.toLowerCase().endsWith('.pdf')) {
          let ph = '';
          if (startTimeStr && !isNaN(startTimeStr)) ph = `#page=${startTimeStr}`;
          else if (item.file_start && !isNaN(item.file_start)) ph = `#page=${item.file_start}`;
          mediaHtml = `<iframe src="${url}${ph}" title="${title}" class="w-full h-[80vh] rounded-lg shadow-lg bg-white border-none"></iframe>`;
      } else {
          mediaHtml = `<div class="text-center p-8"><p class="text-gray-600 mb-4">Preview not available for this file type.</p><a href="${url}" target="_blank" rel="noopener noreferrer" class="text-[#1F40AF] font-medium hover:underline">Open in new tab →</a></div>`;
      }

      // Determine header content: for media, we move the title to a second row to avoid overlap
      let headerLeftContent = '';
      if (isMedia && !embeddedVideoUrl) {
          headerLeftContent = `
            <div class="flex items-center gap-1.5">
              <select id="preview-lang-select" class="text-[10px] border border-gray-300 rounded-md px-1.5 py-1 bg-white text-gray-700 focus:outline-none cursor-pointer">
                <option value="en">EN</option>
                <option value="es">ES</option>
                <option value="fr">FR</option>
                <option value="ar">AR</option>
              </select>
              <button type="button" id="btn-cc-toggle" class="flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold transition-colors bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer" title="Toggle Captions">
                CC
              </button>
            </div>
          `;
      } else {
          headerLeftContent = `<h3 class="font-semibold break-words ${titleColor} text-sm m-0 line-clamp-1">${title}</h3>`;
      }

      previewContainer.innerHTML = `<div class="h-full bg-white border border-gray-200 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div class="${bgColor} px-4 py-3 border-b"><div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-1 min-w-0 flex-nowrap"><div class="${iconBg} p-2 rounded-full flex-shrink-0"><div class="h-5 w-5">${getModalityIcon(modality)}</div></div>${headerLeftContent}</div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <button class="btn-open-chat p-2 hover:bg-gray-200 rounded-full transition-colors bg-transparent border-0 cursor-pointer" title="Open chat"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg></button>
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="p-2 hover:bg-gray-200 rounded-full transition-colors" title="Open in new tab"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>
            <button class="btn-close-preview p-2 hover:bg-gray-200 rounded-full transition-colors bg-transparent border-0 cursor-pointer" title="Close"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>
        </div></div>
        ${isMedia ? `<div class="px-4 py-2 border-b bg-white shadow-sm z-10"><p class="text-sm font-semibold break-words ${titleColor} m-0">${title}</p></div>` : ''}
        <div class="flex-1 bg-gray-100 flex items-center justify-center p-2 ${modality === 'video' ? 'overflow-hidden' : 'overflow-auto'}">${mediaHtml}</div>
      </div>`;

      previewContainer.querySelector('.btn-close-preview').onclick = () => closePreview();
      previewContainer.querySelector('.btn-open-chat').onclick = () => closePreview();

      // === Caption logic (Native for Video, rAF for Audio) ===
      if (isMedia && !embeddedVideoUrl) {
          const mediaEl = previewContainer.querySelector('#preview-media');
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
                      // Force showing mode
                      setTimeout(() => { if (mediaEl.textTracks && mediaEl.textTracks[0]) mediaEl.textTracks[0].mode = 'showing'; }, 100);
                  }
              } else if (modality === 'audio') {
                  const captionOverlay = previewContainer.querySelector('#caption-overlay');
                  const captionTextEl = previewContainer.querySelector('#caption-text');
                  if (!captionOverlay || !captionTextEl) return;

                  const sentences = transcriptText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
                  const segDur = dur / sentences.length;
                  const segments = sentences.map((text, i) => ({ text: text.trim(), start: i * segDur, end: (i + 1) * segDur }));

                  const tick = () => {
                      if (!captionsOn) { captionOverlay.classList.add('hidden'); state._captionRafId = requestAnimationFrame(tick); return; }
                      const t = mediaEl.currentTime;
                      let active = null;
                      for (let i = segments.length - 1; i >= 0; i--) { if (t >= segments[i].start && t < segments[i].end) { active = segments[i]; break; } }
                      if (active) { captionTextEl.textContent = active.text; captionOverlay.classList.remove('hidden'); } else { captionOverlay.classList.add('hidden'); }
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

          const ccBtn = previewContainer.querySelector('#btn-cc-toggle');
          if (ccBtn) {
              ccBtn.onclick = (e) => {
                  e.stopPropagation();
                  captionsOn = !captionsOn;
                  if (captionsOn) {
                      ccBtn.className = 'flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold transition-colors bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer';
                      ccBtn.title = 'Captions ON';
                      if (modality === 'video' && mediaEl.textTracks && mediaEl.textTracks[0]) mediaEl.textTracks[0].mode = 'showing';
                  } else {
                      ccBtn.className = 'flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold transition-colors bg-gray-100 text-gray-500 border border-gray-300 hover:bg-gray-200 cursor-pointer';
                      ccBtn.title = 'Captions OFF';
                      if (modality === 'video' && mediaEl.textTracks && mediaEl.textTracks[0]) mediaEl.textTracks[0].mode = 'hidden';
                      if (modality === 'audio') {
                          const box = previewContainer.querySelector('#caption-overlay');
                          if (box) box.classList.add('hidden');
                      }
                  }
              };
          }
      }
  }


  function setLoading(isLoading) {
    state.isLoading = isLoading;
    if (isLoading) {
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
        const res = await fetch(`${API_BASE_URL}/search/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: state.query, view: state.chatView })
        });
        if (!res.ok) throw new Error('Search API error');
        const data = await res.json();
        
        if (data.view) state.chatView = data.view;
        
        let vendors = Array.isArray(data) ? data : (data.data || []);
        vendors.sort((a, b) => (a.Vendor_Name || '').localeCompare(b.Vendor_Name || ''));
        state.vendors = vendors;
        
        renderContracts(vendors);

      } else {
        const res = await fetch(`${API_BASE_URL}/dirsearch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: state.query })
        });
        if (!res.ok) throw new Error('Content API error');
        const data = await res.json();
        
        let content = Array.isArray(data) ? data : (data.data || []);
        state.contentData = content;
        state.contentChatSuggestions = data.chat || [];
        
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

    const activeCount = vendors.length; // The API only returns active vendors now
    DOM.metadata.innerHTML = `Found <strong>${vendors.length}</strong> vendors`;
    DOM.metadata.classList.remove('hidden');

    // Mirroring EXACT logic from React Demo (Search.jsx lines 445-455)
    const activeMinority = vendors.reduce(
        (count, vendor) => vendor.Hub_Type !== "others" && vendor.Active_status === 1 ? 1 + count : count,
        0
    );
    
    const activeContractsCount = vendors.reduce(
        (count, vendor) => vendor.Active_status === 1 ? count + (vendor.other_contracts_count || 0) : count, 
        0
    );

    const summaryCards = document.createElement('div');
    summaryCards.className = 'grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 mt-2 px-2 md:px-3 text-[#1F40AF]';
    summaryCards.innerHTML = `
      <div class="bg-blue-100 rounded-xl text-left px-4 py-3">
        <p class="text-lg font-medium m-0"># of Active Vendors</p>
        <h1 class="text-4xl font-bold py-2 m-0">${activeCount}</h1>
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

    const headingHtml = document.createElement('h2');
    headingHtml.className = 'px-3 my-2 text-xl text-gray-800 m-0 pb-4';
    headingHtml.innerHTML = `Here's <span class="font-semibold"> a list of all vendors </span> who meet the above AI-Search query.`;
    DOM.resultsList.appendChild(headingHtml);

    vendors.forEach(vendor => {
      const isActive = vendor.Active_status === 1;
      const statusColor = isActive ? 'text-green-500' : 'text-gray-500';
      const statusText = isActive ? 'Active' : 'Inactive';
      const hubType = vendor.Hub_Type !== 'others' ? vendor.Hub_Type : 'Non-HUB';
      
      let contractsHtml = '';
      if (vendor.other_contracts) {
          const contracts = vendor.other_contracts.split(',').map(c => c.trim());
          contractsHtml = contracts.map(c => `
              <a href="https://dir.texas.gov/contracts/${c}" target="_blank" class="inline-flex items-center justify-center bg-[#1F40AF] text-white text-base font-semibold px-3 py-1.5 rounded-md leading-none no-underline hover:opacity-90">
                  ${c}
              </a>
          `).join('');
      }

      const vendorNameUrl = (vendor.Vendor_Name || '').replace(/^The\s+/i, "").trim().replace(/\s+/g, "-").replace(/[,&()./]+/g, "").replace(/-+/g, "-");
      const overview = vendor.Contract_Overview || 'No description available.';
      const shortOverview = overview.length > 250 ? overview.substring(0, 250) + " ..." : overview;

      const card = document.createElement('div');
      card.className = 'px-0 pb-4';
      card.innerHTML = `
        <div class="flex flex-col bg-white border border-gray-200 rounded-xl shadow-sm">
          <div class="flex flex-col justify-between p-4 md:p-5 leading-normal">
            <div class="flex justify-between items-start gap-3 pb-1.5">
              <h5 class="mb-1 text-xl md:text-2xl font-semibold tracking-tight m-0">
                <span class="${statusColor}">Vendor (${statusText})</span>
              </h5>
              <span class="inline-flex items-center justify-center bg-[#1F40AF] text-white text-base font-semibold px-3 py-1.5 rounded-md whitespace-nowrap leading-none">
                ${hubType}
              </span>
            </div>
            <p class="m-0 py-1">
              <a href="https://dir.texas.gov/contracts/vendors/${vendorNameUrl}" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#1F40AF] underline text-2xl md:text-3xl leading-tight">
                ${vendor.Vendor_Name || 'Unknown Vendor'}
              </a>
            </p>
            <p class="text-lg leading-8 text-gray-700 py-2 m-0">
              ${shortOverview}
            </p>
            <p class="text-lg py-1.5 text-gray-500 font-semibold tracking-wide m-0 mt-2">ACTIVE CONTRACTS</p>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${contractsHtml}
            </div>
          </div>
        </div>
      `;
      DOM.resultsList.appendChild(card);
    });
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
    
    let pillsHtml = `
      <div class="flex items-center text-[15px] text-gray-500 shrink-0 mr-2">
        <span>Home</span><span class="mx-2">&gt;</span><span>Files &amp; Content</span>
      </div>
      <div class="flex flex-wrap gap-3">
        <button class="flex items-center justify-center gap-1.5 rounded-full border px-4 py-1.5 text-[15px] font-medium transition-colors border-[#1F40AF] bg-[#1F40AF] text-white shadow-sm cursor-default">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16M2 6h.01M2 12h.01M2 18h.01" />
          </svg>
          <span class="text-white/90 font-semibold leading-none">${uniqueItems.length}</span>
        </button>
    `;
    
    ['documents', 'audio', 'video', 'images'].forEach(modality => {
       if (counts[modality] > 0) {
          pillsHtml += `
            <button class="flex items-center justify-center gap-1.5 rounded-full border px-4 py-1.5 text-[15px] font-medium transition-colors border-gray-200 bg-gray-50 text-gray-800 hover:border-gray-300 shadow-sm cursor-default">
               <span class="h-4 w-4 flex items-center justify-center">${getModalityIcon(modality)}</span>
               <span class="text-gray-700 font-semibold leading-none">${counts[modality]}</span>
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

    const listContainer = document.createElement('div');
    listContainer.className = 'space-y-3';

    uniqueItems.forEach(item => {
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
            <div class="relative w-full h-full">
               <img src="${thumbImg}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
               <div class="absolute inset-0 flex items-center justify-center bg-gray-50 hidden">
                  <div class="${bgClass} p-3 rounded-lg ${textClass} h-12 w-12 flex items-center justify-center">
                    ${getModalityIcon(modality)}
                  </div>
               </div>
               ${modality === 'video' ? `
               <div class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-20 transition-opacity hover:bg-opacity-30">
                 <div class="bg-white rounded-full p-2 shadow-md">
                   <svg class="h-5 w-5 text-red-600 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                 </div>
               </div>` : ''}
            </div>
          `;
      } else {
          visualHtml = `
            <div class="w-full h-full flex flex-col items-center justify-center p-2">
              <div class="${bgClass} p-3 rounded-lg ${textClass} h-12 w-12 flex items-center justify-center">
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
      card.className = 'rounded-xl p-5 transition-all border border-gray-200 bg-white hover:shadow-sm cursor-pointer relative';
      
      // Make whole card clickable, opening preview
      card.onclick = (e) => {
          if (!e.target.closest('a, button, details, summary')) {
              openPreview(item, null);
          }
      };

      card.innerHTML = `
        <div class="absolute top-5 right-5 z-10 hidden sm:block">
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
        <div class="flex gap-5">
          <div class="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden flex-shrink-0 bg-gray-50 border border-gray-100 shadow-sm mt-1">
            ${visualHtml}
          </div>
          <div class="flex-1 min-w-0 pr-0 sm:pr-32">
            <div class="flex items-start justify-between gap-2 mb-2">
              <button type="button" class="btn-open-preview font-bold text-[#1F40AF] text-[20px] leading-snug line-clamp-2 hover:underline m-0 text-left bg-transparent border-0 p-0 cursor-pointer flex-1">
                  ${title}
              </button>
              <div class="shrink-0 ml-4 hidden sm:block">
                  <button type="button" class="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors shadow-sm cursor-pointer">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
                      English
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-gray-500 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                  </button>
              </div>
            </div>
            <p class="card-snippet text-gray-600 text-[16px] leading-[1.6] mb-1 line-clamp-3 m-0 transition-all">
                ${snippet}
            </p>
            <button class="btn-view-more text-[#1F40AF] text-[15px] font-medium hover:underline bg-transparent border-0 p-0 cursor-pointer mb-3 inline-flex items-center">
                <span>View More</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            <div class="flex flex-col gap-2 mt-2">
              <button class="btn-summary flex items-center text-[15px] font-semibold text-[#0E2A84] hover:opacity-80 transition-opacity bg-transparent border-0 p-0 cursor-pointer">
                <svg class="h-5 w-5 mr-1.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
                <span>${(modality === 'audio' || modality === 'video') ? 'Show Transcript' : 'Show Summary'}</span>
              </button>
              <div class="summary-container hidden mt-2 bg-gray-50 rounded-lg p-3 text-[14px] text-gray-600 max-h-48 overflow-y-auto">
                 ${(modality === 'audio' || modality === 'video') ? (item.transcript_en || snippet) : (item.summary || snippet)}
              </div>
              
              ${topicsCount > 0 ? `
              <div class="mt-2 border-t pt-2 border-gray-100">
                <button class="btn-topics flex items-center text-[15px] font-semibold text-[#0E2A84] hover:opacity-80 transition-opacity bg-transparent border-0 p-0 cursor-pointer mt-1">
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
              openPreview(item, null);
          };
      }
      
      const topicLinks = card.querySelectorAll('.btn-topic-link');
      topicLinks.forEach(btn => {
          btn.onclick = (e) => {
              e.preventDefault();
              const startTimeStr = btn.getAttribute('data-start-time');
              openPreview(item, startTimeStr);
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
    
    DOM.resultsList.appendChild(listContainer);
    DOM.metadata.classList.add('hidden'); // We show count in pills now
    
    // Render FAQ if available
    renderFaq();
  }

  function renderFaq() {
      if (!DOM.faq.container) return;
      // Access chat suggestions from global state
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
      
      suggestions.forEach((item, index) => {
          const details = document.createElement('details');
          details.className = 'group border-t border-gray-200';
          details.innerHTML = `
              <summary class="list-none flex w-full items-start justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50 cursor-pointer">
                  <span class="text-sm leading-snug text-gray-900">${item.question || ''}</span>
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
              </summary>
              <div class="px-5 pb-4">
                  <p class="text-sm leading-6 text-gray-500 m-0">${item.answer || 'No answer available.'}</p>
              </div>
          `;
          details.addEventListener('toggle', (e) => {
             if (details.open) {
                 // Close other details
                 Array.from(DOM.faq.list.querySelectorAll('details')).forEach(other => {
                     if (other !== details) other.removeAttribute('open');
                 });
             }
          });
          DOM.faq.list.appendChild(details);
      });
  }

  function downloadChat() {
      const messages = Array.from(DOM.chat.messages.children).map(wrapper => {
          const isUser = wrapper.classList.contains('justify-end');
          const text = wrapper.textContent.trim();
          return (isUser ? "User: " : "AI: ") + text;
      });
      if (messages.length === 0) return;
      
      const textBlob = new Blob([messages.join("\\n\\n")], { type: 'text/plain' });
      const url = URL.createObjectURL(textBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ai-chat-transcript.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  }

  function appendChatMessage(text, isUser) {
      const wrapper = document.createElement('div');
      wrapper.className = isUser ? 'flex justify-end' : 'flex justify-start';
      
      const bubble = document.createElement('div');
      if (isUser) {
          bubble.className = 'bg-[#1F40AF] text-white rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%] shadow-sm text-sm';
      } else {
          bubble.className = 'bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%] text-gray-800 shadow-sm border border-gray-200 prose prose-sm text-sm';
      }
      
      let html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      bubble.innerHTML = html;
      
      wrapper.appendChild(bubble);
      DOM.chat.messages.appendChild(wrapper);
      
      DOM.chat.messages.scrollTop = DOM.chat.messages.scrollHeight;
  }

  async function handleChatSubmit(e) {
      e.preventDefault();
      const input = DOM.chat.input.value.trim();
      if (!input) return;
      
      appendChatMessage(input, true);
      DOM.chat.input.value = '';
      
      DOM.chat.typing.classList.remove('hidden');
      DOM.chat.submit.disabled = true;
      DOM.chat.input.disabled = true;

      try {
          if (state.searchType === 'contracts') {
              const res = await fetch(`${API_BASE_URL}/chat/`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ query: input, view: state.chatView })
              });
              
              if (!res.ok) throw new Error('Chat API failed');
              const data = await res.json();
              if (data.view) state.chatView = data.view;
              
              const vendorData = data.data || [];
              
              if (vendorData.length > 0) {
                  const names = vendorData.map(v => v.Vendor_Name);
                  const filtered = state.vendors.filter(v => names.includes(v.Vendor_Name));
                  renderContracts(filtered.length > 0 ? filtered : vendorData);
                  appendChatMessage(`I found ${vendorData.length} vendors related to your request. I've updated the results list on the left.`, false);
              } else {
                  appendChatMessage("I couldn't find any specific vendors matching that request in the current results.", false);
              }

          } else {
              const viewJson = JSON.stringify({});
              const url = `${API_BASE_URL}/dirsearch/chat?query=${encodeURIComponent(input)}&view=${encodeURIComponent(viewJson)}`;
              const res = await fetch(url, { method: 'POST' });
              
              if (!res.ok) throw new Error('Chat API failed');
              const data = await res.json();
              
              let msg = data.answer || data.message || data.data || "I've processed your request.";
              if (typeof msg !== 'string') msg = JSON.stringify(msg);
              appendChatMessage(msg, false);
          }
      } catch (err) {
          console.error(err);
          appendChatMessage("Sorry, I encountered an error communicating with the AI. Please try again.", false);
      } finally {
          DOM.chat.typing.classList.add('hidden');
          DOM.chat.submit.disabled = false;
          DOM.chat.input.disabled = false;
          DOM.chat.input.focus();
      }
  }

  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
  } else {
      init();
  }

})();
