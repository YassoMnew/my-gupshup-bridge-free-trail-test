const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Environment Variables
const RESPOND_IO_TOKEN = process.env.RESPOND_IO_TOKEN;
const RESPOND_IO_CHANNEL_ID = process.env.RESPOND_IO_CHANNEL_ID;
const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_SRC_NAME = process.env.GUPSHUP_SRC_NAME;

// ===============================
// GUPSHUP VERIFICATION (GET)
// ===============================
app.get('/webhook/gupshup', (req, res) => {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    res.status(200).send('OK');
});

// ===============================
// RECEIVE FROM GUPSHUP → SEND TO RESPOND.IO
// ===============================
app.post('/webhook/gupshup', async (req, res) => {
    console.log("--- Received POST from Gupshup ---", JSON.stringify(req.body));

    try {
        const msg = req.body;
        const sender = msg.payload.sender.phone;

        const text = msg.payload.text || msg.payload.payload?.text || "[Unsupported message]";

        const url = `https://api.respond.io/v2/conversations/${RESPOND_IO_CHANNEL_ID}/messages`;

        await axios.post(url, {
            to: sender,
            message: { type: "text", text }
        }, {
            headers: {
                "Authorization": `Bearer ${RESPOND_IO_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        res.status(200).send("Forwarded to Respond.io");
    }
    catch (err) {
        console.error("Error forwarding to Respond.io:", err.response?.data || err.message);
        res.status(500).send("Error forwarding to Respond.io");
    }
});

// ===============================
// RECEIVE FROM RESPOND.IO → SEND TO GUPSHUP
// ===============================
app.post('/webhook/respond', async (req, res) => {
    console.log("--- Received from Respond.io ---", JSON.stringify(req.body));

    try {
        const reply = req.body;
        const to = reply.to;
        const text = reply.message.text;

        const url = "https://api.gupshup.io/sm/api/v1/msg";

        const form = new URLSearchParams();
        form.append("channel", "whatsapp");
        form.append("source", GUPSHUP_SRC_NAME);
        form.append("destination", to);
        form.append("message", text);

        await axios.post(url, form, {
            headers: { "apikey": GUPSHUP_API_KEY }
        });

        res.status(200).send("Forwarded to Gupshup");
    }
    catch (err) {
        console.error("Error forwarding to Gupshup:", err.response?.data || err.message);
        res.status(500).send("Error forwarding to Gupshup");
    }
});

// PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
