# Stock Float

A 股行情盯盘工具。当前主交付为 **Windows 绿色便携版**（免安装、托盘后台）。

仓库内仍保留早期 Chrome 扩展代码，但推荐使用桌面便携版。

## Windows 绿色便携版（推荐）

位置：

- `release/StockFloat.exe`
- `release/StockFloat-portable-win64.zip`（exe + 使用说明）

使用：

1. 解压 zip  
2. 双击 `StockFloat.exe`  
3. 关闭窗口 = 隐藏到托盘后台；托盘右键可再打开 / 设置 / 退出  

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
