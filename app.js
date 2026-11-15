(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    form: $('#chatForm'), input: $('#userInput'), send: $('#sendBtn'),
    messages: $('#messages'), welcome: $('#welcome'), baseUrl: $('#baseUrlInput'),
    apiKey: $('#apiKeyInput'), model: $('#modelInput'), activeModel: $('#activeModel'),
    toast: $('#toast'), history: $('#historyList'), sidebar: $('#sidebar')
  };
  const CONFIG_STORAGE = 'chiguide-config-v1';
  const HISTORY_STORAGE = 'chiguide-history-v1';
  let messages = [];
  let isSending = false;
  let toastTimer;

  function readConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_STORAGE) || '{}');
      const key = sessionStorage.getItem('chiguide-api-key') || '';
      return { baseUrl: saved.baseUrl || 'https://llm.xinjiyuan.tech/v1', model: saved.model || 'boss-31b', apiKey: key };
    } catch {
      return { baseUrl: 'https://llm.xinjiyuan.tech/v1', model: 'boss-31b', apiKey: '' };
    }
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2800);
  }

  function updateActiveModel() {
    elements.activeModel.textContent = elements.model.value.trim() || '未设置模型';
  }

  function loadConfig() {
    const config = readConfig();
    elements.baseUrl.value = config.baseUrl;
    elements.model.value = config.model;
    elements.apiKey.value = config.apiKey;
    updateActiveModel();
  }

  function saveConfig() {
    const config = {
      baseUrl: elements.baseUrl.value.trim().replace(/\/+$/, ''),
      model: elements.model.value.trim()
    };
    if (!config.baseUrl || !config.model) {
      showToast('请填写 API 地址和模型名称。');
      return false;
    }
    localStorage.setItem(CONFIG_STORAGE, JSON.stringify(config));
    const key = elements.apiKey.value.trim();
    if (key) sessionStorage.setItem('chiguide-api-key', key);
    else sessionStorage.removeItem('chiguide-api-key');
    elements.baseUrl.value = config.baseUrl;
    updateActiveModel();
    showToast('设置已保存。API Key 仅保留在当前标签页。');
    return true;
  }

  function renderMessage(role, content, options = {}) {
    const row = document.createElement('article');
    row.className = `message-row ${role}`;
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'assistant' ? '✳' : '你';
    avatar.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    body.className = `message-content${options.error ? ' error' : ''}`;
    if (options.typing) {
      body.setAttribute('aria-label', '正在思考');
      const dots = document.createElement('span');
      dots.className = 'typing';
      dots.innerHTML = '<i></i><i></i><i></i>';
      body.appendChild(dots);
    } else {
      body.textContent = content;
    }
    row.append(avatar, body);
    elements.messages.appendChild(row);
    elements.messages.scrollTop = elements.messages.scrollHeight;
    return row;
  }

  function renderConversation() {
    elements.messages.replaceChildren();
    elements.welcome.classList.toggle('hidden', messages.length > 0);
    elements.messages.classList.toggle('visible', messages.length > 0);
    for (const message of messages) renderMessage(message.role, message.content);
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function readHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(HISTORY_STORAGE) || '[]');
      return Array.isArray(data) ? data.filter((item) => item && typeof item.title === 'string') : [];
    } catch { return []; }
  }

  function saveConversation() {
    if (!messages.length) return;
    const history = readHistory();
    const firstUser = messages.find((message) => message.role === 'user');
    if (!firstUser) return;
    const title = firstUser.content.slice(0, 40);
    const saved = history.filter((item) => item.id !== window.currentChatId);
    saved.unshift({ id: window.currentChatId, title, messages, updatedAt: Date.now() });
    localStorage.setItem(HISTORY_STORAGE, JSON.stringify(saved.slice(0, 20)));
    renderHistory();
  }

  function renderHistory() {
    elements.history.replaceChildren();
    for (const item of readHistory()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `history-item${item.id === window.currentChatId ? ' active' : ''}`;
      button.textContent = item.title;
      button.title = item.title;
      button.addEventListener('click', () => {
        saveConversation();
        window.currentChatId = item.id;
        messages = Array.isArray(item.messages) ? item.messages : [];
        renderConversation();
        renderHistory();
        elements.sidebar.classList.remove('open');
      });
      elements.history.appendChild(button);
    }
  }

  function newChat() {
    saveConversation();
    window.currentChatId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    messages = [];
    renderConversation();
    renderHistory();
    elements.input.focus();
    elements.sidebar.classList.remove('open');
  }

  async function requestCompletion(history) {
    const config = readConfig();
    const key = elements.apiKey.value.trim() || config.apiKey;
    if (!key) throw new Error('请先在左侧模型设置中填写 API Key。');
    const baseUrl = elements.baseUrl.value.trim().replace(/\/+$/, '');
    const model = elements.model.value.trim();
    if (!baseUrl || !model) throw new Error('请先填写 API 地址和模型名称。');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: history, temperature: 0.7 })
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body?.error?.message || body?.message || '';
      } catch { /* Response may not be JSON. */ }
      if (response.status === 401 || response.status === 403) throw new Error('API Key 无效或没有访问权限，请检查模型设置。');
      throw new Error(`接口请求失败（${response.status}）${detail ? `：${detail}` : ''}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('模型返回了空内容，请稍后重试。');
    return text.trim();
  }

  async function sendMessage(text) {
    if (isSending || !text.trim()) return;
    const content = text.trim();
    isSending = true;
    elements.send.disabled = true;
    elements.input.value = '';
    resizeInput();
    elements.welcome.classList.add('hidden');
    elements.messages.classList.add('visible');
    messages.push({ role: 'user', content });
    renderMessage('user', content);
    const pending = renderMessage('assistant', '', { typing: true });
    try {
      const answer = await requestCompletion(messages.map(({ role, content: text }) => ({ role, content: text })));
      pending.remove();
      messages.push({ role: 'assistant', content: answer });
      renderMessage('assistant', answer);
      saveConversation();
    } catch (error) {
      pending.remove();
      const message = error instanceof TypeError
        ? '无法连接接口。请检查网络、API 地址以及服务端是否允许浏览器跨域访问（CORS）。'
        : (error?.message || '发生未知错误，请稍后重试。');
      renderMessage('assistant', message, { error: true });
      // Do not save an API error as part of the chat history sent to the model.
      saveConversation();
    } finally {
      isSending = false;
      elements.send.disabled = false;
      elements.input.focus();
    }
  }

  function resizeInput() {
    elements.input.style.height = 'auto';
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 150)}px`;
  }

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(elements.input.value);
  });
  elements.input.addEventListener('input', resizeInput);
  elements.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });
  document.querySelectorAll('.suggestion').forEach((button) => {
    button.addEventListener('click', () => sendMessage(button.dataset.prompt || ''));
  });
  $('#newChatBtn').addEventListener('click', newChat);
  $('#clearBtn').addEventListener('click', () => {
    messages = [];
    window.currentChatId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    renderConversation();
    renderHistory();
    showToast('当前对话已清空。');
  });
  $('#saveConfigBtn').addEventListener('click', saveConfig);
  $('#toggleKeyBtn').addEventListener('click', (event) => {
    const visible = elements.apiKey.type === 'password';
    elements.apiKey.type = visible ? 'text' : 'password';
    event.currentTarget.textContent = visible ? '隐藏' : '显示';
    event.currentTarget.setAttribute('aria-label', visible ? '隐藏 API Key' : '显示 API Key');
  });
  elements.model.addEventListener('input', updateActiveModel);
  $('#menuBtn').addEventListener('click', () => elements.sidebar.classList.toggle('open'));
  document.addEventListener('click', (event) => {
    if (window.innerWidth <= 760 && elements.sidebar.classList.contains('open') && !elements.sidebar.contains(event.target) && !event.target.closest('#menuBtn')) {
      elements.sidebar.classList.remove('open');
    }
  });
  window.addEventListener('beforeunload', () => {
    const key = elements.apiKey.value.trim();
    if (key) sessionStorage.setItem('chiguide-api-key', key);
  });

  window.currentChatId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  loadConfig();
  renderHistory();
})();
