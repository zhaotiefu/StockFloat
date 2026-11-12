# Stock Float 绿色便携版（Windows）

免安装、可后台托盘运行的 A 股悬浮窗程序。

## 使用

1. 解压 `StockFloat-portable-win64.zip`
2. 双击 `StockFloat.exe`
3. 白色悬浮窗：刷新 / 置顶 / 设置 / 添加股票 / 透明度
4. 关闭窗口或点「隐藏」→ 托盘后台；托盘右键可再打开 / 设置 / 退出

配置文件 `stockfloat-data.json` 自动生成在 exe 同目录。

## 本机重新编译

```bash
cd desktop
./build-windows.sh
```

产物：`../release/StockFloat.exe`
