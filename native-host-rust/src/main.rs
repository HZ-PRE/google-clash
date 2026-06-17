use std::env;
use std::fs::{self};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

struct Request {
    kind: String,
    url: Option<String>,
    allow_lan: Option<String>,
    proxy_port: Option<u16>,
    controller: Option<String>,
}

struct HostStatus {
    ok: bool,
    running: bool,
    pid: Option<u32>,
    core_path: String,
    config_path: String,
    message: Option<String>,
}

struct AppPaths {
    core_path: PathBuf,
    config_dir: PathBuf,
    config_path: PathBuf,
    pid_path: PathBuf,
    subscription_path: PathBuf,
}

fn main() {
    match run() {
        Ok(json) => { let _ = send_json(&json); }
        Err(error) => { let _ = send_json(&json_error(&error)); }
    }
}

fn run() -> Result<String, String> {
    let raw = read_native_message()?;
    let request = parse_request(&raw)?;
    let paths = resolve_paths()?;
    match request.kind.as_str() {
        "start" => start(&paths),
        "stop" => stop(&paths),
        "restart" => { let _ = stop(&paths); start(&paths) }
        "status" => status_json(&paths, None),
        "updateSubscription" => update_subscription(
            &paths,
            request.url.as_deref(),
            parse_allow_lan(request.allow_lan.as_deref()),
            request.proxy_port.unwrap_or(7890),
            request.controller.as_deref(),
        ),
        "getSubscriptionInfo" => get_subscription_info(request.url.as_deref()),
        "setAllowLan" => set_allow_lan(&paths, parse_allow_lan(request.allow_lan.as_deref())),
        "getConfig" => get_config(&paths),
        other => Ok(format!("{{\"ok\":false,\"error\":\"{}\"}}", escape_json(&format!("Unknown command: {}", other)))),
    }
}

fn resolve_paths() -> Result<AppPaths, String> {
    let exe_path = env::current_exe().map_err(|e| format!("Failed to read Native Host path: {}", e))?;
    let host_dir = exe_path.parent().ok_or_else(|| "Failed to resolve Native Host directory".to_string())?;
    let app_root = host_dir.parent().ok_or_else(|| "Failed to resolve app root".to_string())?.to_path_buf();
    let config_dir = app_root.join("core");
    Ok(AppPaths {
        core_path: config_dir.join("nb-mihomo.exe"),
        config_path: config_dir.join("config.yaml"),
        pid_path: config_dir.join("mihomo.pid"),
        subscription_path: config_dir.join("subscription.yaml"),
        config_dir,
    })
}

fn read_native_message() -> Result<String, String> {
    let mut header = [0u8; 4];
    let mut stdin = io::stdin();
    stdin.read_exact(&mut header).map_err(|e| format!("Failed to read Native Message header: {}", e))?;
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > 8 * 1024 * 1024 { return Err(format!("Invalid Native Message length: {}", length)); }
    let mut body = vec![0u8; length];
    stdin.read_exact(&mut body).map_err(|e| format!("Failed to read Native Message body: {}", e))?;
    String::from_utf8(body).map_err(|e| format!("Native Message is not UTF-8: {}", e))
}

fn send_json(json: &str) -> Result<(), String> {
    let body = json.as_bytes();
    let mut stdout = io::stdout();
    stdout.write_all(&(body.len() as u32).to_le_bytes()).map_err(|e| format!("Failed to write response header: {}", e))?;
    stdout.write_all(body).map_err(|e| format!("Failed to write response body: {}", e))?;
    stdout.flush().map_err(|e| format!("Failed to flush response: {}", e))
}

fn parse_request(raw: &str) -> Result<Request, String> {
    let kind = parse_json_string_field(raw, "type")?.ok_or_else(|| "Native Message missing type".to_string())?;
    let url = parse_json_string_field(raw, "url")?;
    let allow_lan = parse_json_string_or_bool_field(raw, "allowLan")?;
    let proxy_port = parse_json_u16_field(raw, "proxyPort")?;
    let controller = parse_json_string_field(raw, "controller")?;
    Ok(Request { kind, url, allow_lan, proxy_port, controller })
}

