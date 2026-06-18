const DEFAULT_RULES = [
  'DOMAIN-SUFFIX,google.com,PROXY',
  'DOMAIN-SUFFIX,googleapis.com,PROXY',
  'DOMAIN-SUFFIX,gstatic.com,PROXY',
  'DOMAIN-SUFFIX,youtube.com,PROXY',
  'DOMAIN-SUFFIX,ytimg.com,PROXY',
  'DOMAIN-SUFFIX,github.com,PROXY',
  'DOMAIN-SUFFIX,githubusercontent.com,PROXY',
  'DOMAIN-SUFFIX,twitter.com,PROXY',
  'DOMAIN-SUFFIX,x.com,PROXY',
  'DOMAIN-SUFFIX,telegram.org,PROXY',
  'DOMAIN-SUFFIX,openai.com,PROXY',
  'DOMAIN-SUFFIX,cloudflare.com,PROXY',
  'GEOIP,CN,DIRECT',
  'MATCH,DIRECT'
];

const $ = (selector) => document.querySelector(selector);

let subscriptions = [];
let activeSubscriptionId = '';
let profiles = [];
let activeProfileId = '';
let ruleEditorMode = 'gui'; // 'gui' | 'text'
let guiRules = []; // parsed rules for GUI editor
let logAutoRefresh = false;
let mihomoLogWs = null;
let logRawText = ''; // last fetched log text

init().catch((error) => setMessage('#saveMsg', error.message, true));

async function init() {
  const settings = await getSettings();
  subscriptions = normalizeSubscriptions(settings.subscriptions, settings.subscriptionUrl);
  activeSubscriptionId = settings.activeSubscriptionId || (subscriptions[0] && subscriptions[0].id) || '';
  profiles = normalizeProfiles(settings.profiles);
  activeProfileId = settings.activeProfileId || '';

  $('#proxyHost').value = settings.proxyHost;
  $('#proxyPort').value = settings.proxyPort;
  $('#proxyType').value = settings.proxyType;
  $('#bypassList').value = settings.bypassList;
  $('#controllerUrl').value = settings.controllerUrl;
  $('#controllerSecret').value = settings.controllerSecret;
  $('#updateSubscriptionBeforeStart').checked = settings.updateSubscriptionBeforeStart !== false;
  $('#allowLan').checked = Boolean(settings.allowLan);
  $('#pacRules').value = settings.pacRules.join('\n');
  guiRules = parseRules(settings.pacRules);
  renderRuleListGui();
  renderSubscriptions();
  renderProfiles();

  $('#saveBtn').addEventListener('click', saveOptions);
  $('#applyBtn').addEventListener('click', async () => {
    await saveOptions();
    const res = await sendRuntimeMessage({ type: 'APPLY_PROXY' });
    if (!res || !res.ok) throw new Error((res && res.error) || '应用失败');
    setMessage('#saveMsg', '已保存并应用');
  });
  $('#resetRulesBtn').addEventListener('click', () => {
    guiRules = parseRules(DEFAULT_RULES);
    syncGuiToText();
    renderRuleListGui();
  });
  $('#testBtn').addEventListener('click', testController);
  $('#addSubBtn').addEventListener('click', addSubscription);
  $('#updateSubBtn').addEventListener('click', () => updateSubscription(false));
  $('#updateSubRestartBtn').addEventListener('click', () => updateSubscription(true));
  $('#applyAllowLanBtn').addEventListener('click', applyAllowLan);
  $('#refreshActiveSubInfoBtn').addEventListener('click', refreshActiveSubscriptionInfo);
  $('#refreshAllSubInfoBtn').addEventListener('click', refreshAllSubscriptionInfo);
  $('#clearLogBtn').addEventListener('click', clearLogViewer);
  $('#toggleAutoLogBtn').addEventListener('click', toggleAutoLog);
  $('#logSearchInput').addEventListener('input', applyLogFilter);
  $('#logLevelSelect').addEventListener('change', onLogLevelChange);

  // Rule GUI editor events
  $('#addRuleBtn').addEventListener('click', addRuleFromGui);
  $('#ruleValueInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addRuleFromGui();
  });
  $('#ruleTypeSelect').addEventListener('change', onRuleTypeChange);
  $('#toggleRuleEditorBtn').addEventListener('click', toggleRuleEditorMode);

  // Profile events
  $('#saveProfileBtn').addEventListener('click', saveCurrentProfile);
}

