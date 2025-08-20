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
  customUserAgent: string // 新增：自定义 User-Agent
  useLocalParsing: boolean // 新增：本地解析选项
}

// 本地解析 magnet 链接
function parseLocalMagnet(magnetURI: string) {
  try {
    // 测试是否支持这些 API
    if (typeof URL === 'undefined' || typeof URLSearchParams === 'undefined') {
      console.log('当前环境不支持 URL 解析 API，将使用手动解析')
      throw new Error('当前环境不支持 URL 解析 API')
    }
    
    console.log('使用 URL API 解析 magnet 链接:', magnetURI)
    const url = new URL(magnetURI)
    const params = new URLSearchParams(url.search)
    
    const xt = params.get('xt') // 哈希值
    const dn = params.get('dn') // 显示名称
    const tr = params.getAll('tr') // tracker 列表
    const xl = params.get('xl') // 文件大小（如果有）
    
    const result = {
      hash: xt?.replace('urn:btih:', ''),
      name: dn ? decodeURIComponent(dn) : '未知资源',
      trackers: tr,
      size: xl ? parseInt(xl) : null
    }
    
    console.log('URL API 解析结果:', result)
    return result
  } catch (error) {
    console.log('URL API 解析失败:', error.message)
    return null
  }
}

// 备用的手动解析方案
function parseLocalMagnetManual(magnetURI: string) {
  try {
    console.log('使用手动解析 magnet 链接:', magnetURI)
    
    if (!magnetURI.startsWith('magnet:?')) {
      console.log('不是有效的 magnet 链接')
      return null
    }
    
    const params = magnetURI.substring(8) // 移除 'magnet:?'
    const pairs = params.split('&')
    console.log('解析到的参数对:', pairs)
    
    const result = {
      hash: '',
      name: '未知资源',
      trackers: [] as string[],
      size: null as number | null
    }
    
    for (const pair of pairs) {
      const [key, value] = pair.split('=', 2)
      if (!value) continue
      
      const decodedValue = decodeURIComponent(value)
      console.log(`处理参数: ${key} = ${decodedValue}`)
      
      switch (key) {
        case 'xt':
          if (decodedValue.startsWith('urn:btih:')) {
            result.hash = decodedValue.substring(9)
            console.log('提取到哈希值:', result.hash)
          }
          break
        case 'dn':
          result.name = decodedValue
          console.log('提取到名称:', result.name)
          break
        case 'tr':
          result.trackers.push(decodedValue)
          console.log('添加 tracker:', decodedValue)
          break
        case 'xl':
          const size = parseInt(decodedValue)
          if (!isNaN(size)) {
            result.size = size
            console.log('提取到大小:', result.size)
          }
          break
      }
    }
    
    console.log('手动解析最终结果:', result)
    return result.hash ? result : null
  } catch (error) {
    console.log('手动解析失败:', error.message)
    return null
  }
}

