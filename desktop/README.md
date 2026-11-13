# Stock Float 绿色便携版（Windows）

免安装、可后台托盘运行的 A 股悬浮窗程序。

## 使用

1. 解压 `StockFloat-portable-win64.zip`
2. 双击 `StockFloat.exe`
3. 右下角出现白色悬浮窗；关闭窗口会隐藏到托盘（后台继续跑，不占任务栏）
4. 托盘图标：**左键**显示悬浮窗；**右键**打开菜单（设置 / 退出等）
5. 悬浮窗「精简」右侧「锁定 / 解锁」：锁定后始终在最上层，解锁则按普通窗口叠放

配置文件 `stockfloat-data.json` 自动生成在 exe 同目录（绿色软件，不写注册表）。

## 本机重新编译

```bash
cd desktop
./build-windows.sh
```

产物：`../release/StockFloat.exe`
