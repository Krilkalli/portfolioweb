const { helpers, initPromise, pool } = require('../server/db');

const targetTokens = Math.max(1, Number(process.env.TARGET_TOKENS || 500000));
const concurrency = Math.max(1, Math.min(10, Number(process.env.BENCH_CONCURRENCY || 8)));
const batchDelayMs = Math.max(1000, Number(process.env.BENCH_BATCH_DELAY_MS || 12000));
const models = String(process.env.BENCH_MODELS || 'gemini-2.5-flash,gpt-5.4-mini,claude-sonnet-4-6')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const syntheticPortfolio = Array.from({ length: 70 }, (_, index) => (
  `Запись ${index + 1}: консультант участвовал во внедрении 1С:ERP; `
  + 'функциональные области — казначейство, бюджетирование и документооборот; '
  + 'задачи — сбор требований, подготовка проектной документации, постановка задач разработчикам, '
  + 'тестирование интеграций REST и обучение пользователей; результат — процесс переведён в промышленную эксплуатацию.'
)).join('\n');

const systemPrompt = [
  'Ты проверяешь синтетическое портфолио сотрудника.',
  'Найди не более трёх повторяющихся формулировок и предложи компактную редакцию.',
  'Верни только валидный JSON-массив объектов с ключами problem и suggestion без Markdown.',
].join(' ');

const stats = Object.fromEntries(models.map(model => [model, {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  latencyMs: [],
  errors: {},
}]));

let apiKey = '';
let baseUrl = '';
let successfulRequests = 0;
let failedRequests = 0;
let consumedTokens = 0;
let requestNumber = 0;
let consecutiveCriticalErrors = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function makeRequest(model) {
  const number = ++requestNumber;
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Номер теста: ${number}.\n${syntheticPortfolio}` },
        ],
      }),
      signal: AbortSignal.timeout(180000),
    });
    const data = await response.json().catch(() => ({}));
    const elapsed = Date.now() - startedAt;
    if (!response.ok) {
      const code = String(response.status);
      stats[model].errors[code] = (stats[model].errors[code] || 0) + 1;
      failedRequests += 1;
      const message = data?.error?.message || data?.message || 'Неизвестная ошибка API';
      console.log(`ERROR model=${model} status=${response.status} ms=${elapsed} message=${JSON.stringify(message)}`);
      return { ok: false, status: response.status };
    }

    const usage = data.usage || {};
    const promptTokens = Number(usage.prompt_tokens || 0);
    const completionTokens = Number(usage.completion_tokens || 0);
    const totalTokens = Number(usage.total_tokens || promptTokens + completionTokens);
    stats[model].requests += 1;
    stats[model].promptTokens += promptTokens;
    stats[model].completionTokens += completionTokens;
    stats[model].totalTokens += totalTokens;
    stats[model].latencyMs.push(elapsed);
    successfulRequests += 1;
    consumedTokens += totalTokens;
    consecutiveCriticalErrors = 0;
    return { ok: true, status: response.status, totalTokens };
  } catch (error) {
    const code = error?.name === 'TimeoutError' ? 'timeout' : 'network';
    stats[model].errors[code] = (stats[model].errors[code] || 0) + 1;
    failedRequests += 1;
    console.log(`ERROR model=${model} status=${code} message=${JSON.stringify(error.message)}`);
    return { ok: false, status: code };
  }
}

function progress() {
  const percent = Math.min(100, consumedTokens / targetTokens * 100).toFixed(1);
  console.log(`PROGRESS tokens=${consumedTokens}/${targetTokens} percent=${percent} success=${successfulRequests} failed=${failedRequests}`);
}

function summary() {
  return {
    targetTokens,
    consumedTokens,
    successfulRequests,
    failedRequests,
    models: Object.fromEntries(Object.entries(stats).map(([model, value]) => [model, {
      requests: value.requests,
      promptTokens: value.promptTokens,
      completionTokens: value.completionTokens,
      totalTokens: value.totalTokens,
      averageTokens: value.requests ? Math.round(value.totalTokens / value.requests) : 0,
      p50Ms: percentile(value.latencyMs, 0.5),
      p95Ms: percentile(value.latencyMs, 0.95),
      errors: value.errors,
    }])),
  };
}

async function main() {
  await initPromise;
  apiKey = await helpers.getSetting('ai_api_key');
  baseUrl = String(await helpers.getSetting('ai_base_url') || 'https://apipass.tech/v1').replace(/\/+$/, '');
  if (!apiKey) throw new Error('API-ключ ИИ не задан');
  if (!models.length) throw new Error('Не указаны модели для теста');

  console.log(`START target=${targetTokens} concurrency=${concurrency} models=${models.join(',')}`);
  while (consumedTokens < targetTokens && requestNumber < 2000) {
    const averageTokens = successfulRequests ? consumedTokens / successfulRequests : 3000;
    const remainingRequests = Math.max(1, Math.ceil((targetTokens - consumedTokens) / averageTokens));
    const batchSize = Math.min(concurrency, remainingRequests);
    const batchStart = requestNumber;
    const batch = Array.from({ length: batchSize }, (_, offset) => (
      makeRequest(models[(batchStart + offset) % models.length])
    ));
    const results = await Promise.all(batch);
    progress();

    const rateLimited = results.some(result => result.status === 429);
    const critical = results.filter(result => !result.ok && result.status !== 429).length;
    consecutiveCriticalErrors = critical ? consecutiveCriticalErrors + 1 : 0;
    if (consecutiveCriticalErrors >= 5) {
      console.log('STOP reason=consecutive-critical-errors');
      break;
    }
    await sleep(rateLimited ? Math.max(batchDelayMs, 30000) : batchDelayMs);
  }

  console.log(`FINAL ${JSON.stringify(summary())}`);
}

main()
  .catch(error => {
    console.error(`FATAL ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 50);
  });