/* ── Rule GUI Editor ── */

function parseRules(ruleLines) {
  return (Array.isArray(ruleLines) ? ruleLines : [])
    .map((line, index) => {
      const clean = String(line || '').trim();
      if (!clean || clean.startsWith('#')) return null;
      const parts = clean.split(',').map((p) => p.trim());
      const type = (parts[0] ? parts[0].toUpperCase() : undefined) || '';
      if (type === 'MATCH') return { type: 'MATCH', value: '', action: (parts[1] || 'DIRECT').toUpperCase(), index };
      if (type === 'GEOIP') return { type: 'GEOIP', value: parts[1] || '', action: (parts[2] || 'DIRECT').toUpperCase(), index, ignored: true };
      const value = parts[1] || '';
      const action = (parts[2] || 'DIRECT').toUpperCase();
      return { type, value, action, index };
    })
    .filter(Boolean);
}

function rulesToLines(rules) {
  return rules
    .filter((r) => !r.ignored)
    .map((r) => {
      if (r.type === 'MATCH') return `MATCH,${r.action}`;
      return `${r.type},${r.value},${r.action}`;
    });
}

function renderRuleListGui() {
  const container = $('#ruleListGui');
  container.innerHTML = '';

  if (!guiRules.length) {
    const empty = document.createElement('div');
    empty.className = 'rule-empty';
    empty.textContent = '暂无规则，请添加';
    container.appendChild(empty);
    return;
  }

  guiRules.forEach((rule, idx) => {
    const row = document.createElement('div');
    row.className = 'rule-row' + (rule.ignored ? ' rule-ignored' : '');
    if (rule.action === 'PROXY') row.classList.add('rule-proxy');
    else if (rule.action === 'DIRECT') row.classList.add('rule-direct');

    const badge = document.createElement('span');
    badge.className = 'rule-type-badge';
    badge.textContent = rule.type;

    const value = document.createElement('span');
    value.className = 'rule-value';
    value.textContent = rule.value || (rule.type === 'MATCH' ? '(全部)' : '');

    const actionBadge = document.createElement('span');
    actionBadge.className = 'rule-action-badge';
    actionBadge.textContent = rule.action;

    const actions = document.createElement('div');
    actions.className = 'rule-row-actions';

    if (idx > 0) {
      const upBtn = document.createElement('button');
      upBtn.className = 'ghost-btn rule-move-btn';
      upBtn.textContent = '↑';
      upBtn.title = '上移';
      upBtn.addEventListener('click', () => moveRule(idx, -1));
      actions.appendChild(upBtn);
    }

    if (idx < guiRules.length - 1) {
      const downBtn = document.createElement('button');
      downBtn.className = 'ghost-btn rule-move-btn';
      downBtn.textContent = '↓';
      downBtn.title = '下移';
      downBtn.addEventListener('click', () => moveRule(idx, 1));
      actions.appendChild(downBtn);
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'ghost-btn rule-toggle-btn';
    toggleBtn.textContent = rule.action === 'PROXY' ? '→直连' : '→代理';
    toggleBtn.title = '切换代理/直连';
    toggleBtn.addEventListener('click', () => toggleRuleAction(idx));
    actions.appendChild(toggleBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'link-btn danger rule-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = '删除';
    delBtn.addEventListener('click', () => deleteRule(idx));
    actions.appendChild(delBtn);

    row.appendChild(badge);
    row.appendChild(value);
    row.appendChild(actionBadge);
    row.appendChild(actions);
    container.appendChild(row);
  });
}

function addRuleFromGui() {
  const type = $('#ruleTypeSelect').value;
  const value = $('#ruleValueInput').value.trim();
  const action = $('#ruleActionSelect').value;

  if (type !== 'MATCH' && !value) {
    setMessage('#saveMsg', '请输入规则值', true);
    return;
  }

  guiRules.push({ type, value: type === 'MATCH' ? '' : value, action });
  syncGuiToText();
  renderRuleListGui();
  $('#ruleValueInput').value = '';
  setMessage('#saveMsg', '规则已添加');
}

function deleteRule(idx) {
  guiRules.splice(idx, 1);
  syncGuiToText();
  renderRuleListGui();
}

function moveRule(idx, direction) {
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= guiRules.length) return;
  [guiRules[idx], guiRules[newIdx]] = [guiRules[newIdx], guiRules[idx]];
  syncGuiToText();
  renderRuleListGui();
}

function toggleRuleAction(idx) {
  const rule = guiRules[idx];
  rule.action = rule.action === 'PROXY' ? 'DIRECT' : 'PROXY';
  syncGuiToText();
  renderRuleListGui();
}

function onRuleTypeChange() {
  const type = $('#ruleTypeSelect').value;
  const valueInput = $('#ruleValueInput');
  const actionSelect = $('#ruleActionSelect');
  if (type === 'MATCH') {
    valueInput.disabled = true;
    valueInput.placeholder = '(MATCH 无需值)';
    actionSelect.disabled = false;
  } else {
    valueInput.disabled = false;
    actionSelect.disabled = false;
    if (type === 'IP-CIDR') valueInput.placeholder = '如 192.168.0.0/16';
    else if (type === 'DOMAIN') valueInput.placeholder = '如 www.google.com';
    else if (type === 'DOMAIN-KEYWORD') valueInput.placeholder = '如 google';
    else valueInput.placeholder = '如 google.com';
  }
}

function syncGuiToText() {
  const lines = rulesToLines(guiRules);
  $('#pacRules').value = lines.join('\n');
}

function syncTextToGui() {
  const lines = $('#pacRules').value.split('\n').map((l) => l.trim()).filter(Boolean);
  guiRules = parseRules(lines);
  renderRuleListGui();
}

function toggleRuleEditorMode() {
  if (ruleEditorMode === 'gui') {
    syncGuiToText();
    $('#ruleGuiEditor').style.display = 'none';
    $('#ruleTextEditor').style.display = '';
    $('#toggleRuleEditorBtn').textContent = 'GUI 模式';
    ruleEditorMode = 'text';
  } else {
    syncTextToGui();
    $('#ruleGuiEditor').style.display = '';
    $('#ruleTextEditor').style.display = 'none';
    $('#toggleRuleEditorBtn').textContent = '文本模式';
    ruleEditorMode = 'gui';
  }
}

/* ── Profile Management ── */

function renderProfiles() {
  const list = $('#profileList');
  list.innerHTML = '';

  if (!profiles.length) {
    const empty = document.createElement('div');
    empty.className = 'profile-empty';
    empty.textContent = '暂无保存的配置，点击下方「保存当前配置」创建';
    list.appendChild(empty);
    return;
  }

  profiles.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'profile-item' + (p.id === activeProfileId ? ' profile-active' : '');

    const info = document.createElement('div');
    info.className = 'profile-info';

    const name = document.createElement('strong');
    name.textContent = p.name;

    const meta = document.createElement('small');
    const parts = [p.mode, `${p.proxyHost}:${p.proxyPort}`, p.proxyType];
    if ((p.pacRules && p.pacRules.length)) parts.push(`${p.pacRules.length} 条规则`);
    meta.textContent = parts.join(' · ');

    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'profile-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'secondary-btn';
    loadBtn.textContent = '加载';
    loadBtn.addEventListener('click', () => loadProfileById(p.id));

    const updateBtn = document.createElement('button');
    updateBtn.className = 'ghost-btn';
    updateBtn.textContent = '更新';
    updateBtn.title = '用当前设置覆盖此配置';
    updateBtn.addEventListener('click', () => updateProfileById(p.id));

    const delBtn = document.createElement('button');
    delBtn.className = 'link-btn danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => deleteProfileById(p.id));

    actions.append(loadBtn, updateBtn, delBtn);
    card.append(info, actions);
    list.appendChild(card);
  });
}

