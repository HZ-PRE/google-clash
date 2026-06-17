const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let currentSettings = null;
let groups = [];
let allProxies = null;
let statsTimer = null;
let lastConnStats = null;
let wsMemoryUsage =null;

init().catch((error) => showControllerMessage(error.message, true));

async function init() {
  currentSettings = await getSettings();
  bindEvents();
  renderSettings(currentSettings);
  syncMihomoStatus();
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

  $('#vpnBtn').addEventListener('click', toStartVpn);
  $('#stopVpnBtn').addEventListener('click', toStopVpn);
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
  $('#speedTestAllBtn').addEventListener('click', speedTestAllGroups);
  $('#autoSelectAllBtn').addEventListener('click', autoSelectAllGroups);
  $('#profileSelect').addEventListener('change', onProfileChange);
}

function renderSettings(settings) {
  $('#enabled').checked = Boolean(settings.enabled);
  $('#allowLanBtn').textContent = settings.allowLan ? '局域网：开启' : '局域网：关闭';
  $$('.mode-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === settings.mode);
  });
  renderProfileSelect(settings);
}

function renderProfileSelect(settings) {
  const select = $('#profileSelect');
  select.innerHTML = '<option value="">-- 配置 Profile --</option>';
  const profiles = normalizeProfiles(settings.profiles);
  profiles.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === settings.activeProfileId) opt.selected = true;
    select.appendChild(opt);
  });
}

async function onProfileChange(e) {
  const id = e.target.value;
  if (!id) return;
  try {
    showControllerMessage('正在切换配置...');
    await loadProfile(id, currentSettings);
    currentSettings = await getSettings();
    renderSettings(currentSettings);
    await sendRuntimeMessage({ type: 'APPLY_PROXY' });
    showControllerMessage(`已切换到配置：${currentSettings.activeProfileId ? (normalizeProfiles(currentSettings.profiles).find(p => p.id === currentSettings.activeProfileId)?.name || '') : ''}`);
    await refreshGroups();
  } catch (error) {
    showControllerMessage(`切换配置失败：${error.message}`, true);
  }
}

async function refreshGroups() {
  try {
    groups = await getProxyGroups();
    try { allProxies = await getAllProxies(); } catch (_) { allProxies = null; }
    renderGroupCards();
    showControllerMessage(`${groups.length} 个代理组`);
  } catch (error) {
    groups = [];
    allProxies = null;
    renderGroupCards();
    showControllerMessage(`连接 Clash Controller 失败：${error.message}`, true);
  }
}

function renderGroupCards() {
  const section = $('#proxyGroupsList');
  section.innerHTML = '';

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'group-empty';
    empty.textContent = '未读取到代理组';
    section.appendChild(empty);
    return;
  }

  groups.forEach((group) => {
    const card = document.createElement('div');
    card.className = 'group-card';

    const head = document.createElement('div');
    head.className = 'group-head';

    const info = document.createElement('div');
    info.className = 'group-info';
    const title = document.createElement('strong');
    title.textContent = group.name;
    const current = document.createElement('small');
    current.id = `group-now-${escapeId(group.name)}`;
    updateGroupCurrentText(group, current);
    info.appendChild(title);
    info.appendChild(current);

    const actions = document.createElement('div');
    actions.className = 'group-head-actions';

    const speedBtn = document.createElement('button');
    speedBtn.className = 'ghost-btn';
    speedBtn.textContent = '测速';
    speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      speedTestGroup(group.name);
    });

    const autoBtn = document.createElement('button');
    autoBtn.className = 'ghost-btn auto-select-btn';
    autoBtn.textContent = '自动选优';
    autoBtn.title = '测速并自动选择最低延迟节点';
    autoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      autoSelectBestNode(group.name);
    });

    actions.appendChild(speedBtn);
    actions.appendChild(autoBtn);
    head.appendChild(info);
    head.appendChild(actions);

    const nodeList = document.createElement('div');
    nodeList.className = 'group-nodes';
    nodeList.id = `group-nodes-${escapeId(group.name)}`;
    renderGroupNodes(group, nodeList);

    card.appendChild(head);
    card.appendChild(nodeList);
    section.appendChild(card);
  });
}

function updateGroupCurrentText(group, el) {
  const node = group.now || 'N/A';
  const delay = getNodeDelay(group.name, node);
  const delayText = delay !== null ? ` · ${delay}ms` : '';
  el.textContent = `当前：${node}${delayText}`;
  el.dataset.node = node;
}

function getNodeDelay(groupName, nodeName) {
  if (!allProxies?.proxies) return null;
  const proxy = allProxies.proxies[nodeName];
  if (!proxy || !proxy.history || !proxy.history.length) return null;
  return proxy.history[proxy.history.length - 1].delay;
}

