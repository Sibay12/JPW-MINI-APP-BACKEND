const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(cors());

// --- Bot Credentials Hardcoded ---
const CUSTOMER_BOT_TOKEN = '8874503246:AAEmdPcVJMQ3q6pmINsP_Tcwium3ANV4T6I';
const ADMIN_BOT_TOKEN = 'YOUR_ADMIN_BOT_TOKEN_HERE'; // <--- यहाँ अपना Admin Bot Token डालें
const ADMIN_CHAT_ID = 'YOUR_ADMIN_CHAT_ID_HERE';     // <--- यहाँ अपनी Telegram Chat ID डालें

// Bot Instances
const customerBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: false });
const adminBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: true });

// Database simulation
let users = {};
let pendingTransactions = {};

// 1. Root Endpoint
app.get('/', (req, res) => {
    res.send('JPW Reached Services Backend is active!');
});

// 2. Initialize User Profile
app.post('/api/user/init', (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) return res.status(400).json({ success: false, error: "Telegram ID required" });

    if (!users[telegramId]) {
        users[telegramId] = { reaches: 0 };
    }
    res.json({ success: true, user: users[telegramId] });
});

// 3. Request Purchase
app.post('/api/request-purchase', async (req, res) => {
    const { telegramId, packageId, utrNumber } = req.body;

    if (!telegramId || !utrNumber) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    let reachesToAdd = 1;
    let amount = 20;
    if (packageId === 'pack_3') { reachesToAdd = 3; amount = 55; }
    else if (packageId === 'pack_6') { reachesToAdd = 6; amount = 100; }
    else if (packageId === 'pack_14') { reachesToAdd = 14; amount = 200; }

    pendingTransactions[utrNumber] = { telegramId, packageId, reachesToAdd };

    // 📩 Send status update to Customer via Customer Bot
    try {
        await customerBot.sendMessage(telegramId, `⏳ *Payment Received*\n\nYour UTR (\`${utrNumber}\`) has been submitted successfully.\n*Status:* In Process. Admin is verifying your payment.`, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error("Error sending message via Customer Bot:", e);
    }

    // 🔔 Send notification to Admin via Admin Bot with Accept/Reject
    const adminMsg = `🔔 *New Payment Request*\n\n👤 User ID: \`${telegramId}\`\n📦 Package: ${reachesToAdd} Reaches\n💰 Amount: ₹${amount}\n🆔 UTR: \`${utrNumber}\``;

    try {
        await adminBot.sendMessage(ADMIN_CHAT_ID, adminMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Accept', callback_data: `accept_${utrNumber}` },
                        { text: '❌ Reject', callback_data: `reject_${utrNumber}` }
                    ]
                ]
            }
        });
    } catch (err) {
        console.error("Error sending message via Admin Bot:", err);
    }

    res.json({ success: true, message: "Request successfully sent to admin!" });
});

// 4. Submit Credentials (Updated with custom dynamic fields support)
app.post('/api/submit-credentials', async (req, res) => {
    const { telegramId, targetId, targetPassword, workOrders, location, customerName, time, queueInfo, estimatedTime } = req.body;

    if (!telegramId || !targetId || !targetPassword) {
        return res.status(400).json({ success: false, error: "All fields are required" });
    }

    if (!users[telegramId] || users[telegramId].reaches <= 0) {
        return res.json({ success: false, error: "Insufficient reaches! Please buy more reaches." });
    }

    users[telegramId].reaches -= 1;
    const remainingReaches = users[telegramId].reaches;

    // Send credentials and dynamic details to Admin Bot
    try {
        await adminBot.sendMessage(ADMIN_CHAT_ID, `📤 *New Credentials Submitted*\n\n👤 User ID: \`${telegramId}\`\n🔑 ID: \`${targetId}\`\n🔒 Password: \`${targetPassword}\``, { parse_mode: 'Markdown' });
    } catch (e) {}

    // 🤖 Send formatted Queue/Processing notification to Customer Bot as requested
    const formattedQueueMsg = `
🤖 *JPW REACHED SERVICES BOT STATUS*

✅ Status: Queued
👤 User ID: \`${targetId || telegramId}\`
⏰ Time: ${time || 'Just now'}

📍 Queue Position: ${queueInfo || '1/1'}
⏳ Action Required: Don't login your ID. Please wait till 1.5 min (approx ${estimatedTime || '1 min'})

📋 Work Orders:
${workOrders ? workOrders.map((wo, index) => `${index === 0 ? '  🎯 ' : '  • '}${wo}`).join('\n') : '  • N/A'}

🔄 Processing...
`.trim();

    try {
        await customerBot.sendMessage(telegramId, formattedQueueMsg, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error("Failed to send queue message to customer:", e);
    }

    res.json({ 
        success: true, 
        message: "Submitted Successfully!",
        remainingReaches: remainingReaches 
    });
});

// --- Handle Accept / Reject Clicks on Admin Bot ---
adminBot.on('callback_query', async (query) => {
    const action = query.data;
    const msg = query.message;
    const parts = action.split('_');
    const type = parts[0];
    const utrNumber = parts[1];

    const tx = pendingTransactions[utrNumber];

    if (!tx) {
        await adminBot.answerCallbackQuery(query.id, { text: "Transaction already processed or expired!" });
        return;
    }

    const { telegramId, reachesToAdd } = tx;

    if (type === 'accept') {
        if (!users[telegramId]) users[telegramId] = { reaches: 0 };
        users[telegramId].reaches += reachesToAdd;
        const totalUserReaches = users[telegramId].reaches;

        // ✅ Success Notification Format (As requested, without plan validity)
        const successReportMsg = `
✅ *REACHED SUCCESSFULLY*

👤 Tech ID: \`${telegramId}\`
📊 Status: SUCCESS
📍 Remaining Reaches: \`${totalUserReaches}\`

📋 Work Orders Processed Successfully.
        `.trim();

        // Notify Customer via Customer Bot
        try {
            await customerBot.sendMessage(telegramId, successReportMsg, { parse_mode: 'Markdown' });
        } catch (e) { console.error("Error sending success report:", e); }

        // Update Admin Bot Message
        await adminBot.editMessageText(`✅ *Accepted & Processed*\n\n👤 User: \`${telegramId}\`\n📦 Added: ${reachesToAdd} Reaches\n🆔 UTR: \`${utrNumber}\``, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            parse_mode: 'Markdown'
        });

        delete pendingTransactions[utrNumber];
    } else if (type === 'reject') {
        // Notify Customer via Customer Bot
        try {
            await customerBot.sendMessage(telegramId, `❌ *Payment Rejected*\n\nYour payment (UTR: \`${utrNumber}\`) was rejected. Please check your UTR or contact support.`, { parse_mode: 'Markdown' });
        } catch (e) {}

        // Update Admin Bot Message
        await adminBot.editMessageText(`❌ *Rejected*\n\n👤 User: \`${telegramId}\`\n🆔 UTR: \`${utrNumber}\``, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            parse_mode: 'Markdown'
        });

        delete pendingTransactions[utrNumber];
    }

    await adminBot.answerCallbackQuery(query.id, { text: "Action processed!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