async function saveCurrentProfile() {
  const name = $('#profileName').value.trim();
  if (!name) return setMessage('#profileMsg', '请输入配置名称', true);

  const settings = await getSettings();
  // Sync current form values to settings first
  settings.proxyHost = $('#proxyHost').value.trim() || '127.0.0.1';
  settings.proxyPort = Number($('#proxyPort').value || 7890);
  settings.proxyType = $('#proxyType').value;
  settings.bypassList = $('#bypassList').value.trim();
  settings.controllerUrl = $('#controllerUrl').value.trim() || 'http://127.0.0.1:9090';
  settings.controllerSecret = $('#controllerSecret').value;
  settings.allowLan = $('#allowLan').checked;
  settings.pacRules = getCurrentPacRules();
  settings.mode = 'rule';
  settings.activeGroup = 'GLOBAL';
  settings.activeSubscriptionId = (getActiveSubscription() && getActiveSubscription().id) || '';

  const id = await saveAsProfile(name, settings);
  profiles = normalizeProfiles((await getSettings()).profiles);
  activeProfileId = (await getSettings()).activeProfileId;
  renderProfiles();
  $('#profileName').value = '';
  setMessage('#profileMsg', `配置「${name}」已保存`);
}

async function loadProfileById(id) {
  try {
    const settings = await getSettings();
    await loadProfile(id, settings);
    const updated = await getSettings();
    activeProfileId = updated.activeProfileId;

    // Update form
    $('#proxyHost').value = updated.proxyHost;
    $('#proxyPort').value = updated.proxyPort;
    $('#proxyType').value = updated.proxyType;
    $('#bypassList').value = updated.bypassList;
    $('#controllerUrl').value = updated.controllerUrl;
    $('#controllerSecret').value = updated.controllerSecret;
    $('#allowLan').checked = updated.allowLan;
    $('#pacRules').value = updated.pacRules.join('\n');
    guiRules = parseRules(updated.pacRules);
    renderRuleListGui();

    if (updated.activeSubscriptionId) {
      activeSubscriptionId = updated.activeSubscriptionId;
      subscriptions = normalizeSubscriptions(updated.subscriptions, updated.subscriptionUrl);
      renderSubscriptions();
    }

    renderProfiles();
    setMessage('#profileMsg', `已加载配置「${(profiles.find(function(p) { return p.id === id; }) || {}).name || id}」`);
  } catch (error) {
    setMessage('#profileMsg', `加载失败：${error.message}`, true);
  }
}

