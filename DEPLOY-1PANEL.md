# 青桌麻将 v4.0：1Panel Docker 部署

## 部署包

使用 `majiang-v4.0-1panel.zip`。压缩包包含 v4.0 源码、本地 SVG 牌面、`Dockerfile`、`docker-compose.yml` 和环境变量示例。

Compose 不包含麻将应用的 `image:` 下载地址，会在服务器本地使用当前目录的 Dockerfile 构建应用镜像，不会从 Docker Hub 下载现成的麻将应用镜像。首次构建仍需要获取 Dockerfile 使用的 `node:24-alpine` 基础镜像。

## 上传与解压

1. 在 1Panel“文件”中创建 `/opt/majiang-v4.0`。
2. 上传 `majiang-v4.0-1panel.zip` 并解压到该目录。
3. 确认目录中直接包含 `docker-compose.yml`、`Dockerfile`、`server.js`、`package.json` 和 `public`。

## 环境变量

将 `.env.example` 复制为 `.env`：

```env
BIND_ADDRESS=127.0.0.1
MAJIANG_PORT=3019
ADMIN_PASSWORD=请替换为自己的管理员密码
MAJIANG_DATA_VOLUME=dongguang-mahjong-v40-data
```

- 使用域名和 1Panel 反向代理时，保持 `BIND_ADDRESS=127.0.0.1`。
- 需要通过服务器 IP 和端口直接访问时，改为 `BIND_ADDRESS=0.0.0.0` 并放行端口。
- 部署前建议修改 `ADMIN_PASSWORD`。

## 从旧版升级并保留数据

如果服务器已经有旧版，且需要保留管理员设置、玩家总分、积分明细和回放，请在 v4.0 的 `.env` 中继续使用旧数据卷名。例如沿用 v3.7：

```env
MAJIANG_DATA_VOLUME=dongguang-mahjong-v37-data
```

如果你之前沿用的是其他旧版数据卷，也可以继续填写原来的数据卷名。

```env
MAJIANG_DATA_VOLUME=你的旧数据卷名
```

不要删除旧数据卷。v4.0 会自动兼容旧管理数据；旧数据没有新增字段时，会在首次运行时自动补齐。

## 在 1Panel 本地构建

1. 打开 1Panel“容器”->“编排”。
2. 创建编排并选择 `/opt/majiang-v4.0/docker-compose.yml`。
3. 选择“构建并启动”或“重新构建镜像”，不要选择仅拉取应用镜像。
4. Compose 使用 `build.context: .` 和当前目录的 Dockerfile 构建。
5. 容器 `dongguang-mahjong-v40` 的健康状态稍后应变为正常。

也可以在服务器终端执行：

```bash
cd /opt/majiang-v4.0
docker compose up -d --build
```

## 数据持久化

数据卷挂载到 `/app/data`，容器重启或重新构建后继续保留：

- 管理员积分设置；
- 牌局回放及回放开关；
- 真实玩家总积分；
- 玩家积分变动明细及记录开关；
- 玩家改名、合并和删除记录后的结果。

只有确定需要清空全部管理数据时，才在 1Panel 中手动删除数据卷。

## 域名与 HTTPS

1. 在 1Panel“网站”中创建反向代理网站。
2. 代理地址填写 `http://127.0.0.1:3019`。
3. 申请或选择 SSL 证书并开启 HTTPS。
4. 确认反向代理支持 WebSocket：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_read_timeout 3600s;
```

## 运行限制

房间和正在进行的牌局保存在单个 Node 进程内，因此只运行一个容器副本。容器重启会结束进行中的牌局，但不会清除数据卷中的管理员设置、玩家积分、积分明细和回放。
