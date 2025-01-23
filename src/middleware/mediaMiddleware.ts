import { formatBigIntToMB, textToHash } from '../utils';
import { MiddlewareFn, MiddlewareObj } from '../utils/composer';
import { downloadStat } from '../utils/speed';
import { Api, errors, TelegramClient } from 'telegram';
import { NewMessageEvent } from 'telegram/events';
import mediaUtil from '../utils/downloadMedia';
import { DownloadMessage } from '../utils/downloadMessage';
import { QueueLimit } from '../utils/queue';
import { CallbackQueryEvent } from 'telegram/events/CallbackQuery';
import { Button } from 'telegram/tl/custom/button';
import logger from '../utils/logger';

interface Props {
  client: TelegramClient;
  sendTo: Api.User;
}

export class MediaDownloadMiddleware implements MiddlewareObj {
  client: TelegramClient;
  // 发送消息的时间间隔 单位ms
  private sendDuration = 1500;
  // 如果消息发送太频繁，可能会报错，这里加一个变量判断是否能发送
  private canEditMessage = true;
  // 下载池，放置msgId，代表当前等待下载的消息
  private pool: number[] = [];
  private currentEditMsgId: number | undefined = undefined;
  queueLimit: QueueLimit;
  public sendToUser: Api.User;

  constructor({ client, sendTo }: Props) {
    this.client = client;
    this.sendToUser = sendTo;
    this.queueLimit = new QueueLimit(global.appConfig.max_parallel_download);
  }

  middleware<T extends NewMessageEvent>(): MiddlewareFn<T> {
    return async (ctx, next) => {
      const message = ctx.message;
      logger.info('准备下载消息中的媒体文件：', message.id);
      const replyMessage = await this.client.sendMessage(this.sendToUser.id, {
        message: '等待中...',
        replyTo: message.id,
      });

      const pausePattern = {
        type: 'pause',
        messageId: message.id,
      };
      const pauseButton = Button.inline(
        '暂停',
        Buffer.from(JSON.stringify(pausePattern))
      );

      this.queueLimit.add(async () => {
        await this.client.editMessage(this.sendToUser.id, {
          message: replyMessage.id,
          text: '正在下载...',
          buttons: [pauseButton],
        });

        let sending = false;
        let lastMessageHash = '';
        let lastSendTime: number = 0;
        const downloadMsg = new DownloadMessage({
          messageId: message.id,
          total: 0,
        });

        await mediaUtil.downloadMedia(message, {
          client: this.client,
          progressCallback: async (download, total) => {
            const downloaded = formatBigIntToMB(download);
            const totalInMB = formatBigIntToMB(total);
            downloadMsg.update({ downloaded, total: totalInMB });
            downloadMsg.setPause(false);

            const now = Date.now();
            if (now - lastSendTime < this.sendDuration) {
              return;
            }

            if (!this.canEditMessage) {
              return;
            }

            if (
              this.currentEditMsgId !== undefined &&
              this.currentEditMsgId !== message.id
            ) {
              if (!this.pool.includes(message.id)) {
                this.pool.push(message.id);
              }
              return;
            }

            if (this.currentEditMsgId === undefined) {
              this.currentEditMsgId = message.id;
            }

            downloadStat.updateDownloadResult({
              messageId: message.id,
              downloaded: Number(download),
            });

            const speed = downloadStat.getSpeed(message.id);

            downloadMsg.update({
              downloaded: downloaded,
              total: totalInMB,
              speed,
            });

            const downloadMessage = downloadMsg.getMessage();

            const downloadHash = textToHash(downloadMessage);

            if (!sending && lastMessageHash !== downloadHash) {
              sending = true;

              try {
                await this.client.editMessage(this.sendToUser.id, {
                  message: replyMessage.id,
                  text: this.formatMessage(downloadMessage),
                  parseMode: 'html',
                  buttons: [pauseButton],
                });
              } catch (error) {
                logger.error(error);
                if (error instanceof errors.FloodWaitError) {
                  this.canEditMessage = false;
                  setTimeout(() => {
                    this.canEditMessage = true;
                  }, error.seconds * 1000);
                }
              }

              sending = false;
              lastSendTime = Date.now();
              lastMessageHash = downloadHash;
            }
          },
          pauseCallback: async () => {
            const downloadMessage = downloadMsg.setPause(true);

            const continuePattern = {
              type: 'continue',
              messageId: message.id,
            };

            this.currentEditMsgId = undefined;

            const continueButton = Button.inline(
              '继续',
              Buffer.from(JSON.stringify(continuePattern))
            );
            await this.client.editMessage(this.sendToUser.id, {
              message: replyMessage.id,
              text: this.formatMessage(downloadMessage),
              parseMode: 'html',
              buttons: [continueButton],
            });
          },
        });

        // 下载完成之后
        // 修改lastMessage
        const finishedMessage = downloadMsg.finish();
        downloadStat.remove(message.id);

        this.client.editMessage(this.sendToUser.id, {
          message: replyMessage.id,
          text: this.formatMessage(finishedMessage),
          parseMode: 'html',
        });

        logger.info('下载完成', message.id);

        // 可能某个不处于编辑的消息下载好了，判断是否在下载池内，需要从下载池中移除
        if (this.pool.includes(message.id)) {
          this.pool = this.pool.filter((id) => id !== message.id);
        }

        // 如果是当前正在编辑的messageId下载好了，则从下载池中取出来最新的
        if (this.currentEditMsgId === message.id) {
          // 从下载池中取出第一个值，然后赋值给currentEditMsgId
          const firstMsgId = this.pool.shift();
          if (firstMsgId) {
            this.currentEditMsgId = firstMsgId;
          } else {
            this.currentEditMsgId = undefined;
          }
        }
      });
    };
  }

  private formatMessage(message: string) {
    return `<code>${message}</code>`;
  }

  // 用户点击了按钮之后，会触发这里的回调中间件
  callbackMiddleware<T extends CallbackQueryEvent>(): MiddlewareFn<T> {
    return (ctx, next) => {
      const data = ctx.data;
      // 将data转成string，这里data是Buffer
      const dataStr = data?.toString();
      if (dataStr) {
        const pattern = JSON.parse(dataStr);
        const { type } = pattern;
        switch (type) {
          case 'pause':
            {
              const { messageId } = pattern;
              if (messageId) {
                mediaUtil.pauseDownload(messageId);
                ctx.answer();
                return;
              }
            }
            break;
          case 'continue':
            {
              const { messageId } = pattern;
              if (messageId) {
                mediaUtil.resumeDownload(messageId);
                ctx.answer();
                return;
              }
            }
            break;
        }
      }
    };
  }
}
