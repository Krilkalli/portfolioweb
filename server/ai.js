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
        maxTokens: "8000"
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

class OpenAIProvider extends AIProvider {
  constructor(apiKey, baseURL, model) {
    super();
    this.apiKey = apiKey;
    this.baseURL = baseURL || 'https://ai.wormsoft.ru/api/gpt';
    this.model = model || 'openai/gpt-5.4-mini';
  }

  async _request(systemPrompt, userText) {
    const data = JSON.stringify({
      model: this.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ]
    });

    const url = new URL(`${this.baseURL.replace(/\/+$/, '')}/chat/completions`);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'http:' ? require('http') : https;
      const req = protocol.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => responseBody += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const result = JSON.parse(responseBody);
              const text = result.choices[0].message.content;
              resolve(text);
            } catch (e) {
              reject(new Error('Ошибка парсинга ответа OpenAI API'));
            }
          } else {
            reject(new Error(`OpenAI API Error: ${res.statusCode} ${responseBody}`));
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async enhanceText(text, prompt) { return this._request(prompt, text); }
  async reviewText(text, prompt) { return this._request(prompt, text); }
}

async function getAIProvider() {
  const provider = await helpers.getSetting('ai_provider') || 'yandexgpt';
  if (provider === 'yandexgpt') {
    return new YandexGPTProvider(
      await helpers.getSetting('ai_folder_id'),
      await helpers.getSetting('ai_api_key')
    );
  } else if (provider === 'openai') {
    return new OpenAIProvider(
      await helpers.getSetting('ai_api_key'),
      await helpers.getSetting('ai_base_url'),
      await helpers.getSetting('ai_model_name')
    );
  }
  throw new Error(`AI Provider ${provider} is not supported yet.`);
}

async function enhanceText(text) {
  const provider = await getAIProvider();
  const prompt = await helpers.getSetting('ai_prompt_fill') || 'Исправь грамматику и стиль текста. Верни только исправленный текст.';
  return await provider.enhanceText(text, prompt);
}

async function reviewText(text) {
  const provider = await getAIProvider();
  let prompt = await helpers.getSetting('ai_prompt_review') || 'Проанализируй текст и верни список замечаний. Если замечаний нет, напиши "Замечаний нет".';
  return await provider.reviewText(text, prompt);
}

