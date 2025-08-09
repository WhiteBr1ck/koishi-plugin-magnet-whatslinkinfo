import { Context, Schema, h, Logger, Session } from 'koishi'

export const name = 'magnet-whatslinkinfo'

export const using = ['http'] as const

export interface Config {
  apiEndpoint: string
  timeout: number
  useForward: boolean
  showScreenshot: boolean
  debugMode: boolean
  sendSeparately: boolean
}

export const Config: Schema<Config> = Schema.object({
  apiEndpoint: Schema.string().description('whatslink.info 的 API 请求地址。').default('https://whatslink.info/api/v1/link'),
  timeout: Schema.number().description('请求 API 的超时时间（毫秒）。').default(10000),
  useForward: Schema.boolean().description('在 QQ/OneBot 平台使用合并转发的形式发送结果。').default(false),
  showScreenshot: Schema.boolean().description('是否在结果中显示资源截图。').default(true),
  debugMode: Schema.boolean().description('是否开启调试模式。').default(false),
  sendSeparately: Schema.boolean().description('是否将文本和图片作为独立消息分开发送。（此选项与合并转发冲突）').default(false),
})

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)

  ctx.middleware(async (session, next) => {
    const magnetRegex = /(magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40})/gi
    const magnetURI = h.select(session.elements, 'text').map(e => e.attrs.content).join('').match(magnetRegex)?.[0]
    
    if (!magnetURI) return next()

    let placeholderMessageIds: string[]
    try {
      const quote = h('quote', { id: session.messageId })
      placeholderMessageIds = await session.send(h('message', quote, '正在通过 whatslink.info 解析链接，请稍候...'))
      if (config.debugMode) logger.info(`收到链接: ${magnetURI}`)

      const apiResponse = await ctx.http.get(config.apiEndpoint, {
        params: { url: magnetURI },
        timeout: config.timeout,
      })
      if (config.debugMode) logger.info(`收到 API 响应`)

      if (!apiResponse) throw new Error('API 未返回任何数据')
      
      //  接收一个消息数组，并循环发送
      const messagesToSend = await formatApiResponse(ctx, session, apiResponse, config, logger)
      for (const message of messagesToSend) {
        await session.send(message)
      }

    } catch (error) {
      logger.error('插件执行出错:', error)
      await session.send(h('message', h('quote', { id: session.messageId }), '解析失败，可能是网络问题或 API 暂时不可用。'))
    } finally {
      if (placeholderMessageIds?.length > 0) {
        if (config.debugMode) logger.info(`任务完成，撤回提示消息。`)
        try { await session.bot.deleteMessage(session.channelId, placeholderMessageIds[0]) } catch {}
      }
    }
  })
}

function formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

async function formatApiResponse(ctx: Context, session: Session, data: any, config: Config, logger: Logger): Promise<(h | string)[]> {
  const fileTypeIcons = {
    folder: '📁', video: '🎬', audio: '🎵', archive: '📦',
    image: '🖼️', document: '📄', text: '📝', font: '🔠', unknown: '❓',
  }

  // 构建文本内容
  let textContent = `✅ 解析成功\n`
  textContent += `--------------------------\n`
  if (data.file_type) {
    const icon = fileTypeIcons[data.file_type] || '❓'
    textContent += `${icon} 内容类型: ${data.file_type}\n`
  }
  textContent += `📝 资源名称: ${data.name}\n`
  textContent += `💾 总大小: ${formatBytes(data.size)}\n`
  textContent += `🧩 文件数量: ${data.count}\n` 
  
  const hasScreenshots = config.showScreenshot && Array.isArray(data.screenshots) && data.screenshots.length > 0
  
  if (hasScreenshots) {
    textContent += `--------------------------\n🖼️ 截图预览:`
  }
  
  // 构建图片 h 元素列表
  const imageElements: h[] = []
  if (hasScreenshots) {
    if (config.debugMode) logger.debug('API 返回的 screenshots 数据: %o', data.screenshots)
    
    for (const item of data.screenshots) {
      let imageUrl: string | null = null
      if (item && typeof item.screenshot === 'string' && item.screenshot.startsWith('http')) {
        imageUrl = item.screenshot
      } else if (typeof item === 'string' && item.startsWith('http')) {
        imageUrl = item
      }
      
      if (imageUrl) {
        try {
          const buffer = await ctx.http.get(imageUrl, { responseType: 'arraybuffer' })
          imageElements.push(h.image(buffer, 'image/jpeg'))
        } catch (err) {
          logger.warn(`代理下载图片失败: ${imageUrl}, 错误: ${err.message}`)
        }
      }
    }
  }


  if (config.sendSeparately) {
    // 分开发送：返回一个数组，第一项是文本，后面是N张图片
    const messages: (h | string)[] = []
    messages.push(h('message', textContent))
    imageElements.forEach(imgElement => {
      messages.push(h('message', imgElement))
    })
    return messages
  } else {
    // 单个消息块发送：将所有元素放入一个消息块中返回
    const children = [textContent, ...imageElements] // 将所有要发送的元素放入一个数组

    if (config.useForward && ['qq', 'onebot'].includes(session.platform)) {
      // 明确地将 children 数组作为第三个参数传递
      return [h('figure', {}, children)]
    } else {
      // 明确地将 children 数组作为第三个参数传递
      return [h('message', {}, children)]
    }
  }
}