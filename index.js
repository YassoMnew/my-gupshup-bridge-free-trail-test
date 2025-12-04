const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();

// ===== Middleware أساسي =====
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ===== المتغيرات البيئية (من Render) =====
const RESPOND_IO_TOKEN        = process.env.RESPOND_IO_TOKEN;
const RESPOND_IO_WEBHOOK_URL  = process.env.RESPOND_IO_WEBHOOK_URL; // https://app.respond.io/custom/channel/webhook/
const GUPSHUP_API_KEY         = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC_NAME        = process.env.GUPSHUP_SRC_NAME;      // MissOdd مثلاً

// سلامة المتغيرات
if (!RESPOND_IO_TOKEN || !RESPOND_IO_WEBHOOK_URL || !GUPSHUP_API_KEY || !GUPSHUP_SRC_NAME) {
  console.warn('⚠️ Some env vars are missing. Check RESPOND_IO_TOKEN, RESPOND_IO_WEBHOOK_URL, GUPSHUP_API_KEY, GUPSHUP_SRC_NAME');
}

// =======================================================
// 1) GET /webhook/gupshup  →  للتحقق من الـ Webhook (لو Gupshup عمل GET)
// =======================================================
app.get('/webhook/gupshup', (req, res) => {
  const challenge = req.query['hub.challenge'];

  if (challenge) {
    console.log('--- Gupshup Verification Challenge Received ---');
    return res.status(200).send(challenge);
  }

  console.log('--- Gupshup GET Verification Request (No Challenge) ---');
  return res.status(200).send('Gupshup Webhook verification successful.');
});

// =======================================================
// 2) POST /webhook/gupshup  →  رسالة جاية من Gupshup نبعتهـا لـ Respond.io
// =======================================================
app.post('/webhook/gupshup', async (req, res) => {
  console.log('--- Received POST from Gupshup ---', JSON.stringify(req.body));

  try {
    const incoming = req.body || {};
    const payload  = incoming.payload || {};
    const sender   = payload.sender || {};

    // رقم التليفون
    const senderPhone = sender.phone;
    if (!senderPhone) {
      console.log('⚠️ No sender phone found in Gupshup payload, ignoring message.');
      return res.status(200).send('No sender phone – ignored');
    }

    // النص
    let messageText = '';
    if (payload.payload && payload.payload.text) {
      // ده الشكل اللي ظهر في اللوج عندك:
      // payload: { type: 'text', payload: { text: 'Hi' }, ... }
      messageText = payload.payload.text;
    } else {
      messageText = '[Unsupported message type from Gupshup]';
    }

    // فورمات Respond.io Custom Channel
    const respondPayload = {
      senderId: senderPhone,          // Because ID Type = Phone Number
      message: {
        type: 'text',
        text: messageText,
      },
    };

    // إرسال إلى Webhook الخاص بـ Respond.io (من الشاشة: Webhook URL for Incoming message)
    const url = RESPOND_IO_WEBHOOK_URL;

    await axios.post(url, respondPayload, {
      headers: {
        Authorization: `Bearer ${RESPOND_IO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('✅ Forwarded message to Respond.io');
    return res.status(200).send('Forwarded to Respond.io');
  } catch (error) {
    console.error(
      '❌ Error forwarding to Respond.io:',
      error.response ? error.response.data : error.message
    );
    return res.status(500).send('Error in Gupshup Webhook');
  }
});

// =======================================================
// 3) POST /webhook/respond  →  رد جاي من Respond.io نبعته لـ Gupshup
// =======================================================
app.post('/webhook/respond', async (req, res) => {
  console.log('--- Received from Respond.io ---', JSON.stringify(req.body));

  try {
    const body = req.body || {};

    // نحاول نلقط رقم التليفون من أكثر من احتمال عشان الفورمات يختلف أحياناً
    const recipientPhone =
      body.recipientId ||
      (body.recipient && body.recipient.id) ||
      body.to ||
      null;

    if (!recipientPhone) {
      console.log('⚠️ No recipient phone found in Respond.io payload, ignoring.');
      return res.status(200).send('No recipient phone – ignored');
    }

    const replyText =
      (body.message && body.message.text) ||
      body.text ||
      '[Empty reply from Respond.io]';

    const gupshupUrl = 'https://api.gupshup.io/sm/api/v1/msg';

    const params = new URLSearchParams();
    params.append('channel', 'whatsapp');
    params.append('source', GUPSHUP_SRC_NAME);
    params.append('destination', recipientPhone);
    params.append('message', replyText);
    params.append('src.name', GUPSHUP_SRC_NAME);

    await axios.post(gupshupUrl, params, {
      headers: {
        apikey: GUPSHUP_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    console.log('✅ Forwarded reply to Gupshup');
    return res.status(200).send('Forwarded to Gupshup');
  } catch (error) {
    console.error(
      '❌ Error forwarding to Gupshup:',
      error.response ? error.response.data : error.message
    );
    return res.status(500).send('Error in Respond.io Webhook');
  }
});

// =======================================================
// تشغيل السيرفر
// =======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bridge running on port ${PORT}`);
});
