import { Api, TelegramClient } from 'telegram';
import path from 'path';
import fs from 'fs-extra';
import config from '../config';
import { getExtension } from 'telegram/Utils';
import { get } from 'lodash';
import { WriteStream } from 'fs';
import bigInt from 'big-integer';
import EventEmitter from 'events';
import logger from './logger';

interface ProgressCallback {
  (downloaded: bigInt.BigInteger, fullSize: bigInt.BigInteger): void;
}

interface DownloadmediaParam {
  client: TelegramClient;
  progressCallback?: ProgressCallback;
  // 如果被暂停下载，则执行pauseCallback方法
  pauseCallback?: () => void;
}

const RequestSize = 64 * 1024;

const TempFilePath = path.join(process.cwd(), 'temp');

class MediaUtil {
  // 保存消息id和对应的EventEmitter
  private msgEventMap = new Map<number, EventEmitter>();

  constructor() {
    this.checkExistPath();
  }

  get savePath(): string {
    return config.getConfig('save_path') as string;
  }

  get tempPath(): string {
    return TempFilePath;
  }


  private checkExistPath() {
    if (!fs.existsSync(this.savePath)) {
      fs.mkdirSync(this.savePath, { recursive: true });
    }

    if (!fs.existsSync(this.tempPath)) {
      fs.mkdirSync(this.tempPath, { recursive: true });
    }
  }

  public downloadFromBuffer(buffer: Buffer, message: Api.Message) {
    let media: Api.TypeMessageMedia | undefined = undefined;
    if (message instanceof Api.Message) {
      media = message.media;
    }

    const extension = getExtension(media);
    let fileName = this.getFileName(media);
    // 这里fileName可能会有文件的后缀名了，需要去掉
    if (fileName.includes('.')) {
      const lastPointIndex = fileName.lastIndexOf('.');
      fileName = fileName.substring(0, lastPointIndex);
    }

    if (!fileName) {
      fileName = message.text;
    }
    if (!fileName) {
      fileName = message.date.toString();
    }

    let saveFileName = fileName;
    const filePathPrefix = config.getConfig('file_path_prefix') as string[];
    if (filePathPrefix.includes('message_id')) {
      saveFileName = `${message.id} - ${fileName}`;
    }

    fs.outputFileSync(`${this.tempPath}/${saveFileName}.${extension}`, buffer);
  }

  // 获取文件名
  private getFileName(media: any): string {
    const attributes = get(media, 'document.attributes', []);
    for (const attribute of attributes) {
      if (attribute instanceof Api.DocumentAttributeFilename) {
        return attribute.fileName;
      }
    }

    return '';
  }

  public getMediaInfo(message: Api.Message | Api.TypeMessageMedia) {
    let media : Api.TypeMessageMedia | undefined =  undefined;
    let fileSize = bigInt.zero;
    let messageId = -1;
    if (message instanceof Api.Message) {
      messageId = message.id;
    }
    if (message instanceof Api.Message) {
      media = message.media;
    }
    if (media instanceof Api.MessageMediaDocument || media instanceof Api.Document) {
      const doc = media.document;
      if (doc instanceof Api.Document) {
        fileSize = doc.size
      }
    }

    const extension = getExtension(media);
    let fileName = this.getFileName(media);
    // 这里fileName可能会有文件的后缀名了，需要去掉
    if (fileName.includes('.')) {
      const lastPointIndex = fileName.lastIndexOf('.');
      fileName = fileName.substring(0, lastPointIndex);
    }

    if (!fileName && message instanceof Api.Message) {
      fileName = message.text;
    }
    if (!fileName && message instanceof Api.Message) {
      fileName = message.date.toString();
    }

    fileName = `${fileName}.${extension}`;
    let saveFileName = fileName;
    const filePathPrefix = config.getConfig('file_path_prefix') as string[];
    if (filePathPrefix.includes('message_id') && messageId >= 0) {
      saveFileName = `${messageId} - ${fileName}`;
    }

    return {
      fileSize,
      fileName: saveFileName,
    }
  }

  public async downloadMedia(
    message: Api.Message,
    { client, progressCallback, pauseCallback }: DownloadmediaParam
  ) {
    const { fileSize, fileName } = this.getMediaInfo(message);
    const tempFilePath = `${this.tempPath}/${fileName}`;
    const writer = fs.createWriteStream(tempFilePath);
    let downloaded = bigInt.zero;
    let media : Api.TypeMessageMedia | undefined =  undefined;
    let messageId

    if (message instanceof Api.Message) {
      media = message.media;
    }

    // 暂停下载
    let isPaused = false;
    // 取消下载
    let isCancel = false;
    let resumePromise: Promise<void> | null = null;
    let resolveResume: (() => void) | null = null;
    const msgEvent = new EventEmitter();

    const pauseDownload = () => {
      logger.info('触发暂停事件');
      isPaused = true;
    };

    const resumeDownload = () => {
      if (isPaused && resolveResume) {
        isPaused = false;
        resolveResume();
        resolveResume = null;
        resumePromise = null;
      }
    };

    const cancelDownload = () => {
      isCancel = true;
    }

    msgEvent.on('pause', pauseDownload);
    msgEvent.on('resume', resumeDownload);
    msgEvent.on('cancel', cancelDownload);
    this.msgEventMap.set(message.id, msgEvent);

    try {

      for await (const chunk of client.iterDownload({
        file: media,
        requestSize: RequestSize,
      })) {
        if (isPaused) {
          // 执行暂停回调
          pauseCallback?.();
          logger.info('暂停下载： ', message.id);
          resumePromise = new Promise((resolve) => {
            resolveResume = resolve;
          });
          await resumePromise;
        }

        if (isCancel) {
          logger.info('取消下载：', message.id);
          return;
        }

        await writer.write(chunk);
        downloaded = downloaded.add(chunk.length);
        if (progressCallback) {
          await progressCallback(downloaded, bigInt(fileSize || bigInt.zero));
        }
      }
      // 将下载好的临时文件移动到指定目录
      const finalFilePath = `${this.savePath}/${fileName}`;
      fs.moveSync(tempFilePath, finalFilePath);
    } finally {
      this.closeWriter(writer);
      this.msgEventMap.delete(message.id);
    }
  }

  // 暂停某个message中的媒体下载
  public pauseDownload(messageId: number) {
    if (this.msgEventMap.has(messageId)) {
      const msgEvent = this.msgEventMap.get(messageId);
      msgEvent?.emit('pause');
    }
  }

  // 恢复某个message中的媒体下载
  public resumeDownload(messageId: number) {
    if (this.msgEventMap.has(messageId)) {
      const msgEvent = this.msgEventMap.get(messageId);
      msgEvent?.emit('resume');
    }
  }

  public closeWriter(writer: WriteStream) {
    if ('close' in writer) {
      writer.close();
    }
  }
}

export default new MediaUtil();
