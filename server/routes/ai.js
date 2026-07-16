const express = require('express');
const router = express.Router();
const { enhanceText, reviewText } = require('../ai');

// Middleware to check if user is authenticated (employee or manager)
function requireAuth(req, res, next) {
  if (!req.session.employeeId && !req.session.isManager) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  next();
}

router.post('/enhance', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Текст не предоставлен' });
    
    const enhanced = await enhanceText(text);
    res.json({ result: enhanced });
  } catch (err) {
    console.error('AI Enhance Error:', err);
    res.status(500).json({ error: err.message || 'Ошибка ИИ' });
  }
});

router.post('/review', requireAuth, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'Данные не предоставлены' });

    let { reviewJSONData } = require('../ai');
    let reviewResult = await reviewJSONData(data);
    res.json({ result: reviewResult });
  } catch (err) {
    console.error('AI Review Error:', err);
    res.status(500).json({ error: err.message || 'Ошибка ИИ' });
  }
});

router.post('/review-fields', requireAuth, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'Данные не предоставлены' });
    
    const textToReview = JSON.stringify(data, null, 2);
    
    let { reviewJSONData } = require('../ai');
    let reviewResult = await reviewJSONData(data);
    res.json({ result: reviewResult });
  } catch (err) {
    console.error('AI Review Error:', err);
    res.status(500).json({ error: err.message || 'Ошибка ИИ' });
  }
});

module.exports = router;
