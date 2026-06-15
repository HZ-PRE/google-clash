const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let currentSettings = null;
let groups = [];

init().catch((error) => showControllerMessage(error.message, true));

async function init() {
  currentSettings = await getSettings();
  bindEvents();
  renderSettings(currentSettings);
  await syncMihomoStatus();
  await refreshGroups();
  updateStatus();
}

function bindEvents() {
  $('#enabled').addEventListener('change', async (event) => {
    await setSettings({ enabled: event.target.checked });
    currentSettings = await getSettings();
    updateStatus();
  });

  $$('.mode-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const mode = button.dataset.mode;
      const enabled = mode !== 'direct';
      await setSettings({ mode, enabled });
      currentSettings = await getSettings();
      renderSettings(currentSettings);
      updateStatus();
    });
  });

  ['proxyType', 'proxyHost', 'proxyPort'].forEach((id) => {
    $(`#${id}`).addEventListener('change', saveQuickSettings);
    $(`#${id}`).addEventListener('input', debounce(saveQuickSettings, 500));
  });

  $('#vpnBtn').addEventListener('click', startVpn);
  $('#stopVpnBtn').addEventListener('click', stopVpn);
  $('#refreshBtn').addEventListener('click', refreshGroups);
  $('#groupSelect').addEventListener('change', async () => {
    await setSettings({ activeGroup: $('#groupSelect').value });
    renderNodesForGroup($('#groupSelect').value);
  });
  $('#switchNodeBtn').addEventListener('click', switchNode);
  $('#updateSubPopupBtn').addEventListener('click', updateSubscriptionFromPopup);
  $('#allowLanBtn').addEventListener('click', toggleAllowLan);
  $('#optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#clearBtn').addEventListener('click', async () => {
    await setSettings({ enabled: false, mode: 'direct' });
    await sendRuntimeMessage({ type: 'CLEAR_PROXY' });
    currentSettings = await getSettings();
    renderSettings(currentSettings);
    updateStatus();
  });
}

function renderSettings(settings) {
  $('#enabled').checked = Boolean(settings.enabled);
  $('#proxyType').value = settings.proxyType;
  $('#proxyHost').value = settings.proxyHost;
  $('#proxyPort').value = settings.proxyPort;
  $('#allowLanBtn').textContent = settings.allowLan ? '局域网：开启' : '局域网：关闭';


  $$('.mode-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === settings.mode);
  });
}

async function saveQuickSettings() {
  const patch = {
    proxyType: $('#proxyType').value,
    proxyHost: $('#proxyHost').value.trim() || '127.0.0.1',
    proxyPort: Number($('#proxyPort').value || 7890)
  };
  await setSettings(patch);
  currentSettings = await getSettings();
  updateStatus();
}

async function refreshGroups() {
  try {
    showControllerMessage('正在读取 Clash 代理组...');
    groups = await getProxyGroups();
    renderGroups();
    showControllerMessage(`已读取 ${groups.length} 个代理组`);
  } catch (error) {
    groups = [];
    renderGroups();
    showControllerMessage(`连接 Clash Controller 失败：${error.message}`, true);
  }
}

function renderGroups() {
  const groupSelect = $('#groupSelect');
  groupSelect.innerHTML = '';
  if (!groups.length) {
    groupSelect.append(new Option('未读取到代理组', ''));
    $('#nodeSelect').innerHTML = '';
    $('#nodeSelect').append(new Option('无节点', ''));
    return;
  }

  groups.forEach((group) => groupSelect.append(new Option(group.name, group.name)));
  const preferred = currentSettings?.activeGroup;
  if (preferred && groups.some((group) => group.name === preferred)) groupSelect.value = preferred;
  renderNodesForGroup(groupSelect.value);
}

function renderNodesForGroup(groupName) {
  const nodeSelect = $('#nodeSelect');
  nodeSelect.innerHTML = '';
  const group = groups.find((item) => item.name === groupName);
  if (!group) {
    nodeSelect.append(new Option('无节点', ''));
    return;
  }
  group.all.forEach((node) => nodeSelect.append(new Option(node, node)));
  if (group.now && group.all.includes(group.now)) nodeSelect.value = group.now;
}

