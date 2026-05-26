# 免费公网部署说明

你的电脑不开机、别人还要能打开网址，就必须把系统放到一个公网平台上运行。

当前项目已经可以用 Docker 部署。推荐优先试：

1. Koyeb 免费 Web Service
2. Render 免费 Web Service
3. Cloudflare Workers/Pages + D1，后续可改成更稳定的免费数据库版

## 重要限制

免费 Web Service 的本地文件通常不是永久存储。也就是说：

- PDF 文件跟随代码部署，是稳定的。
- 生成的卡密如果只存在 `data/store.json`，平台重启或重新部署时可能丢失。

正式卖资料时，建议下一步接免费数据库，例如 Supabase 或 Cloudflare D1。这样卡密和绑定记录不会丢。

## 部署方式

把整个 `C:\Users\35775\Documents\New project` 文件夹上传到 GitHub，然后在免费平台选择：

- Build type: Dockerfile
- Port: `3000`
- Start command: 不用填，Dockerfile 里已经写了

部署完成后，平台会给一个公网网址，例如：

```text
https://你的项目名.koyeb.app
https://你的项目名.onrender.com
```

用户链接：

```text
https://你的项目名.xxx
```

后台链接：

```text
https://你的项目名.xxx/admin
```

默认后台密码仍然是：

```text
admin123
```

登录后台后可以修改。