fn parse_json_string_field(raw: &str, field: &str) -> Result<Option<String>, String> {
    let needle = format!("\"{}\"", field);
    let Some(key_pos) = raw.find(&needle) else { return Ok(None); };
    let after_key = &raw[key_pos + needle.len()..];
    let colon_pos = after_key.find(':').ok_or_else(|| format!("{} format error", field))?;
    let after_colon = after_key[colon_pos + 1..].trim_start();
    if after_colon.starts_with("null") { return Ok(None); }
    if !after_colon.starts_with('"') { return Err(format!("{} must be a string", field)); }
    Ok(Some(parse_json_string(after_colon)?))
}

fn parse_json_string_or_bool_field(raw: &str, field: &str) -> Result<Option<String>, String> {
    let needle = format!("\"{}\"", field);
    let Some(key_pos) = raw.find(&needle) else { return Ok(None); };
    let after_key = &raw[key_pos + needle.len()..];
    let colon_pos = after_key.find(':').ok_or_else(|| format!("{} format error", field))?;
    let after_colon = after_key[colon_pos + 1..].trim_start();
    if after_colon.starts_with("true") { return Ok(Some("true".to_string())); }
    if after_colon.starts_with("false") { return Ok(Some("false".to_string())); }
    if after_colon.starts_with("null") { return Ok(None); }
    if after_colon.starts_with('"') { return Ok(Some(parse_json_string(after_colon)?)); }
    Err(format!("{} must be boolean or string", field))
}

fn parse_json_u16_field(raw: &str, field: &str) -> Result<Option<u16>, String> {
    let needle = format!("\"{}\"", field);
    let Some(key_pos) = raw.find(&needle) else { return Ok(None); };
    let after_key = &raw[key_pos + needle.len()..];
    let colon_pos = after_key.find(':').ok_or_else(|| format!("{} format error", field))?;
    let after_colon = after_key[colon_pos + 1..].trim_start();
    if after_colon.starts_with("null") { return Ok(None); }
    let end = after_colon.find(|c: char| !c.is_ascii_digit()).unwrap_or(after_colon.len());
    let num_str = &after_colon[..end];
    if num_str.is_empty() { return Ok(None); }
    Ok(Some(num_str.parse::<u16>().map_err(|_| format!("{} must be a valid port number", field))?))
}

fn parse_json_string(input: &str) -> Result<String, String> {
    let mut chars = input.chars();
    if chars.next() != Some('"') { return Err("JSON string missing start quote".to_string()); }
    let mut output = String::new();
    let mut escaped = false;
    for ch in chars {
        if escaped {
            match ch {
                '"' => output.push('"'), '\\' => output.push('\\'), '/' => output.push('/'),
                'b' => output.push('\u{0008}'), 'f' => output.push('\u{000c}'),
                'n' => output.push('\n'), 'r' => output.push('\r'), 't' => output.push('\t'),
                'u' => return Err("Unicode escapes are not supported here".to_string()),
                other => output.push(other),
            }
            escaped = false;
        } else {
            match ch { '\\' => escaped = true, '"' => return Ok(output), other => output.push(other) }
        }
    }
    Err("JSON string missing end quote".to_string())
}

fn parse_allow_lan(value: Option<&str>) -> bool {
    matches!(value.unwrap_or("false").trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on")
}

fn ensure_default_config(paths: &AppPaths) -> Result<(), String> {
    if paths.config_path.exists() { return Ok(()); }
    fs::create_dir_all(&paths.config_dir).map_err(|e| format!("Failed to create core directory: {}", e))?;
    fs::write(&paths.config_path, default_config(false, 7890, "127.0.0.1:9090")).map_err(|e| format!("Failed to write default config: {}", e))
}

fn default_config(allow_lan: bool, proxy_port: u16, controller: &str) -> String {
    [
        format!("mixed-port: {}", proxy_port),
        format!("allow-lan: {}", allow_lan),
        "mode: rule".to_string(),
        "log-level: info".to_string(),
        format!("external-controller: {}", controller),
        "secret: \"\"".to_string(),
        "".to_string(),
        "proxies: []".to_string(),
        "proxy-groups:".to_string(),
        "rules:".to_string(),
        "  - MATCH,DIRECT".to_string(),
        "".to_string(),
    ].join("\n")
}

fn update_subscription(paths: &AppPaths, url: Option<&str>, allow_lan: bool, proxy_port: u16, controller: Option<&str>) -> Result<String, String> {
    let url = url.map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| "Subscription URL is empty".to_string())?;
    if !(url.starts_with("http://") || url.starts_with("https://")) { return Err("Subscription URL must start with http:// or https://".to_string()); }
    fs::create_dir_all(&paths.config_dir).map_err(|e| format!("Failed to create core directory: {}", e))?;
    let controller = controller.unwrap_or("127.0.0.1:9090");

    let ps = format!(
        "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri '{}' -OutFile '{}'",
        escape_powershell_single(url),
        escape_powershell_single(&display(&paths.subscription_path))
    );
    let output = Command::new("powershell").args(["-NoProfile","-ExecutionPolicy","Bypass","-Command",&ps]).output().map_err(|e| format!("Failed to call PowerShell: {}", e))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Failed to download subscription: {}", if err.is_empty() { "PowerShell returned failure".to_string() } else { err }));
    }
    let raw = fs::read_to_string(&paths.subscription_path).map_err(|e| format!("Failed to read subscription: {}", e))?;
    let content = normalize_subscription_content(&raw, allow_lan, proxy_port, controller)?;
    fs::write(&paths.config_path, content).map_err(|e| format!("Failed to write Mihomo config: {}", e))?;
    Ok(format!("{{\"ok\":true,\"message\":\"{}\",\"configPath\":\"{}\"}}", escape_json("Subscription updated to core/config.yaml"), escape_json(&display(&paths.config_path))))
}

