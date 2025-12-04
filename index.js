const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ====== ENV VARS ======
const RESPOND_IO_TOKEN = process.env.RESPOND_IO_TOKEN;
const RESPOND_IO_CHANNEL_ID = process.env.RESPOND_IO_CHANNEL_ID;

const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC_NAME = process.env.GUPSHUP_SRC_NAME;       // app name in Gupshup (MissOdd)
const GUPSHUP_SOURCE_PHONE = process.env.GUPSHUP_SOURCE_PHONE; // whatsapp number in Gupshup (e.g. 2015xxxxxxx)

// ====== SIMPLE HEALTH CHECK ======
app.get('/', (req, res) => {
  res.status(200).send('Gupshup-Respond bridge is running');
});

// ====== GUPSHUP WEBHOOK VERIFICATION (GET) ======
app.get('/webhook/gupshup', (req, res) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) {
    console.log('--- Gupshup verification challenge received ---');
    return res.status(200).send(challenge);
  }
  console.log('--- Gupshup GET verification (no challenge) ---');
  res.status(200).send('Gupshup Webhook verification successful.');
});

// ====== INCOMING FROM GUPSHUP -> RESPOND.IO ======
app.post('/webhook/gupshup', async (req, res) => {
  console.log('--- Received POST from Gupshup ---', JSON.stringify(req.body));

  try {
    const incoming = req.body;

    // بعض الـ system events مبيكونش فيها sender
    if (!incoming.payload || !incoming.payload.sender || !incoming.payload.sender.phone) {
      console.log('Ignoring non-message or system event from Gupshup');
      return res.status(200).send('Ignored');
    }

    const phoneRaw = incoming.payload.sender.phone;          // e.g. 2015xxxxxxx
    const phoneE164 = phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`;

    const text =
      incoming.payload.payload &&
      incoming.payload.payload.text
        ? incoming.payload.payload.text
        : '';

    const messageId = incoming.payload.id || String(Date.now());
    const timestamp = incoming.timestamp || Date.now();

    // Payload بالشكل اللي Respond.io طالبه في الـ docs
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
            text: text
          }
        }
      ],
      contact: {
        firstName: incoming.payload.sender.name || '',
        phone: phoneE164,
        countryCode: incoming.payload.sender.country_code || '',
        language: 'en'
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

    console.log('Forwarded message to Respond.io OK');
    res.status(200).send('Forwarded to Respond.io');
  } catch (error) {
    console.error(
      'Error forwarding to Respond.io:',
      error.response ? error.response.data : error.message
    );
    res.status(500).send('Error in Gupshup Webhook');
  }
});

// ====== AUTH FROM RESPOND.IO -> OUR SERVER ======
function validateRespondToken(req, res, next) {
  const bearer = req.headers.authorization || '';
  if (!bearer.startsWith('Bearer ')) {
    return res.status(401).send('Missing Authorization header');
  }
  const token = bearer.substring(7);
  if (token !== RESPOND_IO_TOKEN) {
    return res.status(401).send('Invalid token');
  }
  next();
}

// ====== OUTGOING FROM RESPOND.IO -> GUPSHUP ======
app.post('/message', validateRespondToken, async (req, res) => {
  console.log('--- Received Outgoing from Respond.io ---', JSON.stringify(req.body));

  try {
    const { channelId, contactId, message } = req.body;

    // contactId هنا هو نفس رقم التليفون اللي اخترناه ID Type = Phone Number
    const destination = contactId; // يفضل يكون +2015xxx... حسب ما مسجله في Gupshup

    const text =
      message && message.type === 'text' ? message.text : '';

    const gupshupUrl = 'https://api.gupshup.io/sm/api/v1/msg';

    const params = new URLSearchParams();
    params.append('channel', 'whatsapp');
    params.append('source', GUPSHUP_SOURCE_PHONE); // رقم الواتساب في Gupshup
    params.append('destination', destination.replace('+', '')); // Gupshup غالباً عايزه من غير +
    params.append('message', text);
    params.append('src.name', GUPSHUP_SRC_NAME);

    await axios.post(gupshupUrl, params, {
      headers: {
        apikey: GUPSHUP_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('Forwarded message to Gupshup OK');
    // Respond.io متوقع يرجع mId
    res.status(200).json({ mId: String(Date.now()) });
  } catch (error) {
    console.error(
      'Error forwarding to Gupshup:',
      error.response ? error.response.data : error.message
    );
    res.status(500).send('Error in Respond.io Outgoing Webhook');
  }
});

// ====== START SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bridge running on port ${PORT}`);
});
