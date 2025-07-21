import { Context, Schema, h, Logger, Session } from 'koishi'

export const name = 'magnet-whatslinkinfo'

export const using = ['http'] as const

export interface Config {
  apiEndpoint: string
  timeout: number
  useForward: boolean
  showScreenshot: boolean
  debugMode: boolean
}

export const Config: Schema<Config> = Schema.object({
  apiEndpoint: Schema.string().description('whatslink.info 的 API 请求地址。').default('https://whatslink.info/api/v1/link'),
  timeout: Schema.number().description('请求 API 的超时时间（毫秒）。').default(10000),
  useForward: Schema.boolean().description('在 QQ/OneBot 平台使用合并转发的形式发送结果。').default(false),
  showScreenshot: Schema.boolean().description('是否在结果中显示资源截图。').default(true),
  debugMode: Schema.boolean().description('是否开启调试模式。').default(false),
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
      
      const finalMessage = await formatApiResponse(ctx, session, apiResponse, config, logger)
      await session.send(finalMessage)

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

async function formatApiResponse(ctx: Context, session: Session, data: any, config: Config, logger: Logger) {
  const fileTypeIcons = {
    folder: '📁', video: '🎬', audio: '🎵', archive: '📦',
    image: '🖼️', document: '📄', text: '📝', font: '🔠', unknown: '❓',
  }

  const elements: (h | string)[] = []

  let textContent = `✅ 解析成功\n`
  textContent += `--------------------------\n`
  if (data.file_type) {
    const icon = fileTypeIcons[data.file_type] || '❓'
    textContent += `${icon} 内容类型: ${data.file_type}\n`
  }
  textContent += `📝 资源名称: ${data.name}\n`
  textContent += `💾 总大小: ${formatBytes(data.size)}\n`
  textContent += `🧩 文件数量: ${data.count}\n` 
  
  if (config.showScreenshot && Array.isArray(data.screenshots) && data.screenshots.length > 0) {
    textContent += `--------------------------\n🖼️ 截图预览:`
  }
  
  elements.push(textContent)

  if (config.showScreenshot && Array.isArray(data.screenshots) && data.screenshots.length > 0) {
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
          elements.push(h.image(buffer, 'image/jpeg'))
        } catch (err) {
          logger.warn(`代理下载图片失败: ${imageUrl}, 错误: ${err.message}`)
        }
      }
    }
  }

  if (config.useForward && ['qq', 'onebot'].includes(session.platform)) {
    return h('figure', ...elements)
  } else {
    return h('message', ...elements)
  }
}