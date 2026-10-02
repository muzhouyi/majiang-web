# 青桌麻将

浏览器四人麻将游戏，支持单人对战电脑和好友在线组局，采用项目内的东光玩法规则。当前版本：**v4.3**。

## 可以玩什么

- 单人对 3 名电脑；创建房间、加入房间及查看在线大厅。
- 摸打、碰、明杠、暗杠、补杠、胡牌与多局积分。
- 手机横竖屏和电脑牌桌；本地 SVG 牌面。
- 管理员可调整积分、查看回放及管理玩家。具体规则见[胡牌规则](胡牌规则.md)。

## 本机运行

安装 Node.js 24，在项目目录执行：

```bash
node server.js
```

打开 http://localhost:3019。无需安装第三方 npm 包；在线游戏必须启动服务端，不能直接双击 HTML。需要管理功能时，通过环境变量 `ADMIN_PASSWORD` 设置自己的密码；未设置则不能管理员登录。

## Docker / 1Panel

复制 `.env.example` 为 `.env`，设置管理员密码和端口，再运行：

```bash
docker compose up -d --build
```

部署步骤见 [1Panel 说明](DEPLOY-1PANEL.md)。首次构建需下载 Node 基础镜像，升级时保留原数据卷。

## 版本下载

[Releases](https://github.com/muzhouyi/majiang-web/releases)提供各版更新介绍、运行包和对应 Docker 包；[更新日志](CHANGELOG.md)按版本先后记录变化。v1.0 仅保留说明，v1.1 起有源码快照。

牌面来源与授权说明见[素材声明](public/tiles/ATTRIBUTION.md)。仓库不含玩家数据、回放、日志或部署密码。
