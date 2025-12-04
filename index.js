import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

const ENV = {
  GUPSHUP_API_KEY: process.env.GUPSHUP_API_KEY,
  GUPSHUP_SOURCE: process.env.GUPSHUP_SOURCE,
  GUPSHUP_SRC_NAME: process.env.GUPSHUP_SRC_NAME,
  RESPOND_IO_TOKEN: process.env.RESPOND_IO_TOKEN,
  RESPOND_IO_CHANNEL_ID: process.env.RESPOND_IO_CHANNEL_ID,
  RESPOND_IO_WORKSPACE: process.env.RESPOND_IO_WORKSPACE,
};

// Endpoint to receive incoming messages from Gupshup
app.post('/webhook/gupshup', async (req, res) => {
  const payload = req.body;

  console.log('--- Received POST from Gupshup ---', JSON.stringify(payload));

  try {
    const senderId = payload.sender?.phone || payload.payload?.sender?.phone;

    let text = '';
    if (payload.payload?.payload?.text) {
      text = payload.payload.payload.text;
    } else if (payload.payload?.text) {
      text = payload.payload.text;
    } else {
      text = '[Non-text message]';
    }

    const respondPayload = {
      channel: ENV.RESPOND_IO_CHANNEL_ID,
      senderId: senderId,
      message: {
        type: 'text',
        text: text,
      },
    };

    const url = `https://app.respond.io/custom/channel/webhook/`;

    console.log('↗️ Forwarding to Respond.io:', {
      url,
      channel: respondPayload.channel,
      senderId: respondPayload.senderId,
      text: respondPayload.message.text,
    });

    const response = await axios.post(url, respondPayload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ENV.RESPOND_IO_TOKEN}`,
      },
    });

    console.log('✅ Successfully forwarded to Respond.io');
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error forwarding to Respond.io:', error.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