function renderGroupNodes(group, container) {
  container.innerHTML = '';
  if (!group.all || !group.all.length) {
    container.innerHTML = '<div class="node-item"><span class="node-name">无节点</span></div>';
    return;
  }

  const nodes = group.all.map((name) => ({ name, delay: getNodeDelay(group.name, name) }));
  nodes.sort((a, b) => {
    if (a.delay === null && b.delay === null) return 0;
    if (a.delay === null) return 1;
    if (b.delay === null) return -1;
    return a.delay - b.delay;
  });

  nodes.forEach(({ name, delay }) => {
    const row = document.createElement('div');
    row.className = 'node-item';
    if (group.now === name) row.classList.add('node-active');

    const dot = document.createElement('span');
    dot.className = 'node-dot';
    dot.classList.add(delayColor(delay));
    dot.textContent = '●';

    const nameEl = document.createElement('span');
    nameEl.className = 'node-name';
    nameEl.textContent = name;

    const delayEl = document.createElement('span');
    delayEl.className = 'node-delay';
    delayEl.textContent = delay !== null ? `${delay}ms` : '-';

    const switchBtn = document.createElement('button');
    switchBtn.className = 'node-switch-btn';
    switchBtn.textContent = group.now === name ? '当前' : '切换';
    switchBtn.disabled = group.now === name;
    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchNode(group.name, name);
    });

    row.appendChild(dot);
    row.appendChild(nameEl);
    row.appendChild(delayEl);
    row.appendChild(switchBtn);
    container.appendChild(row);
  });
}

function delayColor(ms) {
  if (ms === null) return 'delay-none';
  if (ms < 200) return 'delay-fast';
  if (ms < 500) return 'delay-mid';
  return 'delay-slow';
}

/* ── Speed test ── */

async function speedTestGroup(groupName) {
  showControllerMessage(`正在测速 ${groupName} ...`);
  try {
    await testProxyDelay(groupName);
    allProxies = await getAllProxies();
    const container = document.getElementById(`group-nodes-${escapeId(groupName)}`);
    const group = groups.find((g) => g.name === groupName);
    if (group && container) renderGroupNodes(group, container);
    const currentEl = document.getElementById(`group-now-${escapeId(groupName)}`);
    if (group && currentEl) updateGroupCurrentText(group, currentEl);
    showControllerMessage(`${groupName} 测速完成`);
  } catch (error) {
    showControllerMessage(`测速失败：${error.message}`, true);
  }
}

async function speedTestAllGroups() {
  if (!groups.length) return;
  showControllerMessage(`正在测速 ${groups.length} 个组...`);
  let done = 0;
  for (const group of groups) {
    try {
      await testProxyDelay(group.name);
      done++;
    } catch (_) {}
  }
  allProxies = await getAllProxies();
  renderGroupCards();
  showControllerMessage(`测速完成：${done}/${groups.length}`);
}

/* ── Auto select lowest delay ── */

async function autoSelectBestNode(groupName) {
  const group = groups.find((g) => g.name === groupName);
  if (!group || !group.all?.length) {
    showControllerMessage(`${groupName} 无可用节点`, true);
    return;
  }

  showControllerMessage(`${groupName} 测速中...`);
  try {
    await testProxyDelay(groupName);
  } catch (_) {
    // Some nodes may fail, continue with partial results
  }

  allProxies = await getAllProxies();
  const proxyData = allProxies?.proxies || {};

  let bestNode = null;
  let bestDelay = Infinity;

  for (const nodeName of group.all) {
    const proxy = proxyData[nodeName];
    if (!proxy || !proxy.history || !proxy.history.length) continue;
    const lastDelay = proxy.history[proxy.history.length - 1].delay;
    if (lastDelay > 0 && lastDelay < bestDelay) {
      bestDelay = lastDelay;
      bestNode = nodeName;
    }
  }

  if (!bestNode) {
    showControllerMessage(`${groupName} 无可用节点（全部超时）`, true);
    renderGroupCards();
    return;
  }

  try {
    await selectClashNode(groupName, bestNode);
    await refreshGroups();
    showControllerMessage(`${groupName} → ${bestNode} (${bestDelay}ms)`);
  } catch (error) {
    showControllerMessage(`自动选择失败：${error.message}`, true);
  }
}

async function autoSelectAllGroups() {
  if (!groups.length) return;
  showControllerMessage(`正在为 ${groups.length} 个组自动选优...`);
  let switched = 0;

  for (const group of groups) {
    try {
      await testProxyDelay(group.name);
    } catch (_) {}

    allProxies = await getAllProxies();
    const proxyData = allProxies?.proxies || {};

    let bestNode = null;
    let bestDelay = Infinity;

    for (const nodeName of group.all) {
      const proxy = proxyData[nodeName];
      if (!proxy || !proxy.history || !proxy.history.length) continue;
      const lastDelay = proxy.history[proxy.history.length - 1].delay;
      if (lastDelay > 0 && lastDelay < bestDelay) {
        bestDelay = lastDelay;
        bestNode = nodeName;
      }
    }

    if (bestNode && bestNode !== group.now) {
      try {
        await selectClashNode(group.name, bestNode);
        switched++;
      } catch (_) {}
    }
  }

  await refreshGroups();
  showControllerMessage(`自动选优完成，切换了 ${switched} 个组`);
}