fn set_allow_lan(paths: &AppPaths, allow_lan: bool) -> Result<String, String> {
    ensure_default_config(paths)?;
    let raw = fs::read_to_string(&paths.config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let content = upsert_top_level_yaml_line(&raw, "allow-lan", if allow_lan { "true" } else { "false" });
    fs::write(&paths.config_path, content).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(format!("{{\"ok\":true,\"message\":\"{}\",\"allowLan\":{}}}", escape_json(if allow_lan { "LAN access enabled" } else { "LAN access disabled" }), if allow_lan { "true" } else { "false" }))
}

fn normalize_subscription_content(raw: &str, allow_lan: bool, proxy_port: u16, controller: &str) -> Result<String, String> {
    let trimmed = raw.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() { return Err("Subscription content is empty".to_string()); }
    if trimmed.contains("proxies:") || trimmed.contains("proxy-providers:") || trimmed.contains("proxy-groups:") {
        let mut out = trimmed.to_string();
        out = remove_old_local_override_block(&out);
        out = upsert_top_level_yaml_line(&out, "mixed-port", &proxy_port.to_string());
        out = upsert_top_level_yaml_line(&out, "allow-lan", if allow_lan { "true" } else { "false" });
        out = upsert_top_level_yaml_line(&out, "external-controller", controller);
        out = upsert_top_level_yaml_line(&out, "secret", "\"\"");
        return Ok(format!("{}\n", out.trim_end()));
    }
    Err("Only Clash/Mihomo YAML subscriptions are supported. No proxies/proxy-groups/proxy-providers field found.".to_string())
}

fn remove_old_local_override_block(input: &str) -> String {
    let mut result: Vec<String> = Vec::new();
    let mut skipping = false;
    for line in input.lines() {
        if line.trim() == "# Clash Switchboard local overrides" { skipping = true; continue; }
        if skipping {
            let key = top_level_key(line);
            if matches!(key.as_deref(), Some("mixed-port")|Some("allow-lan")|Some("external-controller")|Some("secret")) { continue; }
            skipping = false;
        }
        result.push(line.to_string());
    }
    result.join("\n")
}

fn upsert_top_level_yaml_line(input: &str, key: &str, value: &str) -> String {
    let mut found = false;
    let mut lines: Vec<String> = Vec::new();
    for line in input.lines() {
        if top_level_key(line).as_deref() == Some(key) {
            if !found { lines.push(format!("{}: {}", key, value)); found = true; }
        } else { lines.push(line.to_string()); }
    }
    if !found { lines.push(format!("{}: {}", key, value)); }
    lines.join("\n")
}

fn top_level_key(line: &str) -> Option<String> {
    if line.starts_with(' ') || line.starts_with('\t') { return None; }
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') { return None; }
    let pos = trimmed.find(':')?;
    let key = trimmed[..pos].trim();
    if key.is_empty() { None } else { Some(key.to_string()) }
}

fn get_subscription_info(url: Option<&str>) -> Result<String, String> {
    let url = url.map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| "Subscription URL is empty".to_string())?;
    if !(url.starts_with("http://") || url.starts_with("https://")) { return Err("Subscription URL must start with http:// or https://".to_string()); }
    let ps = format!(
        "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri '{}'; $u=[string]$r.Headers['subscription-userinfo']; $w=[string]$r.Headers['profile-web-page-url']; [Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output ('SUBINFO_JSON_START{{\"userinfo\":\"' + (($u -replace '\\\\','\\\\\\\\') -replace '\"','\\\"') + '\",\"webPageUrl\":\"' + (($w -replace '\\\\','\\\\\\\\') -replace '\"','\\\"') + '\"}}SUBINFO_JSON_END')",
        escape_powershell_single(url)
    );
    let output = Command::new("powershell").args(["-NoProfile","-ExecutionPolicy","Bypass","-Command",&ps]).output().map_err(|e| format!("Failed to call PowerShell: {}", e))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Failed to request subscription info: {}", if err.is_empty() { "PowerShell returned failure".to_string() } else { err }));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let start = stdout.find("SUBINFO_JSON_START").ok_or_else(|| "Subscription info response marker not found".to_string())? + "SUBINFO_JSON_START".len();
    let end = stdout.find("SUBINFO_JSON_END").ok_or_else(|| "Subscription info response end marker not found".to_string())?;
    let payload = &stdout[start..end];
    Ok(format!("{{\"ok\":true,\"data\":{}}}", payload.trim()))
}

