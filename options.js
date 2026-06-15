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

init().catch((error) => setMessage('#saveMsg', error.message, true));

async function init() {
  const settings = await getSettings();
  subscriptions = normalizeSubscriptions(settings.subscriptions, settings.subscriptionUrl);
  activeSubscriptionId = settings.activeSubscriptionId || subscriptions[0]?.id || '';

  $('#proxyHost').value = settings.proxyHost;
  $('#proxyPort').value = settings.proxyPort;
  $('#proxyType').value = settings.proxyType;
  $('#bypassList').value = settings.bypassList;
  $('#controllerUrl').value = settings.controllerUrl;
  $('#controllerSecret').value = settings.controllerSecret;
  $('#updateSubscriptionBeforeStart').checked = settings.updateSubscriptionBeforeStart !== false;
  $('#allowLan').checked = Boolean(settings.allowLan);
  $('#pacRules').value = settings.pacRules.join('\n');
  renderSubscriptions();

  $('#saveBtn').addEventListener('click', saveOptions);
  $('#applyBtn').addEventListener('click', async () => {
    await saveOptions();
    const res = await sendRuntimeMessage({ type: 'APPLY_PROXY' });
    if (!res?.ok) throw new Error(res?.error || '应用失败');
    setMessage('#saveMsg', '已保存并应用');
  });
  $('#resetRulesBtn').addEventListener('click', () => {
    $('#pacRules').value = DEFAULT_RULES.join('\n');
  });
  $('#testBtn').addEventListener('click', testController);
  $('#addSubBtn').addEventListener('click', addSubscription);
  $('#updateSubBtn').addEventListener('click', () => updateSubscription(false));
  $('#updateSubRestartBtn').addEventListener('click', () => updateSubscription(true));
  $('#applyAllowLanBtn').addEventListener('click', applyAllowLan);
  $('#refreshActiveSubInfoBtn').addEventListener('click', refreshActiveSubscriptionInfo);
  $('#refreshAllSubInfoBtn').addEventListener('click', refreshAllSubscriptionInfo);
}

function normalizeSubscriptions(value, legacyUrl = '') {
  const list = Array.isArray(value) ? value : [];
  const normalized = list
    .map((item) => ({
      id: String(item?.id || createSubscriptionId()).trim(),
      name: String(item?.name || '').trim(),
      url: String(item?.url || '').trim(),
      remark: String(item?.remark || '').trim(),
      trafficInfo: normalizeTrafficInfo(item?.trafficInfo)
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
  const item = { id, name: name || `订阅 ${subscriptions.length + 1}`, url, remark, trafficInfo: old?.trafficInfo || null };
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
  if (activeSubscriptionId === id) activeSubscriptionId = subscriptions[0]?.id || '';
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

  const pacRules = $('#pacRules').value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const active = getActiveSubscription();
  await setSettings({
    proxyHost: $('#proxyHost').value.trim() || '127.0.0.1',
    proxyPort,
    proxyType: $('#proxyType').value,
    bypassList: $('#bypassList').value.trim(),
    controllerUrl: $('#controllerUrl').value.trim() || 'http://127.0.0.1:9090',
    controllerSecret: $('#controllerSecret').value,
    subscriptions,
    activeSubscriptionId: active?.id || '',
    subscriptionUrl: active?.url || '',
    updateSubscriptionBeforeStart: $('#updateSubscriptionBeforeStart').checked,
    allowLan: $('#allowLan').checked,
    pacRules
  });
  setMessage('#saveMsg', '已保存');
}

async function applyAllowLan() {
  try {
    await saveOptions();
    const allowLan = $('#allowLan').checked;
    setMessage('#subMsg', allowLan ? '正在开启局域网访问...' : '正在关闭局域网访问...');
    const res = await sendRuntimeMessage({ type: 'MIHOMO_SET_ALLOW_LAN', allowLan, restart: true });
    if (!res?.ok) throw new Error(res?.error || '应用局域网开关失败');
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
    if (!res?.ok) throw new Error(res?.error || '更新订阅失败');
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
  if (!res?.ok) throw new Error(res?.error || '请求订阅信息失败');
  const raw = res.data?.userinfo || '';
  const webPageUrl = res.data?.webPageUrl || '';
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

async function testController() {
  try {
    await saveOptions();
    const version = await getClashVersion();
    setMessage('#testMsg', `连接成功：${version?.premium ? 'Premium' : 'Core'} ${version?.version || ''}`);
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
