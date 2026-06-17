# 块垒加速器 Chrome Extension

一个 Manifest V3 Chrome 插件，用于一键启动本地 Mihomo 内核，并让 Chrome 浏览器代理到 Mihomo。

> Chrome 插件不能单独启动本地 exe。本项目通过 Chrome Native Messaging 调用 Rust 单文件 Native Host：`native-host/clash-switchboard-host.exe`，再启动 `core/nb-mihomo.exe`。

## 一键启动效果

用户点击插件里的 **启动 VPN**：

1. 插件调用 Native Host：`native-host/clash-switchboard-host.exe`。
2. Native Host 启动 `core/nb-mihomo.exe -d core -f core/config.yaml`。
3. 插件等待 `http://127.0.0.1:9090/version` 就绪。
4. 插件自动把 Chrome 代理设置到 `127.0.0.1:7890`。

点击 **停止 VPN**：

1. Native Host 通过 PID 停止 Mihomo 进程。
2. 插件清除 Chrome 代理。

## 固定插件 ID

`manifest.json` 已加入固定 `key`，开发/安装后的插件 ID 固定为：

```text
aggoidfhenhmcjdahailamnlingebmem
```

Native Host 的 `allowed_origins` 会使用这个 ID。

## 安装包

### 本机快速安装测试

不依赖 Inno Setup，可直接运行：

```bat
cd /d F:\pro\h5\clash-chrome-extension
installer\install-app.bat
```

它会安装到：

```text
%LOCALAPPDATA%\ClashSwitchboard
```

并自动执行：

1. 复制插件文件到 `%LOCALAPPDATA%\ClashSwitchboard\extension`
2. 复制 Native Host 到 `%LOCALAPPDATA%\ClashSwitchboard\native-host`
3. 复制 Mihomo 到 `%LOCALAPPDATA%\ClashSwitchboard\core`
4. 注册 Native Messaging Host
5. 写入 Chrome 本地扩展注册表项

安装后请重启 Chrome，或打开：

```text
chrome://extensions/
```

检查插件是否已加载。如果 Chrome 未自动加载，请开启开发者模式，手动加载：

```text
%LOCALAPPDATA%\ClashSwitchboard\extension
```

### 生成正式安装包 exe

需要先安装 Inno Setup 6。

执行：

```bat
cd /d F:\pro\h5\clash-chrome-extension
installer\build-installer.bat
```

输出文件：

```text
installer\dist\ClashSwitchboardSetup.exe
```

客户使用流程：

```text
双击 ClashSwitchboardSetup.exe
重启 Chrome
打开插件
点击“启动 VPN”
```

## 目录结构

```text
clash-chrome-extension/
├─ core/
│  ├─ nb-mihomo.exe
│  └─ config.yaml
├─ native-host/
│  ├─ clash-switchboard-host.exe
│  ├─ build-rust-host.bat
│  ├─ install-native-host.bat
│  └─ uninstall-native-host.bat
├─ native-host-rust/
│  ├─ Cargo.toml
│  └─ src/main.rs
├─ installer/
│  ├─ install-app.bat
│  ├─ build-installer.bat
│  └─ ClashSwitchboard.iss
├─ manifest.json
├─ popup.html
├─ popup.js
├─ background.js
└─ clash-api.js
```

## 编译 Rust Native Host

```bat
cd /d F:\pro\h5\clash-chrome-extension
native-host\build-rust-host.bat
```

编译产物：

```text
native-host/clash-switchboard-host.exe
```

这个 exe 是 Native Host 单文件程序，客户机不需要安装 Node.js。

## Mihomo 配置

默认配置文件：

```text
core/config.yaml
```

最低要求：

```yaml
mixed-port: 7890
external-controller: 127.0.0.1:9090
secret: ""
```

如果你有订阅生成的完整 Clash/Mihomo 配置，可以替换 `core/config.yaml`，但必须保留：

```yaml
mixed-port: 7890
external-controller: 127.0.0.1:9090
```

## 常见问题

### 点击启动提示 Native Host 未注册

开发环境可执行：

```bat
native-host\install-native-host.bat aggoidfhenhmcjdahailamnlingebmem
```

正式客户建议通过安装包安装。

### 点击启动后 External Controller 未就绪

通常是 `core/config.yaml` 格式错误，或没有配置：

```yaml
external-controller: 127.0.0.1:9090
```

### 端口说明

| 用途 | 默认端口 |
|---|---:|
| Chrome 代理 / mixed-port | 7890 |
| Mihomo External Controller | 9090 |

插件测试连接访问的是：

```text
http://127.0.0.1:9090/version
```

不要把 External Controller URL 填成 `http://127.0.0.1:7890`。
