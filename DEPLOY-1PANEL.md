# 青桌麻将 v1.7：1Panel Docker 部署

## 部署包

使用 `majiang-v1.7-1panel.zip`，或直接上传 `deploy/1panel-v1.7` 文件夹。部署包已经包含服务端、网页、34 张 SVG 牌面、Dockerfile 和 Compose 配置。

## 一、上传并解压

1. 在 1Panel 的“文件”中创建目录，例如 `/opt/majiang-v1.7`。
2. 上传 `majiang-v1.7-1panel.zip` 并解压到该目录。
3. 确认目录中能直接看到 `docker-compose.yml`、`Dockerfile`、`server.js`、`package.json` 和 `public`，不要额外多套一层文件夹。

## 二、设置端口

把 `.env.example` 复制为 `.env`。默认内容为：

```env
BIND_ADDRESS=127.0.0.1
MAJIANG_PORT=3019
```

- 使用域名和 1Panel 反向代理：保持 `127.0.0.1`。
- 直接使用服务器 IP 加端口访问：改成 `BIND_ADDRESS=0.0.0.0`，并在云安全组和服务器防火墙放行所选端口。
- 如果服务器的 `3019` 已被占用，可以修改 `MAJIANG_PORT`；容器内部仍使用 `3019`。

## 三、创建编排

1. 打开 1Panel 的“容器 → 编排”。
2. 选择“创建编排”或“路径选择”。
3. 选择 `/opt/majiang-v1.7/docker-compose.yml`。
4. 确认并启动，首次启动会拉取 `node:24-alpine` 并构建本地镜像 `dongguang-mahjong:1.7`。
5. 容器名称应为 `dongguang-mahjong-v16`，健康状态稍后应显示为正常。

如果拉取 Node 镜像失败，需要先在 1Panel 的容器设置中配置可用的 Docker 镜像加速地址，再重新构建。

## 四、绑定域名和 HTTPS

1. 打开 1Panel 的“网站”，创建“反向代理”网站。
2. 填写域名，代理地址填写 `http://127.0.0.1:3019`；若修改过 `MAJIANG_PORT`，这里使用修改后的端口。
3. 在网站配置中申请或选择 SSL 证书，并开启 HTTPS。
4. 联机房间使用 WebSocket。如果在线房间无法连接，在该网站的反向代理配置中确认包含：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_read_timeout 3600s;
```

HTTPS 页面会自动使用 `wss://`，不需要修改游戏代码。

## 五、更新与回滚

更新前保留旧部署目录。上传新版本后使用新的目录和镜像标签创建编排；确认正常再停掉旧容器。这样可以直接切回旧编排。

## 当前限制

- 房间、积分和牌局状态保存在容器内存中，重启容器后会清空。
- 当前必须只运行一个容器副本；多个副本之间不会共享房间。
- 项目不写入磁盘，因此容器采用只读文件系统，不需要挂载数据卷。
