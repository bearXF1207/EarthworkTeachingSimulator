# Electron 接入占位

此目录从 M10 开始使用。M0 不安装 Electron，不编写 main/preload，也不提供 EXE。

实施时按 `docs/TECHNICAL_DESIGN.md` 第11节建立独立的主进程/预加载编译配置，完成受限 IPC、本地文件打开/原子保存、未保存关闭确认与 Windows Portable 打包。