fn escape_powershell_single(input: &str) -> String { input.replace("'", "''") }

use std::{
    time::Duration,
};

fn start(paths: &AppPaths) -> Result<String, String> {
    // 1. core 检查
    if !paths.core_path.exists() {
        return Err(format!(
            "Mihomo core does not exist: {}",
            display(&paths.core_path)
        ));
    }

    // 2. config 初始化
    ensure_default_config(paths)?;

    // 3. 已运行检测（建议加 lock）
    let status = current_status(paths)?;
    if status.running {
        return status_json(paths, Some("Mihomo is already running"));
    }

    // 4. 启动进程（增强配置）
    let mut child = Command::new(&paths.core_path)
        .arg("-d")
        .arg(&paths.config_dir)
        .arg("-f")
        .arg(&paths.config_path)
        .current_dir(&paths.config_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start Mihomo: {}", e))?;

    let pid = child.id();

    // 5. 写 PID（先写，避免丢失）
    fs::write(&paths.pid_path, pid.to_string())
        .map_err(|e| format!("Failed to write PID file: {}", e))?;

    // 6. 不 forget，转交托管（关键优化点）
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    // 7. 健康检查（避免假启动）
    std::thread::sleep(Duration::from_millis(500));

    if !is_process_alive(pid) {
        let _ = fs::remove_file(&paths.pid_path);
        return Err("Mihomo failed to start (process exited early)".to_string());
    }

    status_json(paths, Some("Mihomo started successfully"))
}

fn stop(paths: &AppPaths) -> Result<String, String> {
    let current = current_status(paths)?;
    if !current.running { let _ = remove_pid_file(paths); return status_json(paths, Some("Mihomo is not running")); }
    if let Some(pid) = current.pid {
        let output = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output().map_err(|e| format!("Failed to call taskkill: {}", e))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("Failed to stop Mihomo: {}", if err.is_empty() { "taskkill returned failure".to_string() } else { err }));
        }
    }
    let _ = remove_pid_file(paths);
    status_json(paths, Some("Mihomo stopped"))
}
fn is_process_alive(pid: u32) -> bool {
    std::process::Command::new("tasklist")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
}
fn status_json(paths: &AppPaths, message: Option<&str>) -> Result<String, String> {
    let mut st = current_status(paths)?;
    st.message = message.map(|s| s.to_string());
    Ok(host_status_json(&st))
}

fn current_status(paths: &AppPaths) -> Result<HostStatus, String> {
    let pid = read_pid(&paths.pid_path);
    let running = pid.map(is_pid_running).unwrap_or(false);
    if !running && paths.pid_path.exists() { let _ = remove_pid_file(paths); }
    Ok(HostStatus { ok: true, running, pid: if running { pid } else { None }, core_path: display(&paths.core_path), config_path: display(&paths.config_path), message: None })
}

fn read_pid(pid_path: &Path) -> Option<u32> { fs::read_to_string(pid_path).ok()?.trim().parse::<u32>().ok() }

