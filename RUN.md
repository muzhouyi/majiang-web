# v1.6 运行说明

需要 Node.js 24。解压后在当前目录运行 `node server.js`，浏览器访问 `http://localhost:3019`。多人需访问同一个服务器地址。

Docker：先复制 `.env.example` 为 `.env` 并修改管理员密码及端口。执行 `docker compose up -d --build`。升级前备份并沿用原数据卷。

程序不依赖第三方 npm 包；牌面等本地资源已随包提供。