async function updateProfileById(id) {
  try {
    const settings = await getSettings();
    settings.proxyHost = $('#proxyHost').value.trim() || '127.0.0.1';
    settings.proxyPort = Number($('#proxyPort').value || 7890);
    settings.proxyType = $('#proxyType').value;
    settings.bypassList = $('#bypassList').value.trim();
    settings.controllerUrl = $('#controllerUrl').value.trim() || 'http://127.0.0.1:9090';
    settings.controllerSecret = $('#controllerSecret').value;
    settings.allowLan = $('#allowLan').checked;
    settings.pacRules = getCurrentPacRules();
    settings.mode = 'rule';
    settings.activeGroup = 'GLOBAL';
    settings.activeSubscriptionId = (getActiveSubscription() && getActiveSubscription().id) || '';

    await updateProfile(id, settings);
    profiles = normalizeProfiles((await getSettings()).profiles);
    renderProfiles();
    setMessage('#profileMsg', `配置已更新`);
  } catch (error) {
    setMessage('#profileMsg', `更新失败：${error.message}`, true);
  }
}

async function deleteProfileById(id) {
  const settings = await getSettings();
  await deleteProfile(id, settings);
  profiles = normalizeProfiles((await getSettings()).profiles);
  activeProfileId = (await getSettings()).activeProfileId;
  renderProfiles();
  setMessage('#profileMsg', '配置已删除');
}

function getCurrentPacRules() {
  if (ruleEditorMode === 'gui') {
    syncGuiToText();
  } else {
    syncTextToGui();
  }
  return $('#pacRules').value.split('\n').map((l) => l.trim()).filter(Boolean);
}

/* ── Subscriptions ── */

function normalizeSubscriptions(value, legacyUrl = '') {
  const list = Array.isArray(value) ? value : [];
  const normalized = list
    .map((item) => ({
      id: String((item && item.id) || createSubscriptionId()).trim(),
      name: String((item && item.name) || '').trim(),
      url: String((item && item.url) || '').trim(),
      remark: String((item && item.remark) || '').trim(),
      trafficInfo: normalizeTrafficInfo((item && item.trafficInfo))
    }))
    .filter((item) => item.url);

  if (!normalized.length && legacyUrl) {
    normalized.push({
      id: 'legacy-subscription',
      name: '默认订阅',
      url: String(legacyUrl).trim(),
      remark: '',
      trafficInfo: null
    });
  }
  return normalized;
}

