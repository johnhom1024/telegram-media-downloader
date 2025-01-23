# telegram-media-downloader

一个轻量的，基于Typescript编写的跨平台telegram机器人，可以下载消息中2GB以内的媒体文件。

## 支持的功能

- 下载2GB内的媒体文件
- 暂停某个正在下载的媒体文件
- 控制并发下载媒体文件的数量
- 实时显示下载速度

还有更多功能等待开发中...

## 本地调试

安装依赖

```bash
pnpm install
```

启动

```bash
pnpm start
```

## 配置信息

程序启动时会读取`config.yaml`文件，配置文件如下：

```yaml
# 机器人token
api_hash: "你的api_hash"
api_id: "你的api_id"
bot_token: "你的机器人token"
# 下载文件的保存路径
save_path: "./downloads"
# 下载文件的最大并发数
max_parallel_download: 5
# 代理信息 如果不需要代理，则不需要填写此项
# proxy:
#   socks_type: 5
#   ip: "192.168.31.210"
#   port: 7221
```

## Todo

- [x] 打包成docker镜像
- [x] 显示下载速度
- [x] 接收bot测试命令
- [x] 完善媒体文件的下载名称
- [x] 改造bot为中间件形态
- [x] 日志自动下载到本地
- [x] 改用流的方式下载
- [x] 接入pm2
- [ ] 启动机器人后发送消息给所有者
- [ ] 设置机器人的指令
- [x] 能够直接针对某个媒体文件暂停或者取消下载
- [x] 能够回复某个媒体文件，识别到之后重新下载

如果你也想贡献代码，欢迎来提Pr。

## 感谢

[gramjs](https://github.com/gram-js/gramjs)

[telegram_media_downloader](https://github.com/tangyoha/telegram_media_downloader)