async function startVpn() {
  setVpnBusy(true);
  showVpnMessage('正在启动 Mihomo 并应用浏览器代理...');
  try {
    const res = await sendRuntimeMessage({ type: 'MIHOMO_START' });
    if (!res?.ok) throw new Error(res?.error || '启动失败');
    currentSettings = await getSettings();
    renderSettings(currentSettings);
    updateStatus();
    showVpnMessage(`${res.message || 'VPN 已启动'}${res.pid ? ` · PID ${res.pid}` : ''}`);
    await refreshGroups();
  } catch (error) {
    showVpnMessage(`启动失败：${error.message}`, true);
  } finally {
    setVpnBusy(false);
  }
}

async function stopVpn() {
  setVpnBusy(true);
  showVpnMessage('正在停止 Mihomo 并清除浏览器代理...');
  try {
    const res = await sendRuntimeMessage({ type: 'MIHOMO_STOP' });
    if (!res?.ok) throw new Error(res?.error || '停止失败');
    currentSettings = await getSettings();
    renderSettings(currentSettings);
    updateStatus();
    showVpnMessage(res.message || 'VPN 已停止');
  } catch (error) {
    showVpnMessage(`停止失败：${error.message}`, true);
  } finally {
    setVpnBusy(false);
  }
}

async function syncMihomoStatus() {
  try {
    const res = await sendRuntimeMessage({ type: 'MIHOMO_STATUS' });
    if (res?.running) showVpnMessage(`Mihomo 运行中 · PID ${res.pid || ''}`);
    else showVpnMessage('Mihomo 未运行');
  } catch (error) {
    showVpnMessage('本地启动器未注册，需先运行 native-host\\install-native-host.bat', true);
  }
}

function setVpnBusy(busy) {
  $('#vpnBtn').disabled = busy;
  $('#stopVpnBtn').disabled = busy;
}

function showVpnMessage(message, error = false) {
  const el = $('#vpnMsg');
  el.textContent = message;
  el.classList.toggle('error', error);
}

async function toggleAllowLan() {
  const next = !currentSettings.allowLan;
  showControllerMessage(next ? '正在开启局域网访问...' : '正在关闭局域网访问...');
  try {
    const res = await sendRuntimeMessage({ type: 'MIHOMO_SET_ALLOW_LAN', allowLan: next, restart: true });
    if (!res?.ok) throw new Error(res?.error || '设置失败');
    currentSettings = await getSettings();
    renderSettings(currentSettings);
    showControllerMessage(next ? '已开启局域网访问' : '已关闭局域网访问');
  } catch (error) {
    showControllerMessage(`局域网设置失败：${error.message}`, true);
  }
}

async function updateSubscriptionFromPopup() {
  try {
    showControllerMessage('正在更新订阅...');
    const res = await sendRuntimeMessage({ type: 'MIHOMO_UPDATE_SUBSCRIPTION', restart: true });
    if (!res?.ok) throw new Error(res?.error || '更新失败');
    showControllerMessage(res.message || '订阅已更新');
    await refreshGroups();
  } catch (error) {
    showControllerMessage(`更新订阅失败：${error.message}`, true);
  }
}

async function switchNode() {
  const group = $('#groupSelect').value;
  const node = $('#nodeSelect').value;
  if (!group || !node) return showControllerMessage('请选择代理组和节点', true);
  try {
    await selectClashNode(group, node);
    await setSettings({ activeGroup: group });
    showControllerMessage(`已切换：${group} → ${node}`);
    await refreshGroups();
  } catch (error) {
    showControllerMessage(`切换失败：${error.message}`, true);
  }
}

function updateStatus() {
  const dot = $('#statusDot');
  const title = $('#statusTitle');
  const text = $('#statusText');
  const settings = currentSettings;
  dot.classList.toggle('on', settings.enabled && settings.mode !== 'direct');
  title.textContent = settings.enabled && settings.mode !== 'direct' ? '浏览器代理已启用' : '浏览器直连';
  text.textContent = settings.enabled && settings.mode !== 'direct'
    ? `${settings.mode.toUpperCase()} · ${settings.proxyType}://${settings.proxyHost}:${settings.proxyPort}`
    : 'Chrome 未使用插件代理';
}

function showControllerMessage(message, error = false) {
  const el = $('#controllerMsg');
  el.textContent = message;
  el.classList.toggle('error', error);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
