const { helpers } = require('./db');
const https = require('https');

class AIProvider {
  async enhanceText(text, prompt) { throw new Error('Not implemented'); }
  async reviewText(text, prompt) { throw new Error('Not implemented'); }
}

class YandexGPTProvider extends AIProvider {
  constructor(folderId, apiKey) {
    super();
    this.folderId = folderId;
    this.apiKey = apiKey;
  }

  async _request(systemPrompt, userText) {
    if (!this.folderId || !this.apiKey) {
      throw new Error('YandexGPT не настроен (отсутствует Folder ID или API Key)');
    }

    const data = JSON.stringify({
      modelUri: `gpt://${this.folderId}/yandexgpt/latest`,
      completionOptions: {
        stream: false,
        temperature: 0.3,
        maxTokens: "2000"
      },
      messages: [
        { role: "system", text: systemPrompt },
        { role: "user", text: userText }
      ]
    });

    const options = {
      hostname: 'llm.api.cloud.yandex.net',
      path: '/foundationModels/v1/completion',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${this.apiKey}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => responseBody += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const result = JSON.parse(responseBody);
              const text = result.result.alternatives[0].message.text;
              resolve(text);
            } catch (e) {
              reject(new Error('Ошибка парсинга ответа YandexGPT'));
            }
          } else {
            reject(new Error(`YandexGPT API Error: ${res.statusCode} ${responseBody}`));
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async enhanceText(text, prompt) {
    return this._request(prompt, text);
  }

  async reviewText(text, prompt) {
    return this._request(prompt, text);
  }
}

function getAIProvider() {
  const provider = helpers.getSetting('ai_provider') || 'yandexgpt';
  if (provider === 'yandexgpt') {
    return new YandexGPTProvider(
      helpers.getSetting('ai_folder_id'),
      helpers.getSetting('ai_api_key')
    );
  }
  throw new Error(`AI Provider ${provider} is not supported yet.`);
}

async function enhanceText(text) {
  const provider = getAIProvider();
  const prompt = helpers.getSetting('ai_prompt_fill') || 'Исправь грамматику и стиль текста. Верни только исправленный текст.';
  return await provider.enhanceText(text, prompt);
}

async function reviewText(text) {
  const provider = getAIProvider();
  const prompt = helpers.getSetting('ai_prompt_review') || 'Проанализируй текст и верни список замечаний. Если замечаний нет, напиши "Замечаний нет".';
  return await provider.reviewText(text, prompt);
}

module.exports = { enhanceText, reviewText };
