/**
 * AI Chatbot - Client-side Controller
 * Features: SSE Streaming, Multi-turn Chat, Markdown Rendering,
 * Code Highlighting & Copy, Session History (localStorage), Light/Dark Theme.
 */

(function () {
  'use strict';

  // =========================================================================
  // State Management
  // =========================================================================
  const STORAGE_KEYS = {
    CHATS: 'aichat_sessions_v1',
    THEME: 'aichat_theme_v1',
    ACTIVE_ID: 'aichat_active_id_v1'
  };

  let chats = [];
  let currentChatId = null;
  let isGenerating = false;
  let abortController = null;
  let shouldAutoScroll = true;

  // =========================================================================
  // DOM Elements
  // =========================================================================
  const elements = {
    sidebar: document.getElementById('sidebar'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    closeSidebarBtn: document.getElementById('close-sidebar-btn'),
    mobileMenuBtn: document.getElementById('mobile-menu-btn'),
    newChatBtn: document.getElementById('new-chat-btn'),
    chatHistoryList: document.getElementById('chat-history-list'),
    clearAllBtn: document.getElementById('clear-all-btn'),
    themeToggleBtn: document.getElementById('theme-toggle-btn'),
    themeText: document.querySelector('.theme-text'),
    chatScrollArea: document.getElementById('chat-scroll-area'),
    chatMessages: document.getElementById('chat-messages'),
    welcomeScreen: document.getElementById('welcome-screen'),
    chatTitle: document.getElementById('chat-title'),
    chatForm: document.getElementById('chat-form'),
    userInput: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    stopBtn: document.getElementById('stop-btn'),
    scrollBottomBtn: document.getElementById('scroll-bottom-btn'),
    infoBtn: document.getElementById('info-btn'),
    infoModal: document.getElementById('info-modal'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    modalOkBtn: document.getElementById('modal-ok-btn'),
    toastContainer: document.getElementById('toast-container')
  };

  // =========================================================================
  // Markdown Configuration & Fallback
  // =========================================================================
  function setupMarkdown() {
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        gfm: true,
        breaks: true,
        highlight: function (code, lang) {
          if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
            try {
              return hljs.highlight(code, { language: lang }).value;
            } catch (__) {}
          }
          if (typeof hljs !== 'undefined') {
            try {
              return hljs.highlightAuto(code).value;
            } catch (__) {}
          }
          return escapeHtml(code);
        }
      });
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, function (m) { return map[m]; });
  }

  // Fallback simple markdown parser if marked CDN is unreachable
  function fallbackParseMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre><code class="language-' + (lang || 'plaintext') + '">' + code.trim() + '</code></pre>';
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold & Italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Blockquotes
    html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

    // Headers
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Unordered lists
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');

    // Line breaks
    html = html.replace(/\n\n/g, '<p></p>');
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  function renderMarkdown(rawText) {
    if (!rawText) return '';
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      try {
        return marked.parse(rawText);
      } catch (err) {
        console.warn('Error parsing markdown with marked:', err);
      }
    }
    return fallbackParseMarkdown(rawText);
  }

  // =========================================================================
  // Theme Management
  // =========================================================================
  function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add('theme-' + theme);
    localStorage.setItem(STORAGE_KEYS.THEME, theme);

    if (elements.themeText) {
      elements.themeText.textContent = theme === 'dark' ? 'Mode Terang' : 'Mode Gelap';
    }
  }

  function toggleTheme() {
    const currentTheme = document.body.classList.contains('theme-light') ? 'light' : 'dark';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    showToast('Beralih ke ' + (nextTheme === 'dark' ? 'Mode Gelap' : 'Mode Terang'), 'info');
  }

  // =========================================================================
  // Session & LocalStorage Management
  // =========================================================================
  function loadSessions() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CHATS);
      chats = data ? JSON.parse(data) : [];
      if (!Array.isArray(chats)) chats = [];
    } catch (e) {
      console.error('Failed to load chat sessions:', e);
      chats = [];
    }
  }

  function saveSessions() {
    try {
      localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(chats));
    } catch (e) {
      console.error('Failed to save chat sessions:', e);
    }
  }

  function createNewChat() {
    if (isGenerating) {
      showToast('Tunggu respons saat ini selesai terlebih dahulu.', 'error');
      return;
    }

    const newChat = {
      id: 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      title: 'Percakapan Baru',
      createdAt: Date.now(),
      messages: []
    };

    chats.unshift(newChat);
    saveSessions();
    switchChat(newChat.id);
    closeMobileSidebar();
    elements.userInput.focus();
  }

  function switchChat(chatId) {
    currentChatId = chatId;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_ID, chatId);
    const activeChat = getActiveChat();

    renderHistoryList();
    renderChatMessages();

    if (activeChat) {
      elements.chatTitle.textContent = activeChat.title || 'Percakapan Baru';
    } else {
      elements.chatTitle.textContent = 'Percakapan Baru';
    }
  }

  function getActiveChat() {
    return chats.find(function (c) { return c.id === currentChatId; });
  }

  function deleteChat(chatId, e) {
    if (e) e.stopPropagation();
    if (isGenerating && currentChatId === chatId) {
      showToast('Tidak dapat menghapus saat percakapan sedang berlangsung.', 'error');
      return;
    }

    chats = chats.filter(function (c) { return c.id !== chatId; });
    saveSessions();

    if (currentChatId === chatId) {
      if (chats.length > 0) {
        switchChat(chats[0].id);
      } else {
        createNewChat();
      }
    } else {
      renderHistoryList();
    }
    showToast('Percakapan telah dihapus', 'info');
  }

  function clearAllChats() {
    if (chats.length === 0) {
      showToast('Tidak ada riwayat percakapan.', 'info');
      return;
    }

    if (confirm('Apakah Anda yakin ingin menghapus seluruh riwayat percakapan?')) {
      if (isGenerating && abortController) {
        abortController.abort();
      }
      chats = [];
      saveSessions();
      createNewChat();
      showToast('Semua riwayat berhasil dihapus', 'info');
    }
  }

  // =========================================================================
  // UI Rendering
  // =========================================================================
  function renderHistoryList() {
    elements.chatHistoryList.innerHTML = '';

    if (chats.length === 0) {
      elements.chatHistoryList.innerHTML = '<div class="empty-history">Belum ada riwayat</div>';
      return;
    }

    chats.forEach(function (chat) {
      const item = document.createElement('div');
      item.className = 'history-item' + (chat.id === currentChatId ? ' active' : '');
      item.innerHTML = `
        <div class="history-item-content">
          <svg class="history-item-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="history-item-text">${escapeHtml(chat.title || 'Percakapan')}</span>
        </div>
        <button class="history-item-delete" title="Hapus Percakapan">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;

      item.addEventListener('click', function () {
        if (chat.id !== currentChatId) {
          switchChat(chat.id);
          closeMobileSidebar();
        }
      });

      const delBtn = item.querySelector('.history-item-delete');
      delBtn.addEventListener('click', function (e) {
        deleteChat(chat.id, e);
      });

      elements.chatHistoryList.appendChild(item);
    });
  }

  function renderChatMessages() {
    const activeChat = getActiveChat();
    elements.chatMessages.innerHTML = '';

    if (!activeChat || activeChat.messages.length === 0) {
      elements.chatMessages.appendChild(elements.welcomeScreen);
      elements.welcomeScreen.classList.remove('hidden');
      return;
    }

    elements.welcomeScreen.classList.add('hidden');

    activeChat.messages.forEach(function (msg) {
      appendMessageToDOM(msg.role, msg.content, msg.timestamp, false);
    });

    scrollToBottom(false);
  }

  function appendMessageToDOM(role, content, timestamp, isStreaming) {
    elements.welcomeScreen.classList.add('hidden');

    const row = document.createElement('div');
    row.className = 'message-row ' + (role === 'user' ? 'user-row' : 'assistant-row');

    const avatarSvg = role === 'user'
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
           <circle cx="12" cy="7" r="4"></circle>
         </svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M12 2a8 8 0 0 0-8 8c0 3.36 2.08 6.23 5 7.37V21l3-2 3 2v-3.63c2.92-1.14 5-4.01 5-7.37a8 8 0 0 0-8-8z"/>
           <line x1="9" y1="10" x2="9.01" y2="10"/>
           <line x1="15" y1="10" x2="15.01" y2="10"/>
         </svg>`;

    const timeStr = timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    row.innerHTML = `
      <div class="message-avatar">
        ${avatarSvg}
      </div>
      <div class="message-content-wrapper">
        <div class="message-bubble"></div>
        <div class="message-meta">${escapeHtml(timeStr)}</div>
      </div>
    `;

    const bubble = row.querySelector('.message-bubble');

    if (role === 'user') {
      bubble.textContent = content;
    } else {
      if (isStreaming) {
        bubble.innerHTML = renderMarkdown(content) + '<span class="streaming-cursor"></span>';
      } else {
        bubble.innerHTML = renderMarkdown(content);
        enhanceCodeBlocks(bubble);
      }
    }

    elements.chatMessages.appendChild(row);

    if (shouldAutoScroll) {
      scrollToBottom(true);
    }

    return { row: row, bubble: bubble };
  }

  // Wraps <pre><code> with headers and "Copy" button
  function enhanceCodeBlocks(container) {
    const pres = container.querySelectorAll('pre');
    pres.forEach(function (pre) {
      if (pre.parentElement && pre.parentElement.classList.contains('code-block-wrapper')) {
        return;
      }

      const code = pre.querySelector('code');
      let lang = 'code';
      if (code) {
        const langClass = Array.from(code.classList).find(function (cls) {
          return cls.startsWith('language-');
        });
        if (langClass) {
          lang = langClass.replace('language-', '');
        }
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';

      const header = document.createElement('div');
      header.className = 'code-header';
      header.innerHTML = `
        <span class="code-lang">${escapeHtml(lang)}</span>
        <button class="code-copy-btn" title="Salin kode">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span class="copy-text">Salin</span>
        </button>
      `;

      const copyBtn = header.querySelector('.code-copy-btn');
      copyBtn.addEventListener('click', function () {
        const textToCopy = code ? code.innerText : pre.innerText;
        navigator.clipboard.writeText(textToCopy).then(function () {
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span class="copy-text">Tersalin!</span>
          `;
          setTimeout(function () {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span class="copy-text">Salin</span>
            `;
          }, 2000);
        }).catch(function (err) {
          console.error('Failed to copy code: ', err);
          showToast('Gagal menyalin kode', 'error');
        });
      });

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    });
  }

  // =========================================================================
  // Auto Scroll Logic
  // =========================================================================
  function scrollToBottom(smooth) {
    const area = elements.chatScrollArea;
    if (!area) return;
    area.scrollTo({
      top: area.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  function handleScroll() {
    const area = elements.chatScrollArea;
    if (!area) return;
    const threshold = 120;
    const isAtBottom = (area.scrollHeight - area.scrollTop - area.clientHeight) <= threshold;
    shouldAutoScroll = isAtBottom;

    if (!isAtBottom && area.scrollTop > 200) {
      elements.scrollBottomBtn.classList.add('visible');
    } else {
      elements.scrollBottomBtn.classList.remove('visible');
    }
  }

  // =========================================================================
  // Send Message & Streaming Request (POST /api/chat)
  // =========================================================================
  async function handleSubmit(e) {
    if (e) e.preventDefault();

    const rawText = elements.userInput.value.trim();
    if (!rawText || isGenerating) return;

    let activeChat = getActiveChat();
    if (!activeChat) {
      createNewChat();
      activeChat = getActiveChat();
    }

    // Auto-update chat title from first prompt
    if (activeChat.messages.length === 0) {
      const cleanTitle = rawText.length > 28 ? rawText.substring(0, 28) + '...' : rawText;
      activeChat.title = cleanTitle;
      elements.chatTitle.textContent = cleanTitle;
      saveSessions();
      renderHistoryList();
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Append User Message to UI & State
    appendMessageToDOM('user', rawText, timestamp, false);
    activeChat.messages.push({
      role: 'user',
      content: rawText,
      timestamp: timestamp
    });
    saveSessions();

    // Reset input
    elements.userInput.value = '';
    adjustTextareaHeight();
    updateSendButtonState();

    // Start generation state
    setGeneratingState(true);
    abortController = new AbortController();

    // Append Assistant Placeholder in DOM
    const assistantDOM = appendMessageToDOM('assistant', '', timestamp, true);
    let accumulatedContent = '';

    try {
      // Build conversation payload formatted as an Array of messages
      // Backend expects: req.body.message to be an array of { role, content }
      const payloadMessages = activeChat.messages.map(function (msg) {
        return {
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        };
      });

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: payloadMessages
        }),
        signal: abortController.signal
      });

      // Handle non-OK response (e.g. 400, 500)
      if (!response.ok) {
        let errorDetail = 'Terjadi kesalahan pada server (Status ' + response.status + ')';
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errorDetail = errData.error;
          }
        } catch (_) {
          const rawText = await response.text();
          if (rawText) errorDetail = rawText;
        }
        throw new Error(errorDetail);
      }

      // Check if response is streamable
      if (!response.body) {
        throw new Error('Respons server tidak mendukung streaming body.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // SSE format: data: <payload>
          if (line.startsWith('data:')) {
            const dataStr = line.replace(/^data:\s*/, '').trim();

            if (dataStr === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed && typeof parsed.content === 'string') {
                accumulatedContent += parsed.content;
                assistantDOM.bubble.innerHTML = renderMarkdown(accumulatedContent) + '<span class="streaming-cursor"></span>';
                if (shouldAutoScroll) {
                  scrollToBottom(false);
                }
              } else if (typeof parsed === 'string') {
                // If server sends error string in SSE
                accumulatedContent += parsed;
                assistantDOM.bubble.innerHTML = renderMarkdown(accumulatedContent) + '<span class="streaming-cursor"></span>';
              }
            } catch (jsonErr) {
              // Sometimes server writes string directly
              console.warn('SSE Chunk JSON parse note:', jsonErr, dataStr);
            }
          }
        }
      }

      // Finalize Assistant Message
      assistantDOM.bubble.innerHTML = renderMarkdown(accumulatedContent || '_(Tidak ada respons yang diterima)_');
      enhanceCodeBlocks(assistantDOM.bubble);

      activeChat.messages.push({
        role: 'assistant',
        content: accumulatedContent || '(Respons kosong)',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      saveSessions();

    } catch (err) {
      if (err.name === 'AbortError') {
        assistantDOM.bubble.innerHTML = renderMarkdown(accumulatedContent + ' _[Respons dihentikan oleh pengguna]_');
        enhanceCodeBlocks(assistantDOM.bubble);
        activeChat.messages.push({
          role: 'assistant',
          content: accumulatedContent + ' [Respons dihentikan]',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        saveSessions();
        showToast('Respons berhasil dihentikan.', 'info');
      } else {
        console.error('Chat error:', err);
        const errMsg = err.message || 'Gagal menghubungi server';

        let tip = '';
        if (errMsg.includes('Message harus berupa Array')) {
          tip = '<br><small><strong>Catatan Server:</strong> Endpoint POST /api/chat memeriksa <code>Array.isArray(message)</code>. Pastikan kode backend tidak memiliki bug logika pembalikan kondisi.</small>';
        }

        assistantDOM.bubble.innerHTML = `
          <div class="error-bubble">
            <svg class="error-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <div class="error-text">
              <strong>Gagal memproses pesan:</strong> ${escapeHtml(errMsg)}${tip}
              <div class="error-actions">
                <button type="button" class="btn-retry" id="retry-btn">Coba Lagi</button>
              </div>
            </div>
          </div>
        `;

        const retryBtn = assistantDOM.bubble.querySelector('#retry-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', function () {
            // Remove error message and retry last user input
            activeChat.messages.pop(); // remove user message from history
            saveSessions();
            elements.userInput.value = rawText;
            handleSubmit();
          });
        }

        showToast('Gagal memproses permintaan: ' + errMsg, 'error');
      }
    } finally {
      setGeneratingState(false);
      abortController = null;
      if (shouldAutoScroll) {
        scrollToBottom(true);
      }
    }
  }

  function handleStop() {
    if (abortController) {
      abortController.abort();
    }
  }

  function setGeneratingState(generating) {
    isGenerating = generating;
    if (generating) {
      elements.stopBtn.classList.remove('hidden');
      elements.sendBtn.disabled = true;
      elements.sendBtn.classList.add('hidden');
    } else {
      elements.stopBtn.classList.add('hidden');
      elements.sendBtn.classList.remove('hidden');
      updateSendButtonState();
    }
  }

  // =========================================================================
  // Textarea Auto Expansion & Input Handling
  // =========================================================================
  function adjustTextareaHeight() {
    const textarea = elements.userInput;
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 180);
    textarea.style.height = newHeight + 'px';
  }

  function updateSendButtonState() {
    const hasText = elements.userInput.value.trim().length > 0;
    elements.sendBtn.disabled = !hasText || isGenerating;
  }

  function handleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!elements.sendBtn.disabled) {
        handleSubmit();
      }
    }
  }

  // =========================================================================
  // Toast Notifications
  // =========================================================================
  function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type === 'error' ? 'toast-error' : (type === 'success' ? 'toast-success' : ''));

    const icon = type === 'error'
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <circle cx="12" cy="12" r="10"></circle>
           <line x1="12" y1="8" x2="12" y2="12"></line>
           <line x1="12" y1="16" x2="12.01" y2="16"></line>
         </svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
           <polyline points="22 4 12 14.01 9 11.01"></polyline>
         </svg>`;

    toast.innerHTML = icon + `<span>${escapeHtml(message)}</span>`;
    elements.toastContainer.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(function () {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 300);
    }, 3500);
  }

  // =========================================================================
  // Mobile Sidebar Drawer
  // =========================================================================
  function openMobileSidebar() {
    elements.sidebar.classList.add('open');
    elements.sidebarOverlay.classList.add('active');
  }

  function closeMobileSidebar() {
    elements.sidebar.classList.remove('open');
    elements.sidebarOverlay.classList.remove('active');
  }

  // =========================================================================
  // Modal Handlers
  // =========================================================================
  function openInfoModal() {
    elements.infoModal.classList.remove('hidden');
  }

  function closeInfoModal() {
    elements.infoModal.classList.add('hidden');
  }

  // =========================================================================
  // Suggestions Cards Click
  // =========================================================================
  function initSuggestionCards() {
    const cards = document.querySelectorAll('.suggestion-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        const prompt = card.getAttribute('data-prompt');
        if (prompt && !isGenerating) {
          elements.userInput.value = prompt;
          adjustTextareaHeight();
          updateSendButtonState();
          handleSubmit();
        }
      });
    });
  }

  // =========================================================================
  // Event Listeners Initialization
  // =========================================================================
  function initEventListeners() {
    // Form & Input
    elements.chatForm.addEventListener('submit', handleSubmit);
    elements.userInput.addEventListener('input', function () {
      adjustTextareaHeight();
      updateSendButtonState();
    });
    elements.userInput.addEventListener('keydown', handleInputKeydown);
    elements.stopBtn.addEventListener('click', handleStop);

    // Sidebar & Navigation
    elements.newChatBtn.addEventListener('click', createNewChat);
    elements.clearAllBtn.addEventListener('click', clearAllChats);
    elements.themeToggleBtn.addEventListener('click', toggleTheme);

    // Mobile drawer
    elements.mobileMenuBtn.addEventListener('click', openMobileSidebar);
    elements.closeSidebarBtn.addEventListener('click', closeMobileSidebar);
    elements.sidebarOverlay.addEventListener('click', closeMobileSidebar);

    // Scrolling
    elements.chatScrollArea.addEventListener('scroll', handleScroll);
    elements.scrollBottomBtn.addEventListener('click', function () {
      scrollToBottom(true);
    });

    // Info Modal
    elements.infoBtn.addEventListener('click', openInfoModal);
    elements.modalCloseBtn.addEventListener('click', closeInfoModal);
    elements.modalOkBtn.addEventListener('click', closeInfoModal);
    elements.infoModal.addEventListener('click', function (e) {
      if (e.target === elements.infoModal) closeInfoModal();
    });

    // Suggestions
    initSuggestionCards();

    // Window Resize
    window.addEventListener('resize', function () {
      if (window.innerWidth > 768) {
        closeMobileSidebar();
      }
    });
  }

  // =========================================================================
  // Application Entry Point
  // =========================================================================
  function init() {
    setupMarkdown();
    initTheme();
    loadSessions();

    const savedActiveId = localStorage.getItem(STORAGE_KEYS.ACTIVE_ID);
    if (savedActiveId && chats.some(function (c) { return c.id === savedActiveId; })) {
      switchChat(savedActiveId);
    } else if (chats.length > 0) {
      switchChat(chats[0].id);
    } else {
      createNewChat();
    }

    initEventListeners();
    updateSendButtonState();
  }

  // Start app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

