const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { URLSearchParams } = require('url');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ====== GLOBAL LOGGER ======
app.use((req, res, next) => {
  console.log('🌍 Incoming request:', req.method, req.url);
  next();
});

// ====== ENV VARS ======
const RESPOND_IO_TOKEN = process.env.RESPOND_IO_TOKEN;
const RESPOND_IO_CHANNEL_ID = process.env.RESPOND_IO_CHANNEL_ID;

const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SOURCE_PHONE =
  process.env.GUPSHUP_SOURCE_PHONE || process.env.GUPSHUP_SOURCE;
const GUPSHUP_SRC_NAME = process.env.GUPSHUP_SRC_NAME;

console.log('🔧 Loaded env flags:', {
  RESPOND_IO_TOKEN: !!RESPOND_IO_TOKEN,
  RESPOND_IO_CHANNEL_ID: !!RESPOND_IO_CHANNEL_ID,
  GUPSHUP_API_KEY: !!GUPSHUP_API_KEY,
  GUPSHUP_SOURCE_PHONE: !!GUPSHUP_SOURCE_PHONE,
  GUPSHUP_SRC_NAME: !!GUPSHUP_SRC_NAME,
});

// ====== HEALTH CHECK ======
app.get('/', (req, res) => {
  res.status(200).send('Bridge is running');
});

// (اختياري) endpoints للتجربة السريعة
app.get('/message', (req, res) => res.status(200).send('OK'));
app.get('/webhook/respond', (req, res) => res.status(200).send('OK'));

// ====== GUPSHUP VERIFICATION ======
app.get('/webhook/gupshup', (req, res) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) {
    console.log('✅ Gupshup verification challenge received');
    return res.status(200).send(challenge);
  }
  res.status(200).send('Gupshup Webhook verified');
});

// ====== INCOMING: Gupshup ➝ Respond.io (Text + Media) ======
app.post('/webhook/gupshup', async (req, res) => {
  console.log('📩 Incoming from Gupshup:', JSON.stringify(req.body));

  try {
    const incoming = req.body;

    if (!incoming.payload?.sender?.phone) {
      console.log('⚠️ No sender phone, ignoring event');
      return res.status(200).send('Ignored');
    }

    const phoneRaw = incoming.payload.sender.phone;
    const phoneE164 = phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`;

    const messageId = incoming.payload.id || String(Date.now());
    const timestamp = incoming.timestamp || Date.now();

    const msgType = incoming.payload.type; // text/image/audio/video/file...
    const msgPayload = incoming.payload.payload || {};

    let respondMessage;

    if (msgType === 'text') {
      const text = msgPayload.text || incoming.payload.text || '';
      respondMessage = { type: 'text', text: text || '[Empty text]' };
    } else if (msgType === 'image') {
      respondMessage = {
        type: 'image',
        url: msgPayload.url || '',
        caption: msgPayload.caption || '',
      };
    } else if (msgType === 'audio') {
      respondMessage = { type: 'audio', url: msgPayload.url || '' };
    } else if (msgType === 'video') {
      respondMessage = {
        type: 'video',
        url: msgPayload.url || '',
        caption: msgPayload.caption || '',
      };
    } else if (msgType === 'file' || msgType === 'document') {
      respondMessage = {
        type: 'file',
        url: msgPayload.url || '',
        filename: msgPayload.filename || 'file',
      };
    } else {
      respondMessage = {
        type: 'text',
        text: `[Non-text message: ${msgType}]`,
      };
    }

    // لو ميديا بس مفيش URL واضح
    if (respondMessage.type !== 'text' && !respondMessage.url) {
      respondMessage = {
        type: 'text',
        text: `[${msgType}] received but no media url from Gupshup.`,
      };
    }

    const respondPayload = {
      channelId: RESPOND_IO_CHANNEL_ID,
      contactId: phoneE164,
      events: [
        {
          type: 'message',
          mId: messageId,
          timestamp: timestamp,
          message: respondMessage,
        },
      ],
      contact: {
        firstName: incoming.payload.sender.name || '',
        phone: phoneE164,
        countryCode: incoming.payload.sender.country_code || '',
        language: 'en',
      },
    };

    await axios.post('https://app.respond.io/custom/channel/webhook/', respondPayload, {
      headers: {
        Authorization: `Bearer ${RESPOND_IO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('✅ Forwarded to Respond.io:', respondMessage.type);
    res.status(200).send('Forwarded to Respond.io');
  } catch (error) {
    console.error('❌ Error sending to Respond.io:', error.response?.data || error.message);
    res.status(500).send('Error in Gupshup webhook');
  }
});

// ====== OUTGOING: Respond.io ➝ Gupshup (Text + Media) ======
async function handleRespondOutgoing(req, res) {
  console.log('📤 Outgoing from Respond.io:', JSON.stringify(req.body));

  try {
    const { contactId, message } = req.body;

    if (!message || !message.type) {
      console.log('⚠️ Missing message or type');
      return res.status(200).send('Ignored');
    }

    let gupshupMsg = null;

    if (message.type === 'text' && message.text) {
      gupshupMsg = { type: 'text', text: message.text, previewUrl: false };
    } else if (message.type === 'image' && message.url) {
      gupshupMsg = {
        type: 'image',
        originalUrl: message.url,
        previewUrl: message.url,
        caption: message.caption || '',
      };
    } else if (message.type === 'audio' && message.url) {
      gupshupMsg = { type: 'audio', url: message.url };
    } else if (message.type === 'video' && message.url) {
      gupshupMsg = {
        type: 'video',
        url: message.url,
        caption: message.caption || '',
      };
    } else if (message.type === 'file' && message.url) {
      gupshupMsg = {
        type: 'file',
        url: message.url,
        filename: message.filename || 'file',
      };
    } else {
      console.log('⚠️ Unsupported message type or missing url:', message.type, message);
      return res.status(200).send('Ignored');
    }

    const destination = String(contactId || '').replace(/^\+/, '');
    if (!destination) {
      console.log('⚠️ Missing contactId');
      return res.status(200).send('Ignored');
    }

    const gupshupUrl = 'https://api.gupshup.io/wa/api/v1/msg';

    const params = new URLSearchParams();
    params.append('channel', 'whatsapp');
    params.append('source', GUPSHUP_SOURCE_PHONE);
    params.append('destination', destination);
    params.append('message', JSON.stringify(gupshupMsg));
    params.append('src.name', GUPSHUP_SRC_NAME);

    console.log('➡️ Sending to Gupshup:', { to: destination, type: gupshupMsg.type });

    const response = await axios.post(gupshupUrl, params, {
      headers: {
        apikey: GUPSHUP_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    });

    console.log('✅ Message sent to Gupshup:', response.status, response.data);
    res.status(200).json({ mId: String(Date.now()) });
  } catch (error) {
    console.error(
      '❌ Error sending to Gupshup:',
      error.response?.status,
      error.response?.data || error.message
    );
    // رجّع 200 عشان Respond.io ما يعملش retries مزعجة
    res.status(200).json({ mId: String(Date.now()), status: 'accepted_with_error' });
  }
}

// نفس الهاندلر على المسارين دول
app.post('/message', handleRespondOutgoing);
app.post('/webhook/respond', handleRespondOutgoing);

// ====== START SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bridge running on port ${PORT}`);
});
