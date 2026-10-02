# 青桌麻将 v2.5：1Panel Docker 部署

## 部署包

使用 `majiang-v2.5-1panel.zip`。压缩包包含应用源码、牌面 SVG、`Dockerfile`、`docker-compose.yml` 和环境变量示例。

Compose 没有配置麻将应用的 `image:` 地址，会在服务器本地用当前目录的 Dockerfile 构建，不会从 Docker Hub 下载现成的麻将游戏镜像。Dockerfile 使用 `node:24-alpine` 作为基础环境；若服务器没有缓存该基础镜像，首次构建仍需获取 Node 基础镜像。

## 一、上传并解压

1. 在 1Panel 的“文件”中创建 `/opt/majiang-v2.5`。
2. 上传 `majiang-v2.5-1panel.zip` 并解压到该目录。
3. 确认 `/opt/majiang-v2.5` 中直接包含 `docker-compose.yml`、`Dockerfile`、`server.js`、`package.json` 和 `public`。

## 二、配置环境变量

将 `.env.example` 复制为 `.env`：

```env
BIND_ADDRESS=127.0.0.1
MAJIANG_PORT=3019
ADMIN_PASSWORD=请替换为自己的管理员密码
```

- 使用域名和 1Panel 反向代理时保持 `BIND_ADDRESS=127.0.0.1`。
- 需要通过服务器 IP 和端口直接访问时改为 `BIND_ADDRESS=0.0.0.0`，并放行对应端口。
- 建议部署前修改 `ADMIN_PASSWORD`，新密码会替代网页管理入口的默认密码。

## 三、在服务器本地构建

1. 打开 1Panel 的“容器 → 编排”。
2. 创建编排并选择 `/opt/majiang-v2.5/docker-compose.yml`。
3. 选择“构建并启动”或启用“重新构建镜像”，不要选择仅拉取镜像。
4. Compose 会使用 `build.context: .` 和当前目录的 Dockerfile 构建应用。
5. 容器名称为 `dongguang-mahjong-v25`，稍后健康状态应变为正常。

也可以在服务器终端执行：

```bash
cd /opt/majiang-v2.5
docker compose up -d --build
```

## 四、数据持久化

Compose 会创建名为 `dongguang-mahjong-v25-data` 的 Docker 数据卷，并挂载到 `/app/data`。以下内容会跨容器重启和重新构建保留：

- 管理员积分设置
- 牌局回放及回放开关
- 真实玩家积分及积分记录开关
- 删除回放或玩家积分记录后的结果

不要在普通更新时删除这个数据卷。只有确定要清空全部管理数据时，才在 1Panel 中手动删除该卷。

## 五、绑定域名和 HTTPS

1. 在 1Panel“网站”中创建反向代理网站。
2. 代理地址填写 `http://127.0.0.1:3019`；修改过 `MAJIANG_PORT` 时使用对应端口。
3. 申请或选择 SSL 证书并开启 HTTPS。
4. 确认反向代理支持 WebSocket：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_read_timeout 3600s;
```

## 六、更新与回滚

上传新版本到新的目录，通过 `docker compose up -d --build` 本地重建。升级前保留旧部署目录；应用回滚时继续挂载原数据卷即可保留管理数据。

当前房间和正在进行的牌局仍保存在单个 Node 进程内，因此只运行一个容器副本。容器重启会结束正在进行的牌局，但不会清除上述管理数据。
