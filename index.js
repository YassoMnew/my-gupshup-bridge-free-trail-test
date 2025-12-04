const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

// إعدادات Middleware الأساسية
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// المتغيرات البيئية (ستقوم بتعريفها في Render لاحقًا)
const RESPOND_IO_TOKEN = process.env.RESPOND_IO_TOKEN;
const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC_NAME = process.env.GUPSHUP_SRC_NAME; // اسم التطبيق/الـ Source Name في Gupshup

// 1. **المسار الأول (استقبال من Gupshup -> إرسال لـ Respond.io)**
app.post('/webhook/gupshup', async (req, res) => {
    console.log('--- Received from Gupshup ---', JSON.stringify(req.body));
    try {
        // فحص هيكل بيانات Gupshup واستخراج البيانات الأساسية
        const incomingMsg = req.body; 
        const senderPhone = incomingMsg.payload.sender.phone; // رقم العميل
        let messageText = '';

        // التعامل مع النصوص (تأكد من هيكل Gupshup الخاص بك)
        if (incomingMsg.payload.body && incomingMsg.payload.body.text) {
             messageText = incomingMsg.payload.body.text;
        } else {
             messageText = '[Non-text message received - e.g. Media or Location]'; // يجب تعديلها لدعم الميديا
        }

        // تجهيز البيانات لـ Respond.io
        const respondPayload = {
            senderId: senderPhone, // المعرف (Phone Number)
            message: {
                type: "text",
                text: messageText
            }
        };

        // الإرسال إلى Respond.io Custom Channel
        await axios.post('https://custom-channel.respond.io/v1/message', respondPayload, {
            headers: {
                'Authorization': `Bearer ${RESPOND_IO_TOKEN}`, // التوكن الذي حصلت عليه
                'Content-Type': 'application/json'
            }
        });

        res.status(200).send('Forwarded to Respond.io');
    } catch (error) {
        console.error('Error forwarding to Respond.io:', error.response ? error.response.data : error.message);
        res.status(500).send('Error in Gupshup Webhook');
    }
});

// 2. **المسار الثاني (استقبال من Respond.io -> إرسال لـ Gupshup)**
app.post('/webhook/respond', async (req, res) => {
    console.log('--- Received from Respond.io ---', JSON.stringify(req.body));
    try {
        const replyData = req.body;
        
        // Respond.io يرسل: recipientId (رقم الهاتف)
        const recipientPhone = replyData.recipientId;
        const replyText = replyData.message.text;

        // الإرسال إلى Gupshup API (باستخدام form-urlencoded)
        const gupshupUrl = 'https://api.gupshup.io/sm/api/v1/msg';
        
        const params = new URLSearchParams();
        params.append('channel', 'whatsapp');
        params.append('source', GUPSHUP_SRC_NAME);
        params.append('destination', recipientPhone);
        params.append('message', replyText);
        params.append('src.name', GUPSHUP_SRC_NAME); // تكرار الاسم حسب متطلبات Gupshup

        await axios.post(gupshupUrl, params, {
            headers: {
                'apikey': GUPSHUP_API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        res.status(200).send('Forwarded to Gupshup');
    } catch (error) {
        console.error('Error forwarding to Gupshup:', error.response ? error.response.data : error.message);
        res.status(500).send('Error in Respond.io Webhook');
    }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Bridge running on port ${PORT}`);
});
