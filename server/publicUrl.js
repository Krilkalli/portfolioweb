const config = require('./config');

function getPublicBaseUrl(req) {
  const configuredUrl = String(config.publicBaseUrl || '').trim().replace(/\/+$/, '');
  if (configuredUrl) return configuredUrl;

  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { getPublicBaseUrl };