function normalizeTrafficInfo(info) {
  if (!info || typeof info !== 'object') return null;
  return {
    upload: Number(info.upload || 0),
    download: Number(info.download || 0),
    total: Number(info.total || 0),
    expire: Number(info.expire || 0),
    raw: String(info.raw || ''),
    webPageUrl: String(info.webPageUrl || ''),
    updatedAt: Number(info.updatedAt || 0)
  };
}

function createSubscriptionId() {
  return `sub-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderSubscriptions() {
  const list = $('#subscriptionList');
  list.innerHTML = '';

  if (!subscriptions.length) {
    const empty = document.createElement('div');
    empty.className = 'subscription-empty';
    empty.textContent = '暂无订阅，请在下方添加。';
    list.append(empty);
    return;
  }

  subscriptions.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'subscription-item';
    card.dataset.id = item.id;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'activeSubscription';
    radio.checked = item.id === activeSubscriptionId || (!activeSubscriptionId && index === 0);
    radio.addEventListener('change', () => {
      activeSubscriptionId = item.id;
      renderSubscriptions();
    });

    const body = document.createElement('div');
    body.className = 'subscription-body';

    const title = document.createElement('strong');
    title.textContent = item.name || `订阅 ${index + 1}`;

    const url = document.createElement('small');
    url.textContent = item.url;

    const stats = document.createElement('div');
    stats.className = 'subscription-stats';
    stats.textContent = formatTrafficInfo(item.trafficInfo);

    const remark = document.createElement('p');
    remark.textContent = item.remark || '无备注';

    body.append(title, url, stats, remark);

    const actions = document.createElement('div');
    actions.className = 'subscription-actions';

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'secondary-btn';
    checkBtn.textContent = '识别';
    checkBtn.addEventListener('click', () => refreshSubscriptionInfo(item.id));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ghost-btn';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => fillSubscriptionForm(item));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'link-btn danger';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', () => deleteSubscription(item.id));

    actions.append(checkBtn, editBtn, deleteBtn);
    card.append(radio, body, actions);
    list.append(card);
  });
}

function fillSubscriptionForm(item) {
  $('#subEditId').value = item.id;
  $('#subName').value = item.name;
  $('#subUrl').value = item.url;
  $('#subRemark').value = item.remark;
  $('#addSubBtn').textContent = '保存订阅';
}

function resetSubscriptionForm() {
  $('#subEditId').value = '';
  $('#subName').value = '';
  $('#subUrl').value = '';
  $('#subRemark').value = '';
  $('#addSubBtn').textContent = '添加订阅';
}

async function addSubscription() {
  const id = $('#subEditId').value || createSubscriptionId();
  const name = $('#subName').value.trim();
  const url = $('#subUrl').value.trim();
  const remark = $('#subRemark').value.trim();

  if (!url) return setMessage('#subMsg', '订阅链接不能为空', true);
  if (!/^https?:\/\//i.test(url)) return setMessage('#subMsg', '订阅链接必须以 http:// 或 https:// 开头', true);

  const old = subscriptions.find((sub) => sub.id === id);
  const item = { id, name: name || `订阅 ${subscriptions.length + 1}`, url, remark, trafficInfo: (old && old.trafficInfo) || null };
  const index = subscriptions.findIndex((sub) => sub.id === id);
  if (index >= 0) subscriptions[index] = item;
  else subscriptions.push(item);

  activeSubscriptionId = activeSubscriptionId || id;
  resetSubscriptionForm();
  renderSubscriptions();
  setMessage('#subMsg', '订阅已加入列表，正在识别流量信息...');
  await refreshSubscriptionInfo(id, { silentError: true });
  setMessage('#subMsg', '订阅已加入列表，请点击保存设置');
}

function deleteSubscription(id) {
  subscriptions = subscriptions.filter((item) => item.id !== id);
  if (activeSubscriptionId === id) activeSubscriptionId = (subscriptions[0] && subscriptions[0].id) || '';
  renderSubscriptions();
  setMessage('#subMsg', '订阅已删除，请点击保存设置');
}

function getActiveSubscription() {
  return subscriptions.find((item) => item.id === activeSubscriptionId) || subscriptions[0] || null;
}

async function saveOptions() {
  const proxyPort = Number($('#proxyPort').value || 7890);
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
    setMessage('#saveMsg', '端口必须是 1-65535', true);
    return;
  }

  const pacRules = getCurrentPacRules();

  const active = getActiveSubscription();
  await setSettings({
    proxyHost: $('#proxyHost').value.trim() || '127.0.0.1',
    proxyPort,
    proxyType: $('#proxyType').value,
    bypassList: $('#bypassList').value.trim(),
    controllerUrl: $('#controllerUrl').value.trim() || 'http://127.0.0.1:9090',
    controllerSecret: $('#controllerSecret').value,
    subscriptions,
    activeSubscriptionId: (active && active.id) || '',
    subscriptionUrl: (active && active.url) || '',
    updateSubscriptionBeforeStart: $('#updateSubscriptionBeforeStart').checked,
    allowLan: $('#allowLan').checked,
    pacRules,
    profiles: normalizeProfiles(profiles),
    activeProfileId
  });
  setMessage('#saveMsg', '已保存');
}

async function applyAllowLan() {
  try {
    await saveOptions();
    const allowLan = $('#allowLan').checked;
    setMessage('#subMsg', allowLan ? '正在开启局域网访问...' : '正在关闭局域网访问...');
    const res = await sendRuntimeMessage({ type: 'MIHOMO_SET_ALLOW_LAN', allowLan, restart: true });
    if (!res || !res.ok) throw new Error((res && res.error) || '应用局域网开关失败');
    setMessage('#subMsg', allowLan ? '已开启局域网访问，配置已更新' : '已关闭局域网访问，配置已更新');
  } catch (error) {
    setMessage('#subMsg', `应用失败：${error.message}`, true);
  }
}

async function updateSubscription(restart) {
  try {
    await saveOptions();
    const active = getActiveSubscription();
    if (!active) throw new Error('请先添加一个订阅链接');
    setMessage('#subMsg', `${restart ? '正在更新并重启' : '正在更新'}：${active.name || active.url}`);
    const res = await sendRuntimeMessage({ type: 'MIHOMO_UPDATE_SUBSCRIPTION', restart });
    if (!res || !res.ok) throw new Error((res && res.error) || '更新订阅失败');
    await refreshSubscriptionInfo(active.id, { silentError: true });
    setMessage('#subMsg', res.message || '订阅已更新');
  } catch (error) {
    setMessage('#subMsg', `更新失败：${error.message}`, true);
  }
}

async function refreshActiveSubscriptionInfo() {
  const active = getActiveSubscription();
  if (!active) return setMessage('#subMsg', '请先添加一个订阅链接', true);
  await refreshSubscriptionInfo(active.id);
}

async function refreshAllSubscriptionInfo() {
  if (!subscriptions.length) return setMessage('#subMsg', '暂无订阅可识别', true);
  setMessage('#subMsg', `正在识别 ${subscriptions.length} 个订阅的流量信息...`);
  let success = 0;
  for (const item of subscriptions) {
    try {
      await refreshSubscriptionInfo(item.id, { silent: true });
      success += 1;
    } catch (_) {}
  }
  renderSubscriptions();
  await saveOptions();
  setMessage('#subMsg', `识别完成：${success}/${subscriptions.length}`);
}

async function refreshSubscriptionInfo(id, options = {}) {
  const item = subscriptions.find((sub) => sub.id === id);
  if (!item) return;
  if (!options.silent) setMessage('#subMsg', `正在识别：${item.name || item.url}`);

  try {
    const info = await fetchSubscriptionInfo(item.url);
    item.trafficInfo = info;
    renderSubscriptions();
    await saveOptions();
    if (!options.silent) setMessage('#subMsg', `识别成功：${formatTrafficInfo(info)}`);
  } catch (error) {
    if (!options.silentError && !options.silent) setMessage('#subMsg', `识别失败：${error.message}`, true);
    throw error;
  }
}

async function fetchSubscriptionInfo(url) {
  const res = await sendRuntimeMessage({ type: 'MIHOMO_GET_SUBSCRIPTION_INFO', url });
  if (!res || !res.ok) throw new Error((res && res.error) || '请求订阅信息失败');
  const raw = (res.data && res.data.userinfo) || '';
  const webPageUrl = (res.data && res.data.webPageUrl) || '';
  if (!raw) {
    throw new Error('订阅响应头没有 subscription-userinfo，无法识别剩余流量/到期时间');
  }

  const parsed = parseSubscriptionUserInfo(raw);
  return {
    ...parsed,
    raw,
    webPageUrl,
    updatedAt: Date.now()
  };
}

function parseSubscriptionUserInfo(raw) {
  const result = { upload: 0, download: 0, total: 0, expire: 0 };
  raw.split(';').forEach((part) => {
    const [key, value] = part.split('=').map((item) => item.trim());
    if (!key) return;
    const numeric = Number(value || 0);
    if (key === 'upload') result.upload = numeric;
    if (key === 'download') result.download = numeric;
    if (key === 'total') result.total = numeric;
    if (key === 'expire') result.expire = numeric;
  });
  return result;
}

function formatTrafficInfo(info) {
  if (!info) return '流量信息：未识别';
  const used = Number(info.upload || 0) + Number(info.download || 0);
  const total = Number(info.total || 0);
  const remaining = Math.max(total - used, 0);
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const expireText = info.expire ? formatDate(info.expire * 1000) : '未知';
  const updated = info.updatedAt ? formatDateTime(info.updatedAt) : '未知';
  return `已用 ${formatBytes(used)} / 总量 ${total ? formatBytes(total) : '未知'} / 剩余 ${total ? formatBytes(remaining) : '未知'} · ${percent}% · 到期 ${expireText} · 更新 ${updated}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(2)} ${units[index]}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleDateString('zh-CN');
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function refreshLog() {
  try {
    if (mihomoLogWs) { try { mihomoLogWs.close(); } catch (_) {} mihomoLogWs = null; }
    if (!logAutoRefresh) setMessage('#logStatus', '正在连接日志流...');
    const level = ($('#logLevelSelect') && $('#logLevelSelect').value) || 'info';
    mihomoLogWs = await getMihomoLog(level);
    mihomoLogWs.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        if (log && typeof log === 'object') {
          logRawText = `【${log.type}】${formatDateTime(new Date().getTime())} ${log.payload}\n${logRawText}`;
        }
      } catch (_) {}
      applyLogFilter();
    };
    mihomoLogWs.onerror = () => {
      setMessage('#logStatus', '日志连接断开', true);
    };
    setMessage('#logStatus', `日志流已连接（等级：${level.toUpperCase()}）`);
  } catch (e) {
    setMessage('#logStatus', `读取日志失败：${e.message || e}`, true);
    logRawText = '';
    $('#logViewer').value = '';
  }
}

