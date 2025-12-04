const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { URLSearchParams } = require('url');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ====== GLOBAL LOGGER عشان نتأكد أي request يوصل يطلع في اللوج ======
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

console.log('🔧 Loaded env:', {
  RESPOND_IO_TOKEN: !!RESPOND_IO_TOKEN,
  RESPOND_IO_CHANNEL_ID: !!RESPOND_IO_CHANNEL_ID,
  GUPSHUP_API_KEY: !!GUPSHUP_API_KEY,
  GUPSHUP_SOURCE_PHONE: GUPSHUP_SOURCE_PHONE,
  GUPSHUP_SRC_NAME: GUPSHUP_SRC_NAME,
});

// ====== HEALTH CHECK ======
app.get('/', (req, res) => {
  res.status(200).send('Bridge is running');
});

// ====== GUPSHUP VERIFICATION ======
app.get('/webhook/gupshup', (req, res) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) {
    console.log('✅ Gupshup verification challenge received');
    return res.status(200).send(challenge);
  }
  res.status(200).send('Gupshup Webhook verified');
});

// ====== INCOMING: Gupshup ➝ Respond.io ======
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

    const text =
      incoming.payload.payload?.text ||
      incoming.payload.text ||
      '[Non-text message]';

    const messageId = incoming.payload.id || String(Date.now());
    const timestamp = incoming.timestamp || Date.now();

    const respondPayload = {
      channelId: RESPOND_IO_CHANNEL_ID,
      contactId: phoneE164,
      events: [
        {
          type: 'message',
          mId: messageId,
          timestamp: timestamp,
          message: {
            type: 'text',
            text: text,
          },
        },
      ],
      contact: {
        firstName: incoming.payload.sender.name || '',
        phone: phoneE164,
        countryCode: incoming.payload.sender.country_code || '',
        language: 'en',
      },
    };

    await axios.post(
      'https://app.respond.io/custom/channel/webhook/',
      respondPayload,
      {
        headers: {
          Authorization: `Bearer ${RESPOND_IO_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Forwarded to Respond.io');
    res.status(200).send('Forwarded to Respond.io');
  } catch (error) {
    console.error(
      '❌ Error sending to Respond.io:',
      error.response?.data || error.message
    );
    res.status(500).send('Error in Gupshup webhook');
  }
});

// ====== OUTGOING HANDLER: Respond.io ➝ Gupshup ======
async function handleRespondOutgoing(req, res) {
  console.log('📤 Outgoing from Respond.io (or test):', JSON.stringify(req.body));

  try {
    const { contactId, message } = req.body;

    if (!message || message.type !== 'text' || !message.text) {
      console.log('⚠️ Ignoring non-text or empty message');
      return res.status(200).send('Ignored');
    }

    const destination = contactId.replace(/^\+/, '');
    const text = message.text;

    const gupshupUrl = 'https://api.gupshup.io/wa/api/v1/msg';

    const params = new URLSearchParams();
    params.append('channel', 'whatsapp');
    params.append('source', GUPSHUP_SOURCE_PHONE);
    params.append('destination', destination);

    const gupshupMessage = JSON.stringify({
      type: 'text',
      text: text,
      previewUrl: false,
    });
    params.append('message', gupshupMessage);

    params.append('src.name', GUPSHUP_SRC_NAME);

    console.log('➡️ Sending to Gupshup:', {
      to: destination,
      text: text,
    });

    const response = await axios.post(gupshupUrl, params, {
      headers: {
        apikey: GUPSHUP_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    console.log('✅ Message sent to Gupshup:', response.status, response.data);
    res.status(200).json({ mId: String(Date.now()) });
  } catch (error) {
    console.error(
      '❌ Error sending to Gupshup:',
      error.response?.status,
      error.response?.data || error.message
    );
    res.status(500).send('Error in Respond.io outgoing');
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
