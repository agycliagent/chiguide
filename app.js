'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    form: $('#chatForm'), input: $('#userInput'), send: $('#sendBtn'),
    messages: $('#messages'), welcome: $('#welcome'), baseUrl: $('#baseUrlInput'),
    apiKey: $('#apiKeyInput'), model: $('#modelInput'), activeModel: $('#activeModel'),
    toast: $('#toast'), history: $('#historyList'), sidebar: $('#sidebar')
  };
  const CONFIG_STORAGE = 'chiguide-config-v1';
  const HISTORY_STORAGE = 'chiguide-history-v1';
  let messages = [];
  let sending = false;
  let toastTimer;

  function configFromStorage() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_STORAGE) || '{}');
      return {
        baseUrl: saved.baseUrl || 'https://llm.xinjiyuan.tech/v1',
        model: saved.model || 'boss-31b',
        apiKey: sessionStorage.getItem('chiguide-api-key') || ''
      };
    } catch {
      return { baseUrl: 'https://llm.xinjiyuan.tech/v1', model: 'boss-31b', apiKey: '' };
    }
  }

  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2800);
  }

  function updateModelLabel() {
    ui.activeModel.textContent = ui.model.value.trim() || '未设置模型';
  }

  function loadConfig() {
    const config = configFromStorage();
    ui.baseUrl.value = config.baseUrl;
    ui.model.value = config.model;
    ui.apiKey.value = config.apiKey;
    updateModelLabel();
  }

  function saveConfig() {
    const config = {
      baseUrl: ui.baseUrl.value.trim().replace(/\/+$/, ''),
      model: ui.model.value.trim()
    };
    if (!config.baseUrl || !config.model) {
      toast('请填写 API 地址和模型名称。');
      return false;
    }
    localStorage.setItem(CONFIG_STORAGE, JSON.stringify(config));
    const key = ui.apiKey.value.trim();
    if (key) sessionStorage.setItem('chiguide-api-key', key);
    else sessionStorage.removeItem('chiguide-api-key');
    ui.baseUrl.value = config.baseUrl;
    updateModelLabel();
    toast('设置已保存。API Key 仅保留在当前标签页。');
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
    ui.messages.appendChild(row);
    ui.messages.scrollTop = ui.messages.scrollHeight;
    return row;
  }

  function renderConversation() {
    ui.messages.replaceChildren();
    ui.welcome.classList.toggle('hidden', messages.length > 0);
    ui.messages.classList.toggle('visible', messages.length > 0);
    for (const message of messages) renderMessage(message.role, message.content);
    ui.messages.scrollTop = ui.messages.scrollHeight;
  }

  function readHistory() {
    try {
      const history = JSON.parse(localStorage.getItem(HISTORY_STORAGE) || '[]');
      return Array.isArray(history) ? history.filter((item) => item && typeof item.title === 'string') : [];
    } catch { return []; }
  }

  function saveConversation() {
    if (!messages.length) return;
    const firstUser = messages.find((message) => message.role === 'user');
    if (!firstUser) return;
    const history = readHistory().filter((item) => item.id !== window.currentChatId);
    history.unshift({ id: window.currentChatId, title: firstUser.content.slice(0, 40), messages, updatedAt: Date.now() });
    localStorage.setItem(HISTORY_STORAGE, JSON.stringify(history.slice(0, 20)));
    renderHistory();
  }

  function renderHistory() {
    ui.history.replaceChildren();
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
        ui.sidebar.classList.remove('open');
      });
      ui.history.appendChild(button);
    }
  }

  function newChat() {
    saveConversation();
    window.currentChatId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    messages = [];
    renderConversation();
    renderHistory();
    ui.input.focus();
    ui.sidebar.classList.remove('open');
  }

  async function requestCompletion(history) {
    const config = configFromStorage();
    const key = ui.apiKey.value.trim() || config.apiKey;
    if (!key) throw new Error('请先在左侧模型设置中填写 API Key。');
    const model = ui.model.value.trim();
    if (!model) throw new Error('请填写模型名称。');

    // Keep requests same-origin: server.js adds the upstream API key and avoids browser CORS.
    const response = await fetch('/api/chat/completions', {
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
    const answer = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('模型返回了空内容，请稍后重试。');
    return answer.trim();
  }

  async function sendMessage(text) {
    if (sending || !text.trim()) return;
    const content = text.trim();
    sending = true;
    ui.send.disabled = true;
    ui.input.value = '';
    resizeInput();
    ui.welcome.classList.add('hidden');
    ui.messages.classList.add('visible');
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
      const errorText = error instanceof TypeError
        ? '无法连接本地服务。请确认通过 npm start 启动，并使用 http://localhost:3000 打开页面。'
        : (error?.message || '发生未知错误，请稍后重试。');
      renderMessage('assistant', errorText, { error: true });
      saveConversation();
    } finally {
      sending = false;
      ui.send.disabled = false;
      ui.input.focus();
    }
  }

  function resizeInput() {
    ui.input.style.height = 'auto';
    ui.input.style.height = `${Math.min(ui.input.scrollHeight, 150)}px`;
  }

  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(ui.input.value);
  });
  ui.input.addEventListener('input', resizeInput);
  ui.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ui.form.requestSubmit();
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
    toast('当前对话已清空。');
  });
  $('#saveConfigBtn').addEventListener('click', saveConfig);
  $('#toggleKeyBtn').addEventListener('click', (event) => {
    const visible = ui.apiKey.type === 'password';
    ui.apiKey.type = visible ? 'text' : 'password';
    event.currentTarget.textContent = visible ? '隐藏' : '显示';
    event.currentTarget.setAttribute('aria-label', visible ? '隐藏 API Key' : '显示 API Key');
  });
  ui.model.addEventListener('input', updateModelLabel);
  $('#menuBtn').addEventListener('click', () => ui.sidebar.classList.toggle('open'));
  document.addEventListener('click', (event) => {
    if (window.innerWidth <= 760 && ui.sidebar.classList.contains('open') && !ui.sidebar.contains(event.target) && !event.target.closest('#menuBtn')) {
      ui.sidebar.classList.remove('open');
    }
  });

  window.currentChatId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  loadConfig();
  renderHistory();
})();
