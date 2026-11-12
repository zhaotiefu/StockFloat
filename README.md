# Stock Float

A 股行情盯盘工具。当前主交付为 **Windows 绿色便携版**（免安装、托盘后台）。

## Windows 绿色便携版（推荐）

位置：

- `release/StockFloat-portable-win64.zip`（exe + 使用说明）

使用：

1. 解压 zip  
2. 双击 `StockFloat.exe`  
3. 关闭 / 点「隐藏」= 后台托盘运行；托盘右键可再打开 / 设置 / 退出  

悬浮窗能力：

- **刷新**：手动刷新，状态显示「刷新中… / 已刷新」
- **置顶**：可开关始终置顶（设置中也有选项）
- **贴边隐藏**：靠近屏幕边缘自动收起，鼠标移入细条展开
- **透明度**：悬浮窗滑条或设置中调节 20%–100%
- **添加股票**：悬浮窗底部输入 6 位代码直接添加（最多 20 只）
- **时间**：左下角当前时间，隔开后显示最后刷新时间

配置文件：`stockfloat-data.json`（与 exe 同目录，不写注册表）

重新编译：

```bash
cd desktop
./build-windows.sh
```

## Chrome 扩展（旧方案）

如仍需浏览器扩展：

```bash
npm install
npm run pack:crx
```

然后用 `release/stock-float-unpacked.zip` 在开发者模式下「加载已解压的扩展程序」。
