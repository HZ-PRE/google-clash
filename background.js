const DEFAULT_SETTINGS = {
  enabled: false,
  mode: 'rule',
  proxyType: 'mixed',
  proxyHost: '127.0.0.1',
  proxyPort: 7890,
  bypassList: '<local>,localhost,127.0.0.1,::1,*.lan,*.local',
  pacRules: [
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
  ],
  controllerUrl: 'http://127.0.0.1:9090',
  controllerSecret: '',
  activeGroup: 'GLOBAL',
  subscriptionUrl: '',
  subscriptions: [],
  activeSubscriptionId: '',
  updateSubscriptionBeforeStart: true,
  allowLan: false,
  nativeHostName: 'com.clash_switchboard.mihomo',
  profiles: [],
  activeProfileId: ''
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...current });
  await applyProxyFromStorage();
});

chrome.runtime.onStartup.addListener(async () => {
  await applyProxyFromStorage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const proxyKeys = ['enabled', 'mode', 'proxyType', 'proxyHost', 'proxyPort', 'bypassList', 'pacRules'];
  if (proxyKeys.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) {
    applyProxyFromStorage();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === 'APPLY_PROXY') {
        await applyProxyFromStorage();
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === 'CLEAR_PROXY') {
        await clearProxy();
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === 'GET_PROXY_STATE') {
        const state = await getProxyState();
        sendResponse({ ok: true, state });
        return;
      }
      if (message?.type === 'MIHOMO_START') {
        const result = await startVpn();
        sendResponse({ ok: true, ...result });
        return;
      }
      if (message?.type === 'MIHOMO_STOP') {
        const result = await stopVpn();
        sendResponse({ ok: true, ...result });
        return;
      }
      if (message?.type === 'MIHOMO_STATUS') {
        const result = await nativeMihomoMessage({ type: 'status' });
        sendResponse({ ok: true, ...result });
        return;
      }
      if (message?.type === 'MIHOMO_UPDATE_SUBSCRIPTION') {
        const result = await updateSubscription(Boolean(message.restart));
        sendResponse({ ok: true, ...result });
        return;
      }
      if (message?.type === 'MIHOMO_GET_SUBSCRIPTION_INFO') {
        const result = await nativeMihomoMessage({ type: 'getSubscriptionInfo', url: message.url });
        sendResponse({ ok: true, ...result });
        return;
      }
      if (message?.type === 'MIHOMO_SET_ALLOW_LAN') {
        const result = await setAllowLan(Boolean(message.allowLan), Boolean(message.restart));
        sendResponse({ ok: true, ...result });
        return;
      }
      if (message?.type === 'MIHOMO_GET_LOG') {
        const result = await nativeMihomoMessage({ type: 'getLog' });
        sendResponse({ ok: true, ...result });
        return;
      }
      sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
  })();
  return true;
});

async function applyProxyFromStorage() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.enabled || settings.mode === 'direct') {
    await clearProxy();
    await updateBadge(false, settings.mode);
    return;
  }

  const config = buildChromeProxyConfig(settings);
  await chrome.proxy.settings.set({ value: config, scope: 'regular' });
  await updateBadge(true, settings.mode);
}

async function clearProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  await updateBadge(false, 'direct');
}

function buildChromeProxyConfig(settings) {
  if (settings.mode === 'global') {
    return buildGlobalProxyConfig(settings);
  }
  if (settings.mode === 'rule') {
    return buildPacProxyConfig(settings);
  }
  return { mode: 'direct' };
}

function buildGlobalProxyConfig(settings) {
  const scheme = proxyScheme(settings.proxyType);
  const bypassList = parseBypassList(settings.bypassList);
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme,
        host: settings.proxyHost,
        port: Number(settings.proxyPort)
      },
      bypassList
    }
  };
}

function buildPacProxyConfig(settings) {
  const scheme = proxyScheme(settings.proxyType);
  const host = String(settings.proxyHost || '127.0.0.1');
  const port = Number(settings.proxyPort || 7890);
  const proxy = `${scheme.toUpperCase()} ${host}:${port}`;
  const rules = Array.isArray(settings.pacRules) ? settings.pacRules : DEFAULT_SETTINGS.pacRules;
  return {
    mode: 'pac_script',
    pacScript: {
      data: generatePacScript(proxy, rules)
    }
  };
}

