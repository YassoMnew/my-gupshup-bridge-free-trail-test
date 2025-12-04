const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

// إعدادات Middleware الأساسية
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// المتغيرات البيئية
const RESPOND_IO_TOKEN = process.env.RESPOND_IO_TOKEN;
const RESPOND_IO_CHANNEL_ID = process.env.RESPOND_IO_CHANNEL_ID;
const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC_NAME = process.env.GUPSHUP_SRC_NAME;

// =======================================================
// 1. معالجة طلب التحقق GET من Gupshup
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


// 2. استقبال من Gupshup → وإرسال لـ Respond.io
app.post('/webhook/gupshup', async (req, res) => {
    console.log('--- Received POST from Gupshup ---', JSON.stringify(req.body));

    try {
        const incomingMsg = req.body;

        // حماية لو الرسالة System Event أو ملهاش sender
        if (!incomingMsg.payload || !incomingMsg.payload.sender || !incomingMsg.payload.sender.phone) {
            console.log("Ignored system message or incomplete payload.");
            return res.status(200).send('Ignored');
        }

        const senderPhone = incomingMsg.payload.sender.phone;
        let messageText = incomingMsg.payload.body?.text || '[Non-text message received]';

        const respondPayload = {
            senderId: senderPhone,
            message: {
                type: "text",
                text: messageText
            }
        };

        // إرسال الرسالة لـ Respond.io
        await axios.post(
            'https://api.respond.io/v1/message',
            respondPayload,
            {
                headers: {
                    'Authorization': `Bearer ${RESPOND_IO_TOKEN}`,
                    'Channel-ID': RESPOND_IO_CHANNEL_ID,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.status(200).send('Forwarded to Respond.io');

    } catch (error) {
        console.error('Error forwarding to Respond.io:', error.response?.data || error.message);
        res.status(500).send('Error in Gupshup Webhook');
    }
});


// 3. استقبال من Respond.io → وإرسال لـ Gupshup
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
        console.error('Error forwarding to Gupshup:', error.response?.data || error.message);
        res.status(500).send('Error in Respond.io Webhook');
    }
});


// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Bridge running on port ${PORT}`);
});
