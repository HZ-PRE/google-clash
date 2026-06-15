const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const CORE_PATH = path.join(APP_ROOT, 'core', 'nb-mihomo.exe');
const CONFIG_DIR = path.join(APP_ROOT, 'core');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.yaml');
const PID_PATH = path.join(CONFIG_DIR, 'mihomo.pid');
const LOG_PATH = path.join(CONFIG_DIR, 'mihomo.log');

function ensureDefaultConfig() {
  if (fs.existsSync(CONFIG_PATH)) return;
  const content = [
    'mixed-port: 7890',
    'allow-lan: false',
    'mode: rule',
    'log-level: info',
    'external-controller: 127.0.0.1:9090',
    'secret: ""',
    '',
    'proxies: []',
    'proxy-groups:',
    '  - name: GLOBAL',
    '    type: select',
    '    proxies:',
    '      - DIRECT',
    'rules:',
    '  - MATCH,DIRECT',
    ''
  ].join('\n');
  fs.writeFileSync(CONFIG_PATH, content, 'utf8');
}

function readMessage() {
  const header = Buffer.alloc(4);
  const bytesRead = fs.readSync(0, header, 0, 4, null);
  if (bytesRead === 0) process.exit(0);
  if (bytesRead !== 4) throw new Error('Invalid native message header');

  const length = header.readUInt32LE(0);
  if (length <= 0 || length > 1024 * 1024) throw new Error(`Invalid native message length: ${length}`);

  const body = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = fs.readSync(0, body, offset, length - offset, null);
    if (count === 0) throw new Error('Unexpected end of native message');
    offset += count;
  }
  return JSON.parse(body.toString('utf8'));
}

function sendMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  fs.writeSync(1, header);
  fs.writeSync(1, body);
}

function isPidRunning(pid) {
  if (!pid || !Number.isInteger(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_) {
    return false;
  }
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PID_PATH, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (_) {
    return null;
  }
}

function status() {
  const pid = readPid();
  const running = isPidRunning(pid);
  if (!running && fs.existsSync(PID_PATH)) {
    try { fs.unlinkSync(PID_PATH); } catch (_) {}
  }
  return {
    ok: true,
    running,
    pid: running ? pid : null,
    corePath: CORE_PATH,
    configPath: CONFIG_PATH,
    logPath: LOG_PATH
  };
}

function start() {
  if (!fs.existsSync(CORE_PATH)) {
    throw new Error(`Mihomo 内核不存在：${CORE_PATH}`);
  }

  ensureDefaultConfig();

  const current = status();
  if (current.running) {
    return { ...current, message: 'Mihomo 已经在运行' };
  }

  const logFd = fs.openSync(LOG_PATH, 'a');
  const child = spawn(CORE_PATH, ['-d', CONFIG_DIR, '-f', CONFIG_PATH], {
    cwd: CONFIG_DIR,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd]
  });

  child.unref();
  fs.writeFileSync(PID_PATH, String(child.pid), 'utf8');

  return {
    ok: true,
    running: true,
    pid: child.pid,
    corePath: CORE_PATH,
    configPath: CONFIG_PATH,
    logPath: LOG_PATH,
    message: 'Mihomo 已启动'
  };
}

function stop() {
  const current = status();
  if (!current.running) return { ...current, message: 'Mihomo 未运行' };

  try {
    process.kill(current.pid);
  } catch (error) {
    throw new Error(`停止 Mihomo 失败：${error.message}`);
  }

  try { fs.unlinkSync(PID_PATH); } catch (_) {}
  return { ...current, running: false, pid: null, message: 'Mihomo 已停止' };
}

function restart() {
  stop();
  return start();
}

function handle(message) {
  switch (message?.type) {
    case 'start': return start();
    case 'stop': return stop();
    case 'restart': return restart();
    case 'status': return status();
    default: return { ok: false, error: `未知命令：${message?.type || '(空)'}` };
  }
}

try {
  const message = readMessage();
  const result = handle(message);
  sendMessage(result);
} catch (error) {
  sendMessage({ ok: false, error: String(error?.message || error) });
}