async function reviewJSONData(data) {
  const provider = await getAIProvider();
  
  const rules = `
Правила заполнения полей:
- ВСЕ ПОЛЯ являются ОБЯЗАТЕЛЬНЫМИ. Сначала проверь, есть ли пустые поля (empty string, null, пустой массив). Если поле пустое, это ОШИБКА.
- ЗАТЕМ проверь ЗАПОЛНЕННЫЕ поля на орфографию, стилистику и СТРОГОЕ соответствие следующим форматам:
- Образование: должно содержать [Наименование учебного заведения, без сокращения], [Квалификация/Ученая степень], [Направление], [Год окончания]
- Текущая занимаемая должность, Город, Адрес эл. почты
- Стаж работы (total_experience): [Общий стаж работы сотрудника]
- Стаж работы в 1С (experience): [Наименование компании] [Должность] + [Период работы в формате ММ.ДДДД - ММ.ДДДД]
- Обо мне: Указывать роли, опыт, технологии. Пример: "Работаю с 1С в франчайзинге более 6 лет. Технический лидер с опытом управления командой... Могу выполнять несколько ролей..."
- Проектный опыт: Для каждого проекта должно быть указано: [Период работы ММ.ГГГГ - ММ.ГГГГ], [Должность сотрудника на проекте], [Роль сотрудника], [Размер команды], [Наименование Заказчика + отрасль], [Описание проекта], [Описание задачи (Роль; Задача; Технологический стек; Цель выполняемой задачи)], [Программные продукты / стек].
- Сертификация 1С: [Полное наименование сертификата 1C] (Например: 1С:Профессионал. ERP Управление предприятием 2)
- Компетенции: Должны включать навыки по чек-листу для Архитектора (Проектирование систем, Управление требованиями, Экспертиза в 1С:ERP/ЗУП...), Разработчика (Платформа 1С, СКД, интеграции REST/SOAP, XML/JSON, Git...) или Аналитика (BPMN, EPC, сбор требований, тестирование...).
`;

  let prompt = `Проанализируй переданные данные анкеты сотрудника. 
Ты должен найти ДВА типа ошибок:
1. Незаполненные (пустые) поля.
2. Неправильно заполненные поля (ошибки в орфографии, стиле, или несоответствие формату из Правил).

${rules}

ВНИМАНИЕ: Верни результат СТРОГО в формате JSON массива объектов. 
Если есть ошибки (любого из двух типов), для каждой ошибки верни объект:
{"field": "КЛЮЧ_ПОЛЯ_ИЗ_ПЕРЕДАННОГО_JSON", "error": "Описание ошибки на русском языке", "suggestion": "Готовый исправленный или улучшенный текст"}

ВАЖНОЕ ТРЕБОВАНИЕ К ТЕКСТУ ОШИБОК:
В поле "error" категорически ЗАПРЕЩЕНО использовать английские слова или ключи из JSON (например, не пиши 'degree', 'specialty', 'year'). Описывай проблему только понятным русским языком (например: "Не указана квалификация", "Не указан год окончания").

ВАЖНОЕ ТРЕБОВАНИЕ К ПОДСКАЗКАМ:
Для полей-массивов (education, experience, project_experience) в поле "suggestion" возвращай ТОЛЬКО понятный текстовый совет (человекочитаемый текст), как именно нужно заполнить данные, без JSON разметки и без массивов!

Если всё идеально, верни пустой массив: []
Никакого другого текста, только JSON массив.`;

  const result = await provider.reviewText(JSON.stringify(data), prompt);
  
  let jsonStr = result.trim();
  const match = jsonStr.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/);
  if (match && match[1]) {
    jsonStr = match[1];
  } else {
    const firstBrace = jsonStr.indexOf('[');
    const lastBrace = jsonStr.lastIndexOf(']');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }
  }
  
  try {
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    console.error('Failed to parse AI review JSON:', jsonStr);
    return [];
  }
}

async function enhanceJSON(data) {
  const provider = await getAIProvider();
  let prompt = await helpers.getSetting('ai_prompt_fill') || 'Исправь грамматику и стиль текста. Верни только исправленный текст.';
  
  prompt += '\n\nВНИМАНИЕ: Тебе передан JSON объект со всеми полями анкеты. Исправь грамматику, стилистику и орфографию во всех текстовых значениях. Обязательно верни СТРОГО валидный JSON с ТОЧНО такой же структурой и ключами, как в оригинале. Никакого текста или markdown, только сырой JSON.';
  
  const result = await provider.enhanceText(JSON.stringify(data), prompt);
  
  let jsonStr = result.trim();
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    jsonStr = match[1];
  } else {
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }
  }
  
  try {
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    console.error('Failed to parse AI enhanced JSON:', jsonStr);
    throw new Error('ИИ вернул неверный формат JSON');
  }
async function summarizeFeedback(feedbacks) {
  const provider = await getAIProvider();
  const prompt = await helpers.getSetting('ai_prompt_summarize') || 'Ты опытный HR-аналитик. Проанализируй список отзывов сотрудников о компании и составь краткое резюме: выдели основные плюсы, минусы и общие настроения.';
  
  const textToAnalyze = feedbacks.map((f, i) => `Отзыв ${i + 1} (Оценка: ${f.rating}/5):\n${f.comment}`).join('\n\n');
  return await provider.reviewText(textToAnalyze, prompt);
}

module.exports = {
  enhanceText,
  reviewText,
  reviewJSONData,
  enhanceJSON,
  summarizeFeedback
};
