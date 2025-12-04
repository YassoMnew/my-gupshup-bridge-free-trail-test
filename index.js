const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Environment Variables
const RESPOND_IO_TOKEN = process.env.RESPOND_IO_TOKEN;
const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC_NAME = process.env.GUPSHUP_SRC_NAME;

// =======================================================
// 1) Gupshup GET Verification (Fix Invalid URL)
// =======================================================
app.get('/webhook/gupshup', (req, res) => {
    const challenge = req.query['hub.challenge'];

    if (challenge) {
        console.log('--- Gupshup Verification Challenge Received ---');
        return res.status(200).send(challenge);
    }

    console.log('--- Gupshup GET Verification Request Received ---');
    res.status(200).send('Gupshup Webhook verification successful.');
});

// =======================================================
// 2) Receive messages FROM Gupshup → send TO Respond.io
// =======================================================
app.post('/webhook/gupshup', async (req, res) => {
    console.log('--- Received POST from Gupshup ---', JSON.stringify(req.body));

    try {
        const data = req.body;

        // حماية من رسائل ناقصة
        if (!data.payload || !data.payload.sender || !data.payload.sender.phone) {
            console.log("Ignored system event or invalid payload from Gupshup.");
            return res.status(200).send("Ignored");
        }

        const senderPhone = data.payload.sender.phone;
        const messageText =
            data.payload.body && data.payload.body.text
                ? data.payload.body.text
                : "[Unsupported message type]";

        const respondPayload = {
            senderId: senderPhone,
            message: {
                type: "text",
                text: messageText
            }
        };

        // ----------------------------------------------
        // 🚀 URL الصحيح لــ Respond.io
        // ----------------------------------------------
        await axios.post("https://api.respond.io/v1/message", respondPayload, {
            headers: {
                "Authorization": `Bearer ${RESPOND_IO_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        res.status(200).send("Forwarded to Respond.io");

    } catch (error) {
        console.error("Error forwarding to Respond.io:", error.response?.data || error.message);
        res.status(500).send("Error sending to Respond.io");
    }
});

// =======================================================
// 3) Receive replies FROM Respond.io → send TO Gupshup
// =======================================================
app.post('/webhook/respond', async (req, res) => {
    console.log('--- Received POST from Respond.io ---', JSON.stringify(req.body));

    try {
        const reply = req.body;

        const recipientPhone = reply.recipientId;
        const replyText = reply.message?.text || "";

        const params = new URLSearchParams();
        params.append("channel", "whatsapp");
        params.append("source", GUPSHUP_SRC_NAME);
        params.append("destination", recipientPhone);
        params.append("message", replyText);
        params.append("src.name", GUPSHUP_SRC_NAME);

        await axios.post("https://api.gupshup.io/sm/api/v1/msg", params, {
            headers: {
                "apikey": GUPSHUP_API_KEY,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });

        res.status(200).send("Forwarded to Gupshup");

    } catch (error) {
        console.error("Error forwarding to Gupshup:", error.response?.data || error.message);
        res.status(500).send("Error sending to Gupshup");
    }
});

// =======================================================
// Start Server
// =======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Bridge running on port ${PORT}`);
});