fn is_pid_running(pid: u32) -> bool {
    let filter = format!("PID eq {}", pid);
    let Ok(output) = Command::new("tasklist").args(["/FI", &filter, "/FO", "CSV", "/NH"]).output() else { return false; };
    if !output.status.success() { return false; }
    let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
    text.contains(&format!(",\"{}\"", pid)) || text.contains(&format!(",{}", pid))
}

fn remove_pid_file(paths: &AppPaths) -> Result<(), String> {
    if paths.pid_path.exists() { fs::remove_file(&paths.pid_path).map_err(|e| format!("Failed to delete PID file: {}", e))?; }
    Ok(())
}

fn host_status_json(st: &HostStatus) -> String {
    let pid = st.pid.map(|p| p.to_string()).unwrap_or_else(|| "null".to_string());
    let message = st.message.as_ref().map(|m| format!(",\"message\":\"{}\"", escape_json(m))).unwrap_or_default();
    format!("{{\"ok\":{},\"running\":{},\"pid\":{},\"corePath\":\"{}\",\"configPath\":\"{}\"{}}}", if st.ok {"true"} else {"false"}, if st.running {"true"} else {"false"}, pid, escape_json(&st.core_path), escape_json(&st.config_path), message)
}

fn json_error(message: &str) -> String { format!("{{\"ok\":false,\"error\":\"{}\"}}", escape_json(message)) }

fn escape_json(input: &str) -> String {
    let mut output = String::with_capacity(input.len() + 8);
    for ch in input.chars() {
        match ch {
            '"' => output.push_str("\\\""), '\\' => output.push_str("\\\\"), '\n' => output.push_str("\\n"), '\r' => output.push_str("\\r"), '\t' => output.push_str("\\t"),
            c if c <= '\u{1f}' => output.push_str(&format!("\\u{:04x}", c as u32)), c => output.push(c),
        }
    }
    output
}

fn display(path: &Path) -> String { path.to_string_lossy().to_string() }

fn get_config(paths: &AppPaths) -> Result<String, String> {
  let content = fs::read_to_string(&paths.config_path)
    .map_err(|e| format!("Failed to read config.yaml: {}", e))?;
  let groups = parse_yaml_proxy_groups(&content);
  let json_groups: Vec<String> = groups.iter().map(|n| format!("\"{}\"", escape_json(n))).collect();
  Ok(format!("{{\"ok\":true,\"proxyGroups\":[{}]}}", json_groups.join(",")))
}

