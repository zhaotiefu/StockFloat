# Stock Float

轻量级 A 股行情悬浮窗 Chrome 扩展（Manifest V3）。

在普通网页右下角显示可拖动、可调透明度的自选股行情面板，浏览网页时也能盯盘。

## 功能

- 网页右下角悬浮窗：名称 / 最新价 / 涨跌幅
- 拖动定位、透明度 20%–100%、最小化 / 隐藏
- Popup 管理自选（最多 20 只）、上下排序、刷新间隔
- 自动刷新（默认 5 秒，可改 10 / 30 秒）+ 手动刷新
- 配置与自选保存在 `chrome.storage.local`
- Shadow DOM 隔离样式，不影响宿主页面
- 行情适配层可替换；默认使用腾讯行情接口（非官方）

## 开发

```bash
npm install
npm run icons
npm run build
```

产物在 `dist/`。

```bash
npm run watch    # 监听构建
npm run typecheck
```

## 安装（Chrome）

### 方式 A：加载未打包目录（开发推荐）

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」
4. 选择本仓库的 `dist` 目录

### 方式 B：下载解压包后加载（推荐给本机安装）

```bash
npm run pack:crx
```

产物：

- `release/stock-float-unpacked.zip` ← **请用这个**
- `release/stock-float.crx`（多数个人版 Chrome 无法直接安装）

本机步骤：

1. 解压 `stock-float-unpacked.zip` 到任意文件夹  
2. 打开 `chrome://extensions`，开启「开发者模式」  
3. 「加载已解压的扩展程序」→ 选择解压后的文件夹

## 使用

1. 点击工具栏 **Stock Float** 图标打开 Popup
2. 输入 6 位 A 股代码添加自选（如 `601318`）
3. 打开任意 http/https 网页，右下角出现悬浮窗
4. 标题栏拖动；⚙ 调透明度；─ 最小化；× 隐藏
5. 隐藏后可在 Popup 重新开启「悬浮窗启用」

## 技术说明

| 模块 | 说明 |
|---|---|
| `src/background` | Service Worker：行情拉取、告警定时、消息处理 |
| `src/content` | Content Script：Shadow DOM 悬浮窗 |
| `src/popup` | 自选与设置界面 |
| `src/api` | 行情适配层（`TencentStockProvider`） |
| `src/storage` | `chrome.storage.local` 持久化 |

第一版明确不做：K 线、分时、五档、资讯、预警、交易、港美股、云同步。

## 数据源说明

默认请求 `https://qt.gtimg.cn/`。请自行确认使用条款与频率限制。接口不可用时会显示错误状态，**不会用虚构数据冒充行情**。

## 权限

- `storage`：保存自选与设置
- `alarms`：后台刷新唤醒
- `host_permissions`：访问腾讯行情域名
