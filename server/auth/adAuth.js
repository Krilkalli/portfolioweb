const ldap = require('ldapjs');
const config = require('../config');

function getAccountName(emailOrUsername) {
  return String(emailOrUsername || '').trim().split('@')[0];
}

/**
 * Проверяет логин/пароль через bind к Active Directory.
 * Возвращает true при успехе, бросает ошибку при неверных данных
 * или недоступности сервера AD.
 */
function bindAD(username, password) {
  return new Promise((resolve, reject) => {
    if (!config.ad.url || !config.ad.url.startsWith('ldaps://')) {
      return reject(new Error('AD_URL должен быть настроен через защищённый протокол LDAPS'));
    }
    const accountName = getAccountName(username);
    const client = ldap.createClient({
      url: config.ad.url,
      connectTimeout: 3000, // не ждём вечно, если сервер недоступен
      timeout: 3000,
      // Тестовый AD использует самоподписанный сертификат — на проде,
      // если компания даст собственный CA, эту опцию нужно будет убрать
      // или указать valid CA через `ca: [fs.readFileSync('path/to/ca.crt')]`.
      tlsOptions: {
        rejectUnauthorized: config.ad.tlsRejectUnauthorized,
        ca: config.ad.tlsCa ? [config.ad.tlsCa] : undefined,
      },
    });

    client.on('error', (err) => {
      reject(new Error('AD недоступен: ' + err.message));
    });

    client.bind(`${accountName}@${config.ad.domain}`, password, (err) => {
      if (err) {
        client.unbind();
        return reject(new Error('Неверная почта или пароль (AD)'));
      }
      resolve(client); // передаём открытый клиент дальше — он уже авторизован
    });
  });
}

/**
 * Ищет пользователя в AD и возвращает список групп, в которых он состоит.
 * Используется тем же bound-клиентом, что и после успешного bindAD.
 */
function getUserGroups(client, username) {
  return new Promise((resolve, reject) => {
    const accountName = getAccountName(username);
    const domainParts = config.ad.domain.split('.').map(p => `dc=${p}`).join(',');
    const searchBase = domainParts;
    const opts = {
      filter: `(sAMAccountName=${accountName})`,
      scope: 'sub',
      attributes: ['memberOf'],
    };

    client.search(searchBase, opts, (err, res) => {
      if (err) return reject(err);
      let groups = [];
      res.on('searchEntry', (entry) => {
        const memberOf = entry.pojo.attributes.find(a => a.type === 'memberOf');
        if (memberOf) {
          groups = memberOf.values.map(dn => {
            // Достаём CN=ИмяГруппы,... -> "ИмяГруппы"
            const match = /^CN=([^,]+)/i.exec(dn);
            return match ? match[1] : dn;
          });
        }
      });
      res.on('error', (e) => reject(e));
      res.on('end', () => resolve(groups));
    });
  });
}

/**
 * Полная проверка: логин/пароль + определение роли по группе AD.
 * Возвращает { username, role, groups } при успехе.
 */
async function authenticateAD(username, password) {
  const accountName = getAccountName(username);
  const client = await bindAD(accountName, password);
  try {
    const groups = await getUserGroups(client, accountName);
    const allowed = config.ad.allowedGroups.some(group => groups.includes(group));
    if (!allowed) throw new Error('Пользователь не входит в разрешённую группу портфолио');
    const role = groups.includes(config.ad.adminGroup) ? 'admin' : config.ad.defaultRole;
    return { username: accountName, role, groups };
  } finally {
    client.unbind();
  }
}

module.exports = { authenticateAD };
