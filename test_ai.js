const { Pool } = require('pg');
const https = require('https');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'portfolio',
  user: 'postgres',
  password: 'Admin1234!',
});

async function testAI() {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings WHERE key LIKE $1', ['ai_%']);
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    
    console.log('AI Settings from DB:', settings);

    if (settings.ai_provider !== 'openai') {
      console.log('Not set to openai provider in DB');
      process.exit(0);
    }

    const baseURL = settings.ai_base_url || 'https://api.openai.com/v1';
    const apiKey = settings.ai_api_key;
    const model = settings.ai_model_name || 'gpt-3.5-turbo';

    console.log(`Testing AI with: URL=${baseURL}, Model=${model}`);

    const data = JSON.stringify({
      model: model,
      messages: [{ role: "user", content: "Привет! Работаешь?" }]
    });

    const url = new URL(`${baseURL.replace(/\/+$/, '')}/chat/completions`);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    console.log('Sending request to:', url.toString());

    const req = https.request(options, (res) => {
      console.log('STATUS:', res.statusCode);
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        console.log('RESPONSE BODY:', responseBody);
        process.exit(0);
      });
    });

    req.on('error', (e) => {
      console.error('REQUEST ERROR:', e.message);
      process.exit(1);
    });

    req.write(data);
    req.end();

  } catch (err) {
    console.error('DB ERROR:', err.message);
    process.exit(1);
  }
}

testAI();
