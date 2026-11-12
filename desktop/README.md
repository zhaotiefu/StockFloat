# Stock Float 绿色便携版（Windows）

免安装、可后台托盘运行的 A 股悬浮窗程序。

## 使用

1. 解压 `StockFloat-portable-win64.zip`
2. 双击 `StockFloat.exe`
3. 右下角出现白色悬浮窗；关闭窗口会隐藏到托盘（后台继续跑）
4. 托盘图标右键：显示悬浮窗 / 设置 / 退出

配置文件 `stockfloat-data.json` 自动生成在 exe 同目录（绿色软件，不写注册表）。

## 本机重新编译

```bash
cd desktop
./build-windows.sh
```

产物：`../release/StockFloat.exe`
