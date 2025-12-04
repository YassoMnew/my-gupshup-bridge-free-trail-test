const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

// إعدادات Middleware الأساسية
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// المتغيرات البيئية (ستقوم بتعريفها في Render لاحقًا)
const RESPOND_IO_TOKEN = process.env.RESPOND_IO_TOKEN;
const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC_NAME = process.env.GUPSHUP_SRC_NAME; // اسم التطبيق/الـ Source Name في Gupshup

// =======================================================
// 1. معالج طلب التحقق GET (للتأكد من Gupshup)
// هذا الكود يحل مشكلة Invalid URL
app.get('/webhook/gupshup', (req, res) => {
  const challenge = req.query['hub.challenge'];

  if (challenge) {
    console.log('--- Gupshup Verification Challenge Received ---');
    return res.status(200).send(challenge);
  }

  console.log('--- Gupshup GET Verification Request Received (No Challenge) ---');
  res.status(200).send('Gupshup Webhook verification successful.');
});
// =======================================================


// 2. المسار الأول (استقبال من Gupshup -> إرسال لـ Respond.io) - رسائل فعلية
app.post('/webhook/gupshup', async (req, res) => {
  console.log('--- Received POST from Gupshup ---', JSON.stringify(req.body));

  try {
    const incomingMsg = req.body;

    // لو مش رسالة عادية (زي user-event / sandbox-start) نتجاهلها
    if (incomingMsg.type && incomingMsg.type !== 'message') {
      console.log('Ignoring non-message event from Gupshup:', incomingMsg.type);
      return res.status(200).send('Ignored non-message event');
    }

    const payload = incomingMsg.payload || {};

    // نحاول نجيب رقم التليفون بأمان
    const senderPhone = payload.sender?.phone || payload.phone;

    if (!senderPhone) {
      console.log('No sender phone in payload, ignoring message');
      return res.status(200).send('No sender phone');
    }

    let messageText = '';

    // جرب body.text أولاً
    if (payload.body && payload.body.text) {
      messageText = payload.body.text;
    }
    // أو payload.text (في بعض الفورمات)
    else if (payload.payload && payload.payload.text) {
      messageText = payload.payload.text;
    }
    else {
      messageText = '[Non-text message received - e.g. Media or Location]';
    }

    const respondPayload = {
      senderId: senderPhone,
      message: {
        type: 'text',
        text: messageText
      }
    };

    await axios.post('https://custom-channel.respond.io/v1/message', respondPayload, {
      headers: {
        'Authorization': `Bearer ${RESPOND_IO_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    res.status(200).send('Forwarded to Respond.io');
  } catch (error) {
    console.error(
      'Error forwarding to Respond.io:',
      error.response ? error.response.data : error.message
    );
    res.status(500).send('Error in Gupshup Webhook');
  }
});

// 3. المسار الثاني (استقبال من Respond.io -> إرسال لـ Gupshup)
app.post('/webhook/respond', async (req, res) => {
  console.log('--- Received from Respond.io ---', JSON.stringify(req.body));

  try {
    const replyData = req.body;
    const recipientPhone = replyData.recipientId;
    const replyText = replyData.message.text;

    const gupshupUrl = 'https://api.gupshup.io/sm/api/v1/msg';

    const params = new URLSearchParams();
    params.append('channel', 'whatsapp');
    params.append('source', GUPSHUP_SRC_NAME);
    params.append('destination', recipientPhone);
    params.append('message', replyText);
    params.append('src.name', GUPSHUP_SRC_NAME);

    await axios.post(gupshupUrl, params, {
      headers: {
        'apikey': GUPSHUP_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    res.status(200).send('Forwarded to Gupshup');
  } catch (error) {
    console.error(
      'Error forwarding to Gupshup:',
      error.response ? error.response.data : error.message
    );
    res.status(500).send('Error in Respond.io Webhook');
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bridge running on port ${PORT}`);
});