async function switchNode(groupName, nodeName) {
  try {
    await selectClashNode(groupName, nodeName);
    await setSettings({ activeGroup: groupName });
    showControllerMessage(`已切换：${groupName} → ${nodeName}`);
    await refreshGroups();
  } catch (error) {
    showControllerMessage(`切换失败：${error.message}`, true);
  }
}

function escapeId(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
}

/* ── VPN controls ── */

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
function startVpnStatus() {
  startStatsPolling();
  if(!wsMemoryUsage) getWsMemoryUsage();
  refreshGroups();
}
function stopVpnStatus() {
  stopStatsPolling();
  if(wsMemoryUsage) {
    wsMemoryUsage.close();
    wsMemoryUsage = null;
  }
}
async function syncMihomoStatus() {
  try {
    const res = await sendRuntimeMessage({ type: 'MIHOMO_STATUS' });
    if (res?.running) {
      showVpnMessage(`Mihomo 运行中 · PID ${res.pid || ''}`);
      startVpnStatus();
    }else{
      showVpnMessage('Mihomo 未运行');
      stopVpnStatus();
    };
  } catch (error) {
    showVpnMessage('本地启动器未注册，需先运行 native-host\\install-native-host.bat', true);
  }
}

function setVpnBusy(busy) {
  $('#vpnBtn').disabled = busy;
  $('#stopVpnBtn').disabled = busy;
}
function toStopVpn(){
  stopVpn();
  stopVpnStatus();
}
function toStartVpn(){
  startVpn();
  startVpnStatus();
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

function updateStatus() {
  const dot = $('#statusDot');
  const title = $('#statusTitle');
  const text = $('#statusText');
  const settings = currentSettings;
  dot.classList.toggle('on', settings.enabled && settings.mode !== 'direct');
  title.textContent = settings.enabled && settings.mode !== 'direct' ? '浏览器代理已启用' : '浏览器直连';
  text.textContent = '块垒加速器';
}

function showControllerMessage(message, error = false) {
  const el = $('#controllerMsg');
  el.textContent = message;
  el.classList.toggle('error', error);
}

/* ── Bandwidth & Memory stats ── */
async function getWsMemoryUsage() {
  const el3 = $('#statMemory');
  if (!el3) return;
  try {
    wsMemoryUsage =await getMemory((mem) => {
      if (mem) {
        const inuse = Number(mem.inuse || 0);
        const oslimit = Number(mem.oslimit || 0);
        el3.textContent = oslimit ? `${formatBytes(inuse)} / ${formatBytes(oslimit)}` : formatBytes(inuse);
      } else {
        el3.textContent = 'N/A';
      }
    });
  } catch (e) {
    el3.textContent = 'N/A';
  }
}
function startStatsPolling() {
  stopStatsPolling();
  pollStats();
}

function stopStatsPolling() {
  if (statsTimer) { clearTimeout(statsTimer); statsTimer = null; }
}
async function pollStats() {
  try {
    let conn = null;
    let connError = null;

    try {
      conn = await getConnections();
    } catch (e) {
      connError = e;
    }

    let upload, download, totalUp, totalDown, conns;

    if (connError) {
      upload = 'N/A';
      download = 'N/A';
      conns = '-';
      const reason = String(connError?.message || connError).split('\n')[0];
      totalUp = reason.slice(0, 30);
      totalDown = '';
      lastConnStats = null;
    } else {
      const now = Date.now();
      const tUp = Number(conn?.uploadTotal ?? conn?.totalUpload ?? 0);
      const tDown = Number(conn?.downloadTotal ?? conn?.totalDownload ?? 0);
      const connCount = Array.isArray(conn?.connections) ? conn.connections.length : 0;

      if (lastConnStats) {
        const dt = Math.max((now - lastConnStats.time) / 1000, 0.1);
        const upSpeed = Math.max(0, (tUp - lastConnStats.totalUp) / dt);
        const downSpeed = Math.max(0, (tDown - lastConnStats.totalDown) / dt);
        upload = formatRate(upSpeed);
        download = formatRate(downSpeed);
      } else {
        upload = '0 B/s';
        download = '0 B/s';
      }
      lastConnStats = { totalUp: tUp, totalDown: tDown, time: now };

      totalUp = formatBytes(tUp);
      totalDown = formatBytes(tDown);
      conns = String(connCount);
    }

    const el = $('#statUpload'); if (el) el.textContent = upload;
    const el2 = $('#statDownload'); if (el2) el2.textContent = download;
    const el4 = $('#statTotalUp'); if (el4) el4.textContent = totalUp;
    const el5 = $('#statTotalDown'); if (el5) el5.textContent = totalDown;
    const el6 = $('#statConns'); if (el6) el6.textContent = conns;
  } finally {
    statsTimer = setTimeout(pollStats, 2000);
  }
}

function formatRate(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}
