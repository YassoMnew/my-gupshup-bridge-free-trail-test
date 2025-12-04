@@ -3,152 +3,159 @@ const bodyParser = require('body-parser');
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
// ====== ENV VARS ======
const RESPOND_IO_TOKEN = process.env.RESPOND_IO_TOKEN;
const RESPOND_IO_CHANNEL_ID = process.env.RESPOND_IO_CHANNEL_ID;

// سلامة المتغيرات
if (!RESPOND_IO_TOKEN || !RESPOND_IO_WEBHOOK_URL || !GUPSHUP_API_KEY || !GUPSHUP_SRC_NAME) {
  console.warn('⚠️ Some env vars are missing. Check RESPOND_IO_TOKEN, RESPOND_IO_WEBHOOK_URL, GUPSHUP_API_KEY, GUPSHUP_SRC_NAME');
}
const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC_NAME = process.env.GUPSHUP_SRC_NAME;       // app name in Gupshup (MissOdd)
const GUPSHUP_SOURCE_PHONE = process.env.GUPSHUP_SOURCE_PHONE; // whatsapp number in Gupshup (e.g. 2015xxxxxxx)

// =======================================================
// 1) GET /webhook/gupshup  →  للتحقق من الـ Webhook (لو Gupshup عمل GET)
// =======================================================
// ====== SIMPLE HEALTH CHECK ======
app.get('/', (req, res) => {
  res.status(200).send('Gupshup-Respond bridge is running');
});

// ====== GUPSHUP WEBHOOK VERIFICATION (GET) ======
app.get('/webhook/gupshup', (req, res) => {
  const challenge = req.query['hub.challenge'];

  if (challenge) {
    console.log('--- Gupshup Verification Challenge Received ---');
    console.log('--- Gupshup verification challenge received ---');
    return res.status(200).send(challenge);
  }

  console.log('--- Gupshup GET Verification Request (No Challenge) ---');
  return res.status(200).send('Gupshup Webhook verification successful.');
  console.log('--- Gupshup GET verification (no challenge) ---');
  res.status(200).send('Gupshup Webhook verification successful.');
});

// =======================================================
// 2) POST /webhook/gupshup  →  رسالة جاية من Gupshup نبعتهـا لـ Respond.io
// =======================================================
// ====== INCOMING FROM GUPSHUP -> RESPOND.IO ======
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
    const incoming = req.body;

    // النص
    let messageText = '';
    if (payload.payload && payload.payload.text) {
      // ده الشكل اللي ظهر في اللوج عندك:
      // payload: { type: 'text', payload: { text: 'Hi' }, ... }
      messageText = payload.payload.text;
    } else {
      messageText = '[Unsupported message type from Gupshup]';
    // بعض الـ system events مبيكونش فيها sender
    if (!incoming.payload || !incoming.payload.sender || !incoming.payload.sender.phone) {
      console.log('Ignoring non-message or system event from Gupshup');
      return res.status(200).send('Ignored');
    }

    // فورمات Respond.io Custom Channel
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
      senderId: senderPhone,          // Because ID Type = Phone Number
      message: {
        type: 'text',
        text: messageText,
      },
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

    // إرسال إلى Webhook الخاص بـ Respond.io (من الشاشة: Webhook URL for Incoming message)
    const url = RESPOND_IO_WEBHOOK_URL;

    await axios.post(url, respondPayload, {
      headers: {
        Authorization: `Bearer ${RESPOND_IO_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
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

    console.log('✅ Forwarded message to Respond.io');
    return res.status(200).send('Forwarded to Respond.io');
    console.log('Forwarded message to Respond.io OK');
    res.status(200).send('Forwarded to Respond.io');
  } catch (error) {
    console.error(
      '❌ Error forwarding to Respond.io:',
      'Error forwarding to Respond.io:',
      error.response ? error.response.data : error.message
    );
    return res.status(500).send('Error in Gupshup Webhook');
    res.status(500).send('Error in Gupshup Webhook');
  }
});

// =======================================================
// 3) POST /webhook/respond  →  رد جاي من Respond.io نبعته لـ Gupshup
// =======================================================
app.post('/webhook/respond', async (req, res) => {
  console.log('--- Received from Respond.io ---', JSON.stringify(req.body));
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
    const { channelId, contactId, message } = req.body;

    // contactId هنا هو نفس رقم التليفون اللي اخترناه ID Type = Phone Number
    const destination = contactId; // يفضل يكون +2015xxx... حسب ما مسجله في Gupshup

    const replyText =
      (body.message && body.message.text) ||
      body.text ||
      '[Empty reply from Respond.io]';
    const text =
      message && message.type === 'text' ? message.text : '';

    const gupshupUrl = 'https://api.gupshup.io/sm/api/v1/msg';

    const params = new URLSearchParams();
    params.append('channel', 'whatsapp');
    params.append('source', GUPSHUP_SRC_NAME);
    params.append('destination', recipientPhone);
    params.append('message', replyText);
    params.append('source', GUPSHUP_SOURCE_PHONE); // رقم الواتساب في Gupshup
    params.append('destination', destination.replace('+', '')); // Gupshup غالباً عايزه من غير +
    params.append('message', text);
    params.append('src.name', GUPSHUP_SRC_NAME);

    await axios.post(gupshupUrl, params, {
      headers: {
        apikey: GUPSHUP_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('✅ Forwarded reply to Gupshup');
    return res.status(200).send('Forwarded to Gupshup');
    console.log('Forwarded message to Gupshup OK');
    // Respond.io متوقع يرجع mId
    res.status(200).json({ mId: String(Date.now()) });
  } catch (error) {
    console.error(
      '❌ Error forwarding to Gupshup:',
      'Error forwarding to Gupshup:',
      error.response ? error.response.data : error.message
    );
    return res.status(500).send('Error in Respond.io Webhook');
    res.status(500).send('Error in Respond.io Outgoing Webhook');
  }
});

// =======================================================
// تشغيل السيرفر
// =======================================================
// ====== START SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bridge running on port ${PORT}`);
  console.log(`Bridge running on port ${PORT}`);
});
