export interface AppError {
  title:    string
  reason:   string
  solution: string
}

export function parseApiError(raw: string): AppError {
  // AI API errors
  if (raw.includes('Insufficient Balance') || raw.includes('insufficient_quota'))
    return {
      title:    'AI 账户余额不足',
      reason:   '你的 API 账户余额已耗尽，无法继续调用。',
      solution: '前往 platform.deepseek.com（或对应服务商平台）充值，最低 ¥10 可用很久。充值后刷新页面重试。',
    }
  if (raw.includes('401') || raw.includes('invalid_api_key') || raw.includes('Unauthorized') || raw.includes('Authentication'))
    return {
      title:    'API Key 无效',
      reason:   'API Key 不正确、已过期，或存在多余空格。',
      solution: '前往「API 配置」页重新粘贴 Key，确保复制完整（注意不要包含空格）。',
    }
  if (raw.includes('403') || raw.includes('Permission') || raw.includes('Forbidden'))
    return {
      title:    'API Key 无访问权限',
      reason:   'Key 存在但没有调用此接口的权限。',
      solution: '检查服务商平台是否需要开通某功能，或 Key 是否绑定了访问限制。',
    }
  if (raw.includes('429') || raw.includes('rate_limit') || raw.includes('Too Many'))
    return {
      title:    '请求频率超限',
      reason:   '短时间内请求太多，触发了服务商的速率限制。',
      solution: '等待 30-60 秒后再试。如频繁出现，可在服务商平台升级请求速率额度。',
    }
  if (raw.includes('model_not_found') || raw.includes('invalid_model') || raw.includes('does not exist'))
    return {
      title:    '模型名称不存在',
      reason:   '填写的模型 ID 无法被服务商识别。',
      solution: '前往「API 配置」页检查模型名称。DeepSeek 默认填 deepseek-chat，Claude 填 claude-sonnet-4-6。',
    }
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('CORS') || raw.includes('fetch'))
    return {
      title:    '网络连接失败',
      reason:   '浏览器无法连接到 AI 服务器，可能是网络问题或该服务不支持从浏览器直接访问。',
      solution: '检查网络是否正常。如使用 Claude API，需要可访问 api.anthropic.com 的网络环境（可能需要代理）。',
    }
  if (raw.includes('PubMed') || raw.includes('空响应') || raw.includes('esearch') || raw.includes('esummary'))
    return {
      title:    'PubMed 检索失败',
      reason:   'PubMed API 返回了空响应或无效数据，中文关键词是常见原因。',
      solution: '建议改用英文关键词（如"atrial fibrillation"而非"心房颤动"）。也可以先点击 AI 自动翻译按钮。',
    }
  if (raw.includes('500') || raw.includes('502') || raw.includes('503') || raw.includes('504'))
    return {
      title:    '服务器暂时不可用',
      reason:   'AI 服务商的服务器出现临时故障。',
      solution: '通常 1-5 分钟内会自动恢复，稍后重试即可。',
    }
  return {
    title:    '出现了一个错误',
    reason:   raw.length > 200 ? raw.slice(0, 200) + '…' : raw,
    solution: '刷新页面后重试。如问题持续，请检查「API 配置」是否正确。',
  }
}