function applyLogFilter() {
  const keyword = $('#logSearchInput').value.trim().toLowerCase();
  if (!keyword) {
    $('#logViewer').value = logRawText;
    $('#logSearchCount').textContent = '';
    return;
  }
  const lines = logRawText.split('\n');
  const matched = lines.filter((line) => line.toLowerCase().includes(keyword));
  $('#logViewer').value = matched.join('\n');
  $('#logSearchCount').textContent = `${matched.length}/${lines.length} 行匹配`;
}

function toggleAutoLog() {
  logAutoRefresh = !logAutoRefresh;
  const btn = $('#toggleAutoLogBtn');
  if (logAutoRefresh) {
    btn.textContent = '停止刷新';
    btn.classList.add('active');
    refreshLog();
  } else {
    if (mihomoLogWs) { try { mihomoLogWs.close(); } catch (_) {} mihomoLogWs = null; }
    btn.textContent = '自动刷新';
    btn.classList.remove('active');
    setMessage('#logStatus', '已停止刷新');
  }
}

function onLogLevelChange() {
  if (mihomoLogWs) {
    refreshLog();
  }
}

async function clearLogViewer() {
  $('#logViewer').value = '';
  $('#logSearchInput').value = '';
  $('#logSearchCount').textContent = '';
  logRawText = '';
}

async function testController() {
  try {
    await saveOptions();
    const version = await getClashVersion();
    setMessage('#testMsg', `连接成功：${(version && version.premium) ? 'Premium' : 'Core'} ${(version && version.version) || ''}`);
  } catch (error) {
    setMessage('#testMsg', `连接失败：${error.message}`, true);
  }
}

function setMessage(selector, message, error = false) {
  const el = $(selector);
  el.textContent = message;
  el.classList.toggle('error', error);
  if (!error && message) {
    setTimeout(() => {
      if (el.textContent === message) el.textContent = '';
    }, 2500);
  }
}
