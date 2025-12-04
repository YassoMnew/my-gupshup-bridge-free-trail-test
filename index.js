const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Env Vars
const RESPOND_IO_TOKEN = process.env.RESPOND_IO_TOKEN;
const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC_NAME = process.env.GUPSHUP_SRC_NAME;
const RESPOND_IO_WORKSPACE = process.env.RESPOND_IO_WORKSPACE; // ← أضف هذا

// ============ GUPSHUP VERIFICATION (GET) ============
app.get('/webhook/gupshup', (req, res) => {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    res.status(200).send('Gupshup Webhook verification OK');
});

// ============ RECEIVE FROM GUPSHUP → RESPOND.IO ============
app.post('/webhook/gupshup', async (req, res) => {
    console.log('--- Received POST from Gupshup ---', JSON.stringify(req.body));

    try {
        const incoming = req.body;
        const senderPhone = incoming.payload.sender.phone;
        const messageText = incoming.payload.body?.text || "[Non-text message]";

        // 👇 رابط Respond.io الصحيح
        const RESPOND_URL = `https://api.respond.io/v1/workspaces/${RESPOND_IO_WORKSPACE}/messages`;

        await axios.post(
            RESPOND_URL,
            {
                contact: { phoneNumber: senderPhone },
                message: { type: "text", text: messageText }
            },
            {
                headers: {
                    "Authorization": `Bearer ${RESPOND_IO_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        res.status(200).send("Forwarded to Respond.io");

    } catch (err) {
        console.error("Error forwarding to Respond.io:", err.response?.data || err.message);
        res.status(500).send("Error in Gupshup webhook");
    }
});

// ============ RECEIVE FROM RESPOND.IO → GUPSHUP ============
app.post('/webhook/respond', async (req, res) => {
    console.log('--- Received from Respond.io ---', JSON.stringify(req.body));

    try {
        const { recipient, message } = req.body;

        const params = new URLSearchParams();
        params.append("channel", "whatsapp");
        params.append("source", GUPSHUP_SRC_NAME);
        params.append("destination", recipient.phoneNumber);
        params.append("message", message.text);
        params.append("src.name", GUPSHUP_SRC_NAME);

        await axios.post("https://api.gupshup.io/sm/api/v1/msg", params, {
            headers: {
                apikey: GUPSHUP_API_KEY,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        });

        res.status(200).send("Forwarded to Gupshup");
    } catch (err) {
        console.error("Error forwarding to Gupshup:", err.response?.data || err.message);
        res.status(500).send("Error in Respond.io webhook");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bridge running on port ${PORT}`));