fn parse_yaml_proxy_groups(yaml: &str) -> Vec<String> {
  let mut names: Vec<String> = Vec::new();
  let mut in_section = false;
  for line in yaml.lines() {
    let trimmed = line.trim();
    if trimmed == "proxies:" || trimmed == "proxy-groups:" {
      in_section = true;
      continue;
    }
    if in_section {
      if trimmed.is_empty() { continue; }
      if !trimmed.starts_with('-') {
        if !line.starts_with(' ') && !line.starts_with('\t') { break; }
        continue;
      }
      // Handle inline YAML: - { name: GROUP_NAME, ... }
      if let Some(brace_pos) = trimmed.find('{') {
        let after_brace = &trimmed[brace_pos + 1..];
        let mut name_val = None;
        let mut type_val: Option<String> = None;
        for part in after_brace.split(',') {
          let kv = part.trim();
          if kv.starts_with("name:") || kv.starts_with("name：") {
            let v = kv[kv.find(':').unwrap() + 1..].trim();
            let v = v.trim_matches('\'').trim_matches('"');
            if !v.is_empty() { name_val = Some(v.to_string()); }
          }
          if kv.starts_with("type:") {
            let v = kv[5..].trim();
            type_val = Some(v.trim_matches('\'').trim_matches('"').to_string());
          }
        }
        // Include all named entries (both proxy groups and proxy nodes)
        // since config.yaml order interleaves them
        if let Some(name) = name_val {
          names.push(name);
        }
      }
    }
  }
  names
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_parse_yaml_inline_format() {
    let yaml = concat!(
      "proxy-groups:\n",
      "  - { name: 影猫机场, type: select, proxies: [自动选择, 故障转移] }\n",
      "  - { name: 自动选择, type: urltest, proxies: [HK, JP] }\n",
      "  - { name: 故障转移, type: fallback, proxies: [HK] }\n",
      "  - { name: 境内使用, type: select, proxies: [DIRECT] }\n",
      "  - { name: 海外使用, type: select, proxies: [自动选择] }\n",
      "rules:\n",
    );
    let names = parse_yaml_proxy_groups(yaml);
    assert_eq!(names.len(), 5);
    assert_eq!(names, vec!["影猫机场", "自动选择", "故障转移", "境内使用", "海外使用"]);
  }

  #[test]
  fn test_parse_yaml_proxies_section() {
    let yaml = concat!(
      "proxies:\n",
      "  - { name: node-hk, type: ss, server: 1.2.3.4, port: 9901 }\n",
      "  - { name: node-jp, type: ss, server: 5.6.7.8, port: 9902 }\n",
      "rules:\n",
    );
    let names = parse_yaml_proxy_groups(yaml);
    assert_eq!(names, vec!["node-hk", "node-jp"]);
  }

  #[test]
  fn test_preserves_order() {
    let mut yaml = String::from("proxy-groups:\n");
    for i in 0..100 {
      yaml.push_str(&format!("  - {{ name: group-{:03}, type: select, proxies: [A] }}\n", i));
    }
    let result = parse_yaml_proxy_groups(&yaml);
    assert_eq!(result.len(), 100);
    for i in 0..100 {
      assert_eq!(result[i], format!("group-{:03}", i));
    }
  }

  #[test]
  fn test_empty() {
    assert!(parse_yaml_proxy_groups("").is_empty());
    assert!(parse_yaml_proxy_groups("mixed-port: 7890\n").is_empty());
  }

  #[test]
  fn test_stops_at_next_section() {
    let yaml = concat!(
      "proxy-groups:\n",
      "  - { name: G1, type: select, proxies: [A] }\n",
      "  - { name: G2, type: select, proxies: [B] }\n",
      "rules:\n",
      "  - MATCH,DIRECT\n",
    );
    assert_eq!(parse_yaml_proxy_groups(yaml), vec!["G1", "G2"]);
  }

  #[test]
  fn test_real_world_names() {
    let yaml = concat!(
      "proxies:\n",
      "  - { name: 影猫机场, type: select, proxies: [A] }\n",
      "  - { name: 联通-高速-香港-K3, type: ss, server: 1.2.3.4, port: 9901 }\n",
      "  - { name: \"quoted-name\", type: select, proxies: [A] }\n",
      "  - { name: 'single-quoted', type: select, proxies: [A] }\n",
    );
    let names = parse_yaml_proxy_groups(yaml);
    assert_eq!(names.len(), 4);
    assert_eq!(names, vec!["影猫机场", "联通-高速-香港-K3", "quoted-name", "single-quoted"]);
  }

  #[test]
  fn test_get_config_e2e() {
    let tmp = std::env::temp_dir().join("cst-test-config");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::write(tmp.join("config.yaml"), concat!(
      "mixed-port: 7890\n",
      "proxy-groups:\n",
      "  - { name: A, type: select, proxies: [X] }\n",
      "  - { name: B, type: urltest, proxies: [X] }\n",
    )).unwrap();

    let paths = AppPaths {
      config_dir: tmp.clone(),
      config_path: tmp.join("config.yaml"),
      core_path: tmp.join("x.exe"),
      pid_path: tmp.join("x.pid"),
      subscription_path: tmp.join("sub.yaml"),
    };

    let result = get_config(&paths).unwrap();
    assert_eq!(result, r#"{"ok":true,"proxyGroups":["A","B"]}"#);
    std::fs::remove_dir_all(&tmp).ok();
  }

  #[test]
  fn test_parse_yaml_proxy_groups_matches_proxies_section() {
    // Real-world case: config.yaml uses "proxies:" not "proxy-groups:"
    let yaml = concat!(
      "mixed-port: 7890\n",
      "proxies:\n",
      "  - { name: 联通-高速-香港-K3, type: ss, server: 1.2.3.4, port: 9901 }\n",
      "  - { name: 印度-B, type: ss, server: 5.6.7.8, port: 10027 }\n",
      "  - { name: 法国-A, type: ss, server: 9.10.11.12, port: 10022 }\n",
      "  - name: GLOBAL\n",
      "    type: select\n",
      "    proxies:\n",
      "      - DIRECT\n",
      "      - 自动选择\n",
      "rules:\n",
    );
    let names = parse_yaml_proxy_groups(yaml);
    // The inline {} entries have names, multi-line - name: GLOBAL has no braces
    assert_eq!(names, vec!["联通-高速-香港-K3", "印度-B", "法国-A"]);
  }
}