function proxyScheme(type) {
  if (type === 'socks5') return 'socks5';
  if (type === 'http') return 'http';
  return 'http';
}

function parseBypassList(input) {
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function generatePacScript(proxy, ruleLines) {
  const parsed = ruleLines
    .map((line) => parseRuleLine(line))
    .filter(Boolean);

  const domainSuffixes = parsed.filter((r) => r.type === 'DOMAIN-SUFFIX');
  const domains = parsed.filter((r) => r.type === 'DOMAIN');
  const keywords = parsed.filter((r) => r.type === 'DOMAIN-KEYWORD');
  const ipCidrs = parsed.filter((r) => r.type === 'IP-CIDR');
  const match = [...parsed].reverse().find((r) => r.type === 'MATCH');

  return `
function FindProxyForURL(url, host) {
  var PROXY = ${JSON.stringify(proxy)};
  var DIRECT = 'DIRECT';
  host = host.toLowerCase();

  if (isPlainHostName(host) || host === 'localhost' || host === '127.0.0.1' || host === '::1') return DIRECT;
  if (dnsDomainIs(host, '.local') || dnsDomainIs(host, '.lan')) return DIRECT;

  var domains = ${JSON.stringify(domains)};
  for (var i = 0; i < domains.length; i++) {
    if (host === domains[i].value) return domains[i].action === 'PROXY' ? PROXY : DIRECT;
  }

  var suffixes = ${JSON.stringify(domainSuffixes)};
  for (var j = 0; j < suffixes.length; j++) {
    var suffix = suffixes[j].value;
    if (host === suffix || dnsDomainIs(host, '.' + suffix)) return suffixes[j].action === 'PROXY' ? PROXY : DIRECT;
  }

  var keywords = ${JSON.stringify(keywords)};
  for (var k = 0; k < keywords.length; k++) {
    if (host.indexOf(keywords[k].value) !== -1) return keywords[k].action === 'PROXY' ? PROXY : DIRECT;
  }

  var ipCidrs = ${JSON.stringify(ipCidrs)};
  var resolved = null;
  for (var c = 0; c < ipCidrs.length; c++) {
    if (!resolved) resolved = dnsResolve(host);
    if (resolved && isInNet(resolved, ipCidrs[c].ip, ipCidrs[c].mask)) {
      return ipCidrs[c].action === 'PROXY' ? PROXY : DIRECT;
    }
  }

  return ${JSON.stringify(match?.action === 'PROXY' ? 'PROXY' : 'DIRECT')} === 'PROXY' ? PROXY : DIRECT;
}
`.trim();
}

function parseRuleLine(line) {
  const clean = String(line || '').trim();
  if (!clean || clean.startsWith('#')) return null;
  const parts = clean.split(',').map((part) => part.trim());
  const type = parts[0]?.toUpperCase();
  const value = parts[1] || '';
  const action = (parts[2] || parts[1] || 'DIRECT').toUpperCase() === 'PROXY' ? 'PROXY' : 'DIRECT';

  if (type === 'MATCH') return { type: 'MATCH', action: value.toUpperCase() === 'PROXY' ? 'PROXY' : 'DIRECT' };
  if (type === 'GEOIP') return null;
  if (type === 'DOMAIN-SUFFIX' || type === 'DOMAIN' || type === 'DOMAIN-KEYWORD') return { type, value: value.toLowerCase(), action };
  if (type === 'IP-CIDR') {
    const [ip, bits] = value.split('/');
    return { type, ip, mask: cidrToMask(Number(bits)), action };
  }
  return null;
}

function cidrToMask(bits) {
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return '255.255.255.255';
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255).join('.');
}

async function updateBadge(enabled, mode) {
  await chrome.action.setBadgeText({ text: enabled ? mode.slice(0, 1).toUpperCase() : '' });
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#12b981' : '#64748b' });
}

async function getProxyState() {
  return new Promise((resolve) => {
    chrome.proxy.settings.get({ incognito: false }, (details) => resolve(details));
  });
}

async function nativeMihomoMessage(payload) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(settings.nativeHostName, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error([
          `无法连接本地启动器：${chrome.runtime.lastError.message}`,
          '请先执行 native-host\\install-native-host.bat 注册 Native Host，并重新加载插件。'
        ].join('\n')));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || '本地启动器返回失败'));
        return;
      }
      resolve(response);
    });
  });
}

