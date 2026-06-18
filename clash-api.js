
function chromeStorageGet(defaults) {
  return new Promise(function(resolve, reject) {
    chrome.storage.local.get(defaults, function(result) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result || {});
    });
  });
}

function chromeStorageSet(value) {
  return new Promise(function(resolve, reject) {
    chrome.storage.local.set(value, function() {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function chromeRuntimeSendMessage(message) {
  return new Promise(function(resolve, reject) {
    chrome.runtime.sendMessage(message, function(response) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function fetchWithTimeout(url, options, timeout) {
  options = options || {};
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    const timer = setTimeout(function() { controller.abort(); }, timeout);
    const requestOptions = Object.assign({}, options, { signal: controller.signal });
    return fetch(url, requestOptions).then(function(response) {
      clearTimeout(timer);
      return response;
    }, function(error) {
      clearTimeout(timer);
      throw error;
    });
  }

  let timer = null;
  return Promise.race([
    fetch(url, options).then(function(response) {
      if (timer) clearTimeout(timer);
      return response;
    }, function(error) {
      if (timer) clearTimeout(timer);
      throw error;
    }),
    new Promise(function(_, reject) {
      timer = setTimeout(function() { reject(new Error('Request timeout after ' + timeout + 'ms: ' + url)); }, timeout);
    })
  ]);
}

async function getSettings() {
  const defaults = {
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
  return chromeStorageGet(defaults);
}

async function setSettings(patch) {
  await chromeStorageSet(patch);
}

function normalizeControllerUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function clashHeaders(secret) {
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

function formatClashError(status, text, statusText, path, base) {
  const detail = text || statusText;
  if (status === 400) {
    try {
      const body = JSON.parse(text);
      if (body.message === 'Body invalid') {
        return `Clash API 400: Body invalid — 请求格式不正确 (${path})`;
      }
    } catch (_) {}
  }
  if (status === 400 && path === '/version') {
    return [
      `Clash API 400: ${detail || 'Bad Request'}`,
      '请确认 External Controller URL 填的是 Clash 控制端口，不是代理端口。',
      `当前地址：${base || '(空)'}`,
      '常见配置：external-controller: 127.0.0.1:9090，对应填写 http://127.0.0.1:9090；不要填写 mixed-port/port/socks-port（如 7890/7891）。'
    ].join('\n');
  }
  return `Clash API ${status}: ${detail || statusText}`;
}

function formatNetworkError(error, base, path) {
  return [
    `无法连接 Clash External Controller：${(error && error.message) || 'Failed to fetch'}`,
    `请求地址：${base || '(空)'}${path}`,
    '请检查：',
    '1. Clash / Mihomo 内核是否正在运行；',
    '2. Clash 配置里是否启用了 external-controller，例如 external-controller: 127.0.0.1:9090；',
    '3. 插件里的 External Controller URL 是否填写为 http://127.0.0.1:9090，而不是代理端口 http://127.0.0.1:7890；',
    '4. 如果 Clash 不在本机，manifest.json 需要加入对应地址的 host_permissions，并且 controller 要允许外部访问；',
    '5. 如果你修改了插件代码或 manifest.json，请到 chrome://extensions 重新加载插件。'
  ].join('\n');
}

async function clashFetch(path, options = {}, timeout = 10000) {
  const settings = await getSettings();
  const base = normalizeControllerUrl(settings.controllerUrl);

  let response;

  try {
    response = await fetchWithTimeout(`${base}${path}`, Object.assign({}, options, {
      headers: Object.assign({}, clashHeaders(settings.controllerSecret), options.headers || {})
    }), timeout);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms: ${base}${path}`);
    }

    throw new Error(formatNetworkError(error, base, path));
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      formatClashError(
        response.status,
        text,
        response.statusText,
        path,
        base
      )
    );
  }

  if (response.status === 204) return null;

  return response.json();
}

async function getClashVersion() {
  return clashFetch('/version');
}

async function testProxyDelay(proxyName) {
  const url = 'http://www.gstatic.com/generate_204';
  const timeout = 5000;
  return clashFetch(`/proxies/${encodeURIComponent(proxyName)}/delay?url=${encodeURIComponent(url)}&timeout=${timeout}`);
}

async function testProxyDelayWithUrl(proxyName, testUrl, timeout) {
  testUrl = testUrl || 'http://www.gstatic.com/generate_204';
  timeout = timeout || 5000;
  return clashFetch(`/proxies/${encodeURIComponent(proxyName)}/delay?url=${encodeURIComponent(testUrl)}&timeout=${timeout}`);
}

async function getAllProxies() {
  return clashFetch('/proxies');
}

async function getConnections() {
  return clashFetch('/connections');
}

async function getMemory(call) {
  const settings = await getSettings();
  const base = normalizeControllerUrl(settings.controllerUrl);
  const wsUrl = `${base.replace('http', 'ws')}/memory`;
  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    call(null);
    return;
  }
  ws.onmessage = (event) => {
    try { call(JSON.parse(event.data)); } catch (_) {}
  };
  ws.onerror = () => { call(null); };
  return ws;
}

async function getMihomoLog(level) {
  const settings = await getSettings();
  const base = normalizeControllerUrl(settings.controllerUrl);
  const query = level ? `?level=${level}` : '';
  return new WebSocket(`${base.replace('http', 'ws')}/logs${query}`);
}

async function getProxyGroups() {
  const data = await clashFetch('/proxies');
  const proxies = (data && data.proxies) || {};

  const groups = Object.values(proxies)
    .filter((proxy) => Array.isArray(proxy.all) && proxy.all.length > 0);

  // Try to get config.yaml proxy-groups order via native host
  try {
    const res = await sendRuntimeMessage({ type: 'MIHOMO_GET_CONFIG' });
    if (res && res.ok && Array.isArray(res.proxyGroups) && res.proxyGroups.length) {
      const orderMap = new Map(res.proxyGroups.map((name, i) => [name, i]));
      groups.sort((a, b) => {
        const ia = orderMap.get(a.name);
        const ib = orderMap.get(b.name);
        if (ia !== undefined && ib !== undefined) return ia - ib;
        if (ia !== undefined) return -1;
        if (ib !== undefined) return 1;
        return 0;
      });
    }
  } catch (_) {}

  return groups;
}

async function selectClashNode(groupName, nodeName) {
  return clashFetch(`/proxies/${encodeURIComponent(groupName)}`, {
    method: 'PUT',
    body: JSON.stringify({ name: nodeName })
  });
}

async function sendRuntimeMessage(message) {
  return chromeRuntimeSendMessage(message);
}

/* ── Profile helpers ── */

function createProfileId() {
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeProfiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      id: String((item && item.id) || createProfileId()).trim(),
      name: String((item && item.name) || '').trim(),
      mode: String((item && item.mode) || 'rule'),
      proxyType: String((item && item.proxyType) || 'mixed'),
      proxyHost: String((item && item.proxyHost) || '127.0.0.1'),
      proxyPort: Number((item && item.proxyPort) || 7890),
      bypassList: String((item && item.bypassList) || ''),
      pacRules: Array.isArray((item && item.pacRules)) ? item.pacRules : [],
      controllerUrl: String((item && item.controllerUrl) || 'http://127.0.0.1:9090'),
      controllerSecret: String((item && item.controllerSecret) || ''),
      activeGroup: String((item && item.activeGroup) || 'GLOBAL'),
      allowLan: Boolean((item && item.allowLan)),
      activeSubscriptionId: String((item && item.activeSubscriptionId) || '')
    }))
    .filter((item) => item.name);
}

function captureCurrentProfile(settings) {
  return {
    mode: settings.mode,
    proxyType: settings.proxyType,
    proxyHost: settings.proxyHost,
    proxyPort: settings.proxyPort,
    bypassList: settings.bypassList,
    pacRules: settings.pacRules,
    controllerUrl: settings.controllerUrl,
    controllerSecret: settings.controllerSecret,
    activeGroup: settings.activeGroup,
    allowLan: settings.allowLan,
    activeSubscriptionId: settings.activeSubscriptionId
  };
}

async function saveAsProfile(name, settings) {
  const profiles = normalizeProfiles(settings.profiles);
  const id = createProfileId();
  profiles.push(Object.assign({ id: id, name: name }, captureCurrentProfile(settings))); 
  await setSettings({ profiles, activeProfileId: id });
  return id;
}

async function loadProfile(profileId, settings) {
  const profiles = normalizeProfiles(settings.profiles);
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error('配置不存在');
  const patch = Object.assign({}, captureCurrentProfile(profile), { activeProfileId: profileId });
  await setSettings(patch);
  return profile;
}

async function deleteProfile(profileId, settings) {
  const profiles = normalizeProfiles(settings.profiles).filter((p) => p.id !== profileId);
  const activeProfileId = settings.activeProfileId === profileId ? ((profiles[0] && profiles[0].id) || '') : settings.activeProfileId;
  await setSettings({ profiles, activeProfileId });
}

async function updateProfile(profileId, settings) {
  const profiles = normalizeProfiles(settings.profiles);
  const index = profiles.findIndex((p) => p.id === profileId);
  if (index < 0) throw new Error('配置不存在');
  profiles[index] = Object.assign({}, profiles[index], captureCurrentProfile(settings));
  await setSettings({ profiles });
}
