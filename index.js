const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ====== Env (trim و فحص) ======
const ENV = {
  RESPOND_IO_TOKEN: (process.env.RESPOND_IO_TOKEN || '').trim(),
  RESPOND_IO_CHANNEL_ID: (process.env.RESPOND_IO_CHANNEL_ID || '').trim(),
  RESPOND_IO_WORKSPACE: (process.env.RESPOND_IO_WORKSPACE || '').trim(),
  GUPSHUP_API_KEY: (process.env.GUPSHUP_API_KEY || '').trim(),
  GUPSHUP_SRC_NAME: (process.env.GUPSHUP_SRC_NAME || '').trim(),
  GUPSHUP_SOURCE: (process.env.GUPSHUP_SOURCE || '').trim(),
};

function requireEnv(key) {
  if (!ENV[key]) {
    console.error(`❌ Missing env: ${key}`);
    process.exit(1);
  }
}
['RESPOND_IO_TOKEN','RESPOND_IO_CHANNEL_ID','RESPOND_IO_WORKSPACE','GUPSHUP_API_KEY','GUPSHUP_SRC_NAME','GUPSHUP_SOURCE']
  .forEach(requireEnv);

console.log('✅ Respond.io Workspace:', ENV.RESPOND_IO_WORKSPACE);
console.log('✅ Respond.io Channel  :', ENV.RESPOND_IO_CHANNEL_ID);
console.log('✅ Gupshup App Name    :', ENV.GUPSHUP_SRC_NAME);
console.log('✅ Gupshup Source Num  :', ENV.GUPSHUP_SOURCE);
// NOTE: ما نطبعش الـ TOKEN أبداً

// ====== Health/Verification (Gupshup GET) ======
app.get('/webhook/gupshup', (req, res) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) {
    console.log('↪️ Gupshup verification challenge received');
    return res.status(200).send(challenge);
  }
  res.status(200).send('Gupshup Webhook verification successful.');
});

// ====== Gupshup -> Respond.io ======
app.post('/webhook/gupshup', async (req, res) => {
  try {
    console.log('--- Received POST from Gupshup ---', JSON.stringify(req.body));

    // بعض أحداث Gupshup بتيجي كـ user-event أو system-event
    if (!req.body || !req.body.payload) {
      console.log('ℹ️ No payload → ignoring');
      return res.status(200).send('Ignored');
    }

    const payload = req.body.payload;
    const senderPhone =
      (payload.sender && (payload.sender.phone || payload.sender)) ||
      req.body.source;

    if (!senderPhone) {
      console.log('ℹ️ No sender phone → ignoring');
      return res.status(200).send('Ignored');
    }

    let text = '';
    if (payload.body && typeof payload.body.text === 'string') {
      text = payload.body.text;
    } else if (payload.type === 'message' && payload.text) {
      text = payload.text;
    } else {
      text = '[Non-text message]';
    }

    const respondPayload = {
      senderId: String(senderPhone),
      message: { type: 'text', text }
    };

    const url = `https://custom-channel.respond.io/v2/${ENV.RESPOND_IO_WORKSPACE}/messages`;

    console.log('↗️ Forwarding to Respond.io:', {
      url,
      channel: ENV.RESPOND_IO_CHANNEL_ID,
      senderId: respondPayload.senderId,
      text: respondPayload.message.text
    });

    await axios.post(url, respondPayload, {
      headers: {
        Authorization: `Bearer ${ENV.RESPOND_IO_TOKEN}`,
        'X-Channel-Id': ENV.RESPOND_IO_CHANNEL_ID,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    res.status(200).send('Forwarded to Respond.io');
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error('❌ Error forwarding to Respond.io:', status, data || err.message);
    res.status(500).send('Error forwarding to Respond.io');
  }
});

// ====== Respond.io -> Gupshup ======
app.post('/webhook/respond', async (req, res) => {
  try {
    console.log('--- Received from Respond.io ---', JSON.stringify(req.body));

    const recipientPhone = req.body.recipientId;
    const replyText = req.body.message?.text || '';

    if (!recipientPhone || !replyText) {
      console.log('ℹ️ Missing recipient or text');
      return res.status(200).send('Ignored');
    }

    const form = new URLSearchParams();
    form.append('channel', 'whatsapp');
    form.append('source', ENV.GUPSHUP_SOURCE);          // رقم الإرسال
    form.append('src.name', ENV.GUPSHUP_SRC_NAME);      // اسم التطبيق
    form.append('destination', String(recipientPhone)); // رقم المستلم
    form.append('message', replyText);

    const gupshupUrl = 'https://api.gupshup.io/sm/api/v1/msg';

    console.log('↘️ Sending to Gupshup:', {
      to: recipientPhone,
      from: ENV.GUPSHUP_SOURCE,
      app: ENV.GUPSHUP_SRC_NAME,
      text: replyText
    });

    await axios.post(gupshupUrl, form, {
      headers: {
        apikey: ENV.GUPSHUP_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 15000
    });

    res.status(200).send('Sent to Gupshup');
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error('❌ Error forwarding to Gupshup:', status, data || err.message);
    res.status(500).send('Error forwarding to Gupshup');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bridge running on port ${PORT}`));