function getActiveSubscriptionUrl(settings) {
  const subscriptions = normalizeSubscriptions(settings.subscriptions, settings.subscriptionUrl);
  const active = subscriptions.find((item) => item.id === settings.activeSubscriptionId) || subscriptions[0];
  return active?.url || settings.subscriptionUrl || '';
}

function normalizeSubscriptions(subscriptions, legacyUrl = '') {
  const list = Array.isArray(subscriptions) ? subscriptions : [];
  const normalized = list
    .map((item) => ({
      id: String(item?.id || '').trim(),
      name: String(item?.name || '').trim(),
      url: String(item?.url || '').trim(),
      remark: String(item?.remark || '').trim()
    }))
    .filter((item) => item.url);
  if (!normalized.length && legacyUrl) {
    normalized.push({ id: 'legacy-subscription', name: '默认订阅', url: String(legacyUrl).trim(), remark: '' });
  }
  return normalized;
}

function extractControllerAddress(url) {
  const match = String(url || '').match(/^https?:\/\/(.+?)(?:\/.*)?$/i);
  return match ? match[1] : '127.0.0.1:9090';
}

async function startVpn() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const subscriptionUrl = getActiveSubscriptionUrl(settings);
  const controller = extractControllerAddress(settings.controllerUrl);
  if (settings.updateSubscriptionBeforeStart && subscriptionUrl) {
    await nativeMihomoMessage({ type: 'updateSubscription', url: subscriptionUrl, allowLan: Boolean(settings.allowLan), proxyPort: Number(settings.proxyPort || 7890), controller });
  }
  const result = await nativeMihomoMessage({ type: 'start' });
  await waitForControllerReady(12000);
  await chrome.storage.local.set({ enabled: true, mode: 'rule', proxyHost: '127.0.0.1', proxyPort: 7890, proxyType: 'mixed' });
  await applyProxyFromStorage();
  await updateBadge(true, 'rule');
  return { ...result, message: result.message || 'VPN 已启动' };
}

async function updateSubscription(restartAfterUpdate = false) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const subscriptionUrl = getActiveSubscriptionUrl(settings);
  if (!subscriptionUrl) throw new Error('请先在高级设置里添加并启用一个订阅链接');
  const wasRunning = await nativeMihomoMessage({ type: 'status' }).catch(() => ({ running: false }));
  const controller = extractControllerAddress(settings.controllerUrl);
  const result = await nativeMihomoMessage({ type: 'updateSubscription', url: subscriptionUrl, allowLan: Boolean(settings.allowLan), proxyPort: Number(settings.proxyPort || 7890), controller });
  if (restartAfterUpdate && wasRunning?.running) {
    await nativeMihomoMessage({ type: 'restart' });
    await waitForControllerReady(12000);
  }
  return result;
}

async function setAllowLan(allowLan, restartAfterChange = false) {
  const wasRunning = await nativeMihomoMessage({ type: 'status' }).catch(() => ({ running: false }));
  await chrome.storage.local.set({ allowLan });
  const result = await nativeMihomoMessage({ type: 'setAllowLan', allowLan });
  if (restartAfterChange && wasRunning?.running) {
    await nativeMihomoMessage({ type: 'restart' });
    await waitForControllerReady(12000);
  }
  return result;
}

async function stopVpn() {
  let result = { ok: true, message: '未调用本地停止' };
  try {
    result = await nativeMihomoMessage({ type: 'stop' });
  } finally {
    await chrome.storage.local.set({ enabled: false, mode: 'direct' });
    await clearProxy();
  }
  return { ...result, message: result.message || 'VPN 已停止' };
}

async function waitForControllerReady(timeoutMs) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const base = String(settings.controllerUrl || 'http://127.0.0.1:9090').replace(/\/+$/, '');
  const headers = {};
  if (settings.controllerSecret) headers.Authorization = `Bearer ${settings.controllerSecret}`;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/version`, { headers, cache: 'no-store' });
      if (response.ok) return true;
      lastError = new Error(`Controller HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  throw new Error([
    'Mihomo 已尝试启动，但 External Controller 未就绪。',
    `检测地址：${base}/version`,
    `最后错误：${lastError?.message || 'unknown'}`,
    '请确认 core\\config.yaml 里包含 external-controller: 127.0.0.1:9090，并查看 core\\mihomo.log。'
  ].join('\n'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
