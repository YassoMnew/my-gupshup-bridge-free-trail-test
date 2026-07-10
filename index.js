const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { URLSearchParams } = require('url');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ====== RATE LIMITING (100 requests per minute per IP) ======
const requestCounts = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowStart = now - 60000;

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }

  const requests = requestCounts.get(ip);
  const validRequests = requests.filter(time => time > windowStart);
  
  if (validRequests.length >= 100) {
    console.log(`⚠️ Rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({ 
      error: 'Too many requests', 
      retryAfter: 60 
    });
  }

  validRequests.push(now);
  requestCounts.set(ip, validRequests);
  next();
}

app.use(rateLimit);

// ====== GLOBAL LOGGER ======
app.use((req, res, next) => {
  console.log('🌍 Incoming request:', req.method, req.url, 'from:', req.ip);
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

// ====== RETRY MECHANISM ======
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 5000];

async function sendWithRetry(url, payload, headers, retries = 0) {
  try {
    return await axios.post(url, payload, { headers, timeout: 15000 });
  } catch (error) {
    if (retries < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retries] || 5000;
      console.log(`🔄 Retry ${retries + 1}/${MAX_RETRIES} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return sendWithRetry(url, payload, headers, retries + 1);
    }
    throw error;
  }
}

// ====== HEALTH CHECK ======
app.get('/', (req, res) => {
  res.status(200).send('Bridge is running');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
  });
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

    if (!incoming || !incoming.payload) {
      console.log('⚠️ Invalid payload structure');
      return res.status(400).send('Invalid payload');
    }

    // Handle reactions
    if (incoming.type === 'message_reaction' || incoming.payload?.type === 'reaction') {
      const reaction = incoming.payload?.reaction || incoming.payload;
      const emoji = reaction?.emoji || '❤️';
      const reactionToMessageId = incoming.payload?.reaction?.message_id || incoming.payload?.reaction?.messageId || null;
      const phoneRaw = incoming.payload?.sender?.phone || incoming.payload?.phone;
      
      if (!phoneRaw) {
        console.log('⚠️ No sender phone in reaction, ignoring');
        return res.status(200).send('Ignored');
      }

      const phoneE164 = phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`;
      const messageId = incoming.payload?.id || String(Date.now());
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
              type: 'reaction',
              reaction: {
                emoji: emoji,
                messageId: reactionToMessageId || String(Date.now()),
              }
            },
          },
        ],
        contact: {
          firstName: incoming.payload?.sender?.name || '',
          phone: phoneE164,
          countryCode: incoming.payload?.sender?.country_code || '',
          language: 'en',
        },
      };

      await sendWithRetry(
        'https://webhook.respond.io/custom/channel/webhook/',
        respondPayload,
        {
          Authorization: `Bearer ${RESPOND_IO_TOKEN}`,
          'Content-Type': 'application/json',
        }
      );

      console.log('✅ Reaction forwarded to Respond.io:', emoji);
      return res.status(200).send('Reaction forwarded');
    }

    // Regular messages
    if (!incoming.payload?.sender?.phone) {
      console.log('⚠️ No sender phone, ignoring event');
      return res.status(200).send('Ignored');
    }

    const phoneRaw = incoming.payload.sender.phone;
    const phoneE164 = phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`;

    const messageId = incoming.payload.id || String(Date.now());
    const timestamp = incoming.timestamp || Date.now();

    const msgType = incoming.payload.type;
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
    } else if (msgType === 'voice') {
      const url = msgPayload.url || '';
      respondMessage = { type: 'text', text: `🎙️ Voice message received\n${url || '[no url]'}` };
    } else if (msgType === 'file' || msgType === 'document') {
      const url = msgPayload.url || '';
      respondMessage = { type: 'text', text: `📎 File received\n${url || '[no url]'}` };
    } else if (msgType === 'location') {
      const lat = msgPayload.latitude || msgPayload.lat;
      const lng = msgPayload.longitude || msgPayload.lng;
      const name = msgPayload.name || '';
      const address = msgPayload.address || '';
      const locationText = lat && lng 
        ? `📍 Location shared:\nhttps://maps.google.com/?q=${lat},${lng}\n${name}\n${address}`
        : '📍 Location shared';
      respondMessage = { type: 'text', text: locationText };
    } else if (msgType === 'contact') {
      const contacts = msgPayload.contacts || [];
      let contactText = '👤 Contact shared:\n';
      contacts.forEach(c => {
        contactText += `Name: ${c.name?.formatted_name || c.name || 'Unknown'}\n`;
        if (c.phones) {
          c.phones.forEach(p => {
            contactText += `Phone: ${p.phone || p.wa_id || 'N/A'}\n`;
          });
        }
      });
      respondMessage = { type: 'text', text: contactText };
    } else if (msgType === 'sticker') {
      const url = msgPayload.url || '';
      respondMessage = { type: 'text', text: `😀 Sticker received\n${url || '[no url]'}` };
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

    await sendWithRetry(
      'https://webhook.respond.io/custom/channel/webhook/',
      respondPayload,
      {
        Authorization: `Bearer ${RESPOND_IO_TOKEN}`,
        'Content-Type': 'application/json',
      }
    );

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

// ====== OUTGOING: Respond.io ➝ Gupshup ======
async function handleRespondOutgoing(req, res) {
  console.log('📤 Outgoing from Respond.io:', JSON.stringify(req.body));

  try {
    const { contactId, message } = req.body;

    if (!message || !message.type) {
      console.log('⚠️ Missing message or type');
      return res.status(200).send('Ignored');
    }

    const isAttachment = message.type === 'attachment' && message.attachment;
    const effectiveType = isAttachment ? (message.attachment.type || 'file') : message.type;

    const mediaUrl =
      message.url ||
      message.mediaUrl ||
      message.fileUrl ||
      message.attachment?.url ||
      message.attachment?.fileUrl ||
      message.attachment?.payload?.url ||
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
    } else if (effectiveType === 'voice' && mediaUrl) {
      gupshupMsg = { type: 'voice', url: mediaUrl };
    } else if (effectiveType === 'video' && mediaUrl) {
      gupshupMsg = { type: 'video', url: mediaUrl, caption: caption || '' };
    } else if ((effectiveType === 'file' || effectiveType === 'document') && mediaUrl) {
      gupshupMsg = { type: 'file', url: mediaUrl, filename };
    } else if (effectiveType === 'location' && message.location) {
      const loc = message.location;
      gupshupMsg = {
        type: 'location',
        latitude: loc.latitude || loc.lat,
        longitude: loc.longitude || loc.lng,
        name: loc.name || '',
        address: loc.address || '',
      };
    } else if (effectiveType === 'contact' && message.contacts) {
      gupshupMsg = {
        type: 'contact',
        contacts: message.contacts,
      };
    } else if (effectiveType === 'sticker' && mediaUrl) {
      gupshupMsg = { type: 'sticker', url: mediaUrl };
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
    res.status(200).json({ mId: String(Date.now()), status: 'accepted_with_error' });
  }
}

app.post('/message', handleRespondOutgoing);
app.post('/webhook/respond', handleRespondOutgoing);

// ====== ERROR HANDLER ======
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ====== START SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bridge running on port ${PORT}`);
  console.log(`⏱️ Rate limit: 100 requests/minute per IP`);
  console.log(`🔄 Retry: ${MAX_RETRIES} attempts with delays: ${RETRY_DELAYS.join('ms, ')}ms`);
});
