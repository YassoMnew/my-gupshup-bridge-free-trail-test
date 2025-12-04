const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ===== Environment variables =====
const RESPOND_IO_TOKEN  = process.env.RESPOND_IO_TOKEN;   // API Token من Respond.io
const GUPSHUP_API_KEY   = process.env.GUPSHUP_API_KEY;    // API key من Gupshup
const GUPSHUP_SRC_NAME  = process.env.GUPSHUP_SRC_NAME;   // اسم الـ App في Gupshup (مثلاً: MissOdd)
const GUPSHUP_SOURCE    = process.env.GUPSHUP_SOURCE;     // رقم الواتساب البيزنس بدون + (مثلاً 971507495883)

// =======================================================
// 1) GET للتحقق من Gupshup (Webhook verification)
// =======================================================
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
// 2) استقبال رسائل من Gupshup -> إرسالها لـ Respond.io
// =======================================================
app.post('/webhook/gupshup', async (req, res) => {
  console.log('--- Received POST from Gupshup ---', JSON.stringify(req.body));

  try {
    const incomingMsg = req.body;

    // أمان زيادة عشان ما نوقعش السيرفر في رسائل سيستم
    if (!incomingMsg.payload || !incomingMsg.payload.sender || !incomingMsg.payload.sender.phone) {
      console.log('Ignored: missing sender phone (system event or unsupported payload).');
      return res.status(200).send('Ignored');
    }

    const senderPhone = incomingMsg.payload.sender.phone;
    let messageText = '';

    // حسب الفورمات الحالي عندك
    if (incomingMsg.payload.body && incomingMsg.payload.body.text) {
      messageText = incomingMsg.payload.body.text;
    } else if (incomingMsg.payload.text) {
      // احتياطي لو الفورمات كان payload.text
      messageText = incomingMsg.payload.text;
    } else {
      messageText = '[Non-text message received]';
    }

    // Payload اللي بتبعته لـ Respond.io
    const respondPayload = {
      senderId: senderPhone,
      message: {
        type: 'text',
        text: messageText
      }
    };

    await axios.post(
      'https://app.respond.io/custom/channel/webhook/',
      respondPayload,
      {
        headers: {
          Authorization: `Bearer ${RESPOND_IO_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.status(200).send('Forwarded to Respond.io');
  } catch (error) {
    console.error(
      'Error forwarding to Respond.io:',
      error.response ? error.response.data : error.message
    );
    res.status(500).send('Error in Gupshup Webhook');
  }
});

// =======================================================
// 3) استقبال رد من Respond.io -> إرساله لـ Gupshup
// =======================================================
app.post('/webhook/respond', async (req, res) => {
  console.log('--- Received from Respond.io ---', JSON.stringify(req.body));

  try {
    const replyData = req.body;

    // نحاول نجيب رقم العميل من أكثر من شكل احتياطيًا
    const recipientPhone =
      replyData.recipientId ||
      replyData.to ||
      (replyData.contact && replyData.contact.phone);

    const replyText =
      replyData.message && replyData.message.text
        ? replyData.message.text
        : '';

    if (!recipientPhone || !replyText) {
      console.log('Missing recipientPhone or replyText, nothing to send to Gupshup.');
      return res.status(200).send('Ignored');
    }

    const gupshupUrl = 'https://api.gupshup.io/sm/api/v1/msg';

    const params = new URLSearchParams();
    params.append('channel', 'whatsapp');
    params.append('source', GUPSHUP_SOURCE);      // هنا الرقم 971507495883
    params.append('destination', recipientPhone); // رقم العميل اللي جاي من Respond.io
    params.append('message', replyText);
    params.append('src.name', GUPSHUP_SRC_NAME);  // MissOdd

    await axios.post(gupshupUrl, params, {
      headers: {
        apikey: GUPSHUP_API_KEY,
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

// =======================================================
// 4) تشغيل السيرفر
// =======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bridge running on port ${PORT}`);
});