// 格式化文件大小
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export const Config: Schema<Config> = Schema.object({
  apiEndpoint: Schema.string().description('whatslink.info 的 API 请求地址。').default('https://whatslink.info/api/v1/link'),
  timeout: Schema.number().description('请求 API 的超时时间（毫秒）。').default(10000),
  customUserAgent: Schema.string().description('请求 API 时使用的 User-Agent，留空则使用 koishi 默认值。建议设置为浏览器 UA。').default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'),
  useForward: Schema.boolean().description('在 QQ/OneBot 平台使用合并转发的形式发送结果。').default(false),
  showScreenshot: Schema.boolean().description('是否在结果中显示资源截图。').default(true),
  debugMode: Schema.boolean().description('是否开启调试模式。').default(false),
  sendSeparately: Schema.boolean().description('是否将文本和图片作为独立消息分开发送。（此选项与合并转发冲突）').default(false),
  useLocalParsing: Schema.boolean().description('API 失败时使用本地解析（仅解析基本信息）').default(true),
})

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)
  let lastRequestTime = 0
  const minInterval = 3000 // 最小请求间隔 3 秒

  ctx.middleware(async (session, next) => {
    // 修复正则表达式，匹配完整的 magnet 链接
    const magnetRegex = /(magnet:\?[^\s]+)/gi
    const magnetURI = h.select(session.elements, 'text').map(e => e.attrs.content).join('').match(magnetRegex)?.[0]
    
    if (!magnetURI) return next()

    // 验证是否包含必要的哈希信息
    if (!magnetURI.includes('xt=urn:btih:')) {
      return next()
    }

    // 检查请求间隔
    const now = Date.now()
    if (now - lastRequestTime < minInterval) {
      await session.send(h('message', h('quote', { id: session.messageId }), `请求过于频繁，请等待 ${Math.ceil((minInterval - (now - lastRequestTime)) / 1000)} 秒后再试`))
      return
    }
    lastRequestTime = now

    let placeholderMessageIds: string[]
    try {
      const quote = h('quote', { id: session.messageId })
      placeholderMessageIds = await session.send(h('message', quote, '正在通过 whatslink.info 解析链接，请稍候...'))
      if (config.debugMode) logger.info(`收到链接: ${magnetURI}`)

      if (config.debugMode) {
        logger.info(`发送 API 请求到: ${config.apiEndpoint}`)
        logger.info(`请求参数: url=${magnetURI}`)
        logger.info(`使用 User-Agent: ${config.customUserAgent}`)
      }

      const apiResponse = await ctx.http.get(config.apiEndpoint, {
        params: { url: magnetURI },
        timeout: config.timeout,
        headers: {
          // 使用配置中的 User-Agent
          'User-Agent': config.customUserAgent,
        }
      })
      
      // 添加完整的 API 响应日志
      if (config.debugMode) {
        logger.info(`收到 API 响应`)
        logger.info(`完整 API 响应:`, JSON.stringify(apiResponse, null, 2))
      }

      if (!apiResponse) throw new Error('API 未返回任何数据')

      // 更完整的错误检查
      if (apiResponse.error || apiResponse.message) {
        const errorMsg = apiResponse.error || apiResponse.message
        logger.warn(`API 返回错误: ${errorMsg}`)
        
        // 检查是否是配额限制相关的错误
        if (errorMsg.toLowerCase().includes('quota') || 
            errorMsg.toLowerCase().includes('limit') || 
            errorMsg.toLowerCase().includes('frequent') ||
            errorMsg.toLowerCase().includes('rate')) {
          
          // 如果启用了本地解析，尝试降级到本地解析
          if (config.useLocalParsing) {
            logger.info('API 配额限制，尝试使用本地解析作为降级方案')
            logger.info('要解析的 magnet 链接:', magnetURI)
            
            let localResult = parseLocalMagnet(magnetURI)
            if (!localResult) {
              // 如果 URL API 不可用，尝试手动解析
              logger.info('URL API 解析失败，尝试手动解析')
              localResult = parseLocalMagnetManual(magnetURI)
            }
            
            logger.info('本地解析结果:', localResult)
            
            if (localResult && localResult.hash) {
              logger.info('本地解析成功，发送结果')
              const sizeText = localResult.size ? formatBytes(localResult.size) : '未知'
              
              // 检查是否获取到有用信息
              const hasUsefulInfo = localResult.name !== '未知资源' || localResult.size !== null || localResult.trackers.length > 0
              
              let message = `⚠️ API 配额限制，使用本地解析\n\n🧲 Magnet 链接信息\n📝 名称: ${localResult.name}\n🔗 哈希: ${localResult.hash}\n💾 大小: ${sizeText}\n📡 Tracker 数量: ${localResult.trackers.length}`
              
              if (!hasUsefulInfo) {
                message += `\n\n⚠️ 此 magnet 链接信息不完整，仅包含哈希值\n💡 建议：尝试从原始来源获取完整的 magnet 链接`
              } else {
                message += `\n\n💡 注意：本地解析仅提供基本信息，无截图和详细文件列表`
              }
              
              await session.send(h('message', h('quote', { id: session.messageId }), message))
              return
            } else {
              logger.warn('本地解析也失败了')
              await session.send(h('message', h('quote', { id: session.messageId }), '解析失败，本地解析也无法处理此链接。'))
              return
            }
          } else {
            await session.send(h('message', h('quote', { id: session.messageId }), 
              `解析失败：API 配额限制 - ${errorMsg}\n\n` +
              `可能原因：whatslink.info 对非公共网站有配额限制，建议：\n` +
              `1. 降低请求频率\n` +
              `2. 考虑联系 API 提供商申请更高配额`))
            return
          }
        } else {
          await session.send(h('message', h('quote', { id: session.messageId }), `解析失败：${errorMsg}`))
          return
        }
      }

      // 检查是否缺少必要字段
      if (!apiResponse.name || !apiResponse.size) {
        logger.warn(`API 响应缺少必要字段:`, apiResponse)
        await session.send(h('message', h('quote', { id: session.messageId }), `解析失败：API 返回数据不完整`))
        return
      }

      // 检查返回内容是否为错误信息 (保留原有逻辑作为备用)
      if (apiResponse.name && typeof apiResponse.name === 'string' && apiResponse.name.toLowerCase().includes('frequent')) {
        logger.warn(`API 返回请求频繁错误: ${apiResponse.name}`)
        await session.send(h('message', h('quote', { id: session.messageId }), `解析失败：${apiResponse.name}`))
        return
      }

      //  接收一个消息数组，并循环发送
      const messagesToSend = await formatApiResponse(ctx, session, apiResponse, config, logger)
      for (const message of messagesToSend) {
        await session.send(message)
      }    } catch (error) {
      logger.error('插件执行出错:', error)
      
      // 如果启用了本地解析，尝试降级到本地解析
      if (config.useLocalParsing) {
        logger.info('尝试使用本地解析作为降级方案')
        logger.info('要解析的 magnet 链接:', magnetURI)
        
        let localResult = parseLocalMagnet(magnetURI)
        if (!localResult) {
          // 如果 URL API 不可用，尝试手动解析
          logger.info('URL API 解析失败，尝试手动解析')
          localResult = parseLocalMagnetManual(magnetURI)
        }
        
        logger.info('本地解析结果:', localResult)
        
        if (localResult && localResult.hash) {
          logger.info('本地解析成功，发送结果')
          const sizeText = localResult.size ? formatBytes(localResult.size) : '未知'
          
          // 检查是否获取到有用信息
          const hasUsefulInfo = localResult.name !== '未知资源' || localResult.size !== null || localResult.trackers.length > 0
          
          let message = `⚠️ API 解析失败，使用本地解析\n\n🧲 Magnet 链接信息\n📝 名称: ${localResult.name}\n🔗 哈希: ${localResult.hash}\n💾 大小: ${sizeText}\n📡 Tracker 数量: ${localResult.trackers.length}`
          
          if (!hasUsefulInfo) {
            message += `\n\n⚠️ 此 magnet 链接信息不完整，仅包含哈希值\n💡 建议：尝试从原始来源获取完整的 magnet 链接`
          } else {
            message += `\n\n💡 注意：本地解析仅提供基本信息，无截图和详细文件列表`
          }
          
          await session.send(h('message', h('quote', { id: session.messageId }), message))
        } else {
          logger.warn('本地解析也失败了')
          await session.send(h('message', h('quote', { id: session.messageId }), '解析失败，本地解析也无法处理此链接。'))
        }
      } else {
        logger.info('本地解析功能未启用')
        await session.send(h('message', h('quote', { id: session.messageId }), '解析失败，可能是网络问题或 API 暂时不可用。'))
      }
    } finally {
      if (placeholderMessageIds?.length > 0) {
        if (config.debugMode) logger.info(`任务完成，撤回提示消息。`)
        try { await session.bot.deleteMessage(session.channelId, placeholderMessageIds[0]) } catch {}
      }
    }
  })
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