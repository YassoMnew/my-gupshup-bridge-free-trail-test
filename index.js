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
// (عشان Respond.io عندك ما يعرضش الميديا كـ image event بشكل مضمون، بنبعته كنص + رابط)
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

    const msgType = incoming.payload.type; // text/image/audio/video...
    const msgPayload = incoming.payload.payload || {};

    let respondMessage;

    if (msgType === 'text') {
      const text = msgPayload.text || incoming.payload.text || '';
      respondMessage = { type: 'text', text: text || '[Empty text]' };
    } else if (msgType === 'image') {
      const url = msgPayload.url || '';
      respondMessage = { type: 'text', text: `📷 Image received\n${url || '[no url]'}` };
    } else if (msgType === 'video') {
      const url = msgPayload.url || '';
      respondMessage = { type: 'text', text: `🎥 Video received\n${url || '[no url]'}` };
    } else if (msgType === 'audio') {
      const url = msgPayload.url || '';
      respondMessage = { type: 'text', text: `🎤 Audio received\n${url || '[no url]'}` };
    } else if (msgType === 'file' || msgType === 'document') {
      const url = msgPayload.url || '';
      respondMessage = { type: 'text', text: `📎 File received\n${url || '[no url]'}` };
    } else {
      respondMessage = { type: 'text', text: `[Non-text message: ${msgType}]` };
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

    await axios.post('https://webhook.respond.io/custom/channel/webhook/', respondPayload, {
      headers: {
        Authorization: `Bearer ${RESPOND_IO_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    console.log('✅ Forwarded to Respond.io:', respondMessage.type);
    res.status(200).send('Forwarded to Respond.io');
  } catch (error) {
    console.error('❌ Error sending to Respond.io:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    res.status(500).send('Error in Gupshup webhook');
  }
});

// ====== OUTGOING: Respond.io ➝ Gupshup (Text + Media + Attachment) ======
async function handleRespondOutgoing(req, res) {
  console.log('📤 Outgoing from Respond.io:', JSON.stringify(req.body));

  try {
    const { contactId, message } = req.body;

    if (!message || !message.type) {
      console.log('⚠️ Missing message or type');
      return res.status(200).send('Ignored');
    }

    // ✅ لو Respond.io باعت attachment، النوع الحقيقي جوه attachment.type
    const isAttachment = message.type === 'attachment' && message.attachment;
    const effectiveType = isAttachment ? (message.attachment.type || 'file') : message.type;

    const mediaUrl =
      // direct common
      message.url ||
      message.mediaUrl ||
      message.fileUrl ||
      // attachment common
      message.attachment?.url ||
      message.attachment?.fileUrl ||
      message.attachment?.payload?.url ||
      // attachments array common
      message.attachments?.[0]?.url ||
      message.attachments?.[0]?.fileUrl ||
      message.attachments?.[0]?.payload?.url ||
      null;

    const caption =
      message.caption ||
      message.attachment?.description ||
      message.attachment?.caption ||
      message.attachments?.[0]?.caption ||
      '';

    const filename =
      message.filename ||
      message.attachment?.fileName ||
      message.attachment?.filename ||
      message.attachments?.[0]?.filename ||
      message.attachments?.[0]?.fileName ||
      'file';

    let gupshupMsg = null;

    if (effectiveType === 'text' && message.text) {
      gupshupMsg = { type: 'text', text: message.text, previewUrl: false };
    } else if (effectiveType === 'image' && mediaUrl) {
      gupshupMsg = {
        type: 'image',
        originalUrl: mediaUrl,
        previewUrl: mediaUrl,
        caption: caption || '',
      };
    } else if (effectiveType === 'audio' && mediaUrl) {
      gupshupMsg = { type: 'audio', url: mediaUrl };
    } else if (effectiveType === 'video' && mediaUrl) {
      gupshupMsg = { type: 'video', url: mediaUrl, caption: caption || '' };
    } else if ((effectiveType === 'file' || effectiveType === 'document') && mediaUrl) {
      gupshupMsg = { type: 'file', url: mediaUrl, filename };
    } else {
      console.log('⚠️ Unsupported or missing mediaUrl:', {
        messageType: message.type,
        effectiveType,
        mediaUrl,
        messageKeys: Object.keys(message),
      });
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
    console.error('❌ Error sending to Gupshup:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    // 200 عشان Respond.io ما يعملش retries كتير
    res.status(200).json({ mId: String(Date.now()), status: 'accepted_with_error' });
  }
}

// نفس الهاندلر على المسارين
app.post('/message', handleRespondOutgoing);
app.post('/webhook/respond', handleRespondOutgoing);

// ====== START SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bridge running on port ${PORT}`);
});
