const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

// --- Configuration ---
const CUSTOMER_BOT_TOKEN = '8874503246:AAEmdPcVJMQ3q6pmINsP_Tcwium3ANV4T6I';
const ADMIN_BOT_TOKEN = '8787715855:AAF9PLZkk_tOb28TYcyTcAs_NszwURnzhkw';
const ADMIN_CHAT_ID = '7659178694';
const UPI_ID = 'paytm.s2ujlw0@pty';
const BOT_USERNAME = 'JPW_REACHED_SERVICES_BOT'; // अपने बोट का यूज़रनेम (बिना @ के) लिखें

const customerBot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: true });
const adminBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: true });

// Permanent In-Memory Database
let users = {}; 
let userState = {}; 
let pendingTx = {}; 

// Polling Error Handlers
customerBot.on('polling_error', (err) => console.error('[Customer Bot Error]', err.message));
adminBot.on('polling_error', (err) => console.error('[Admin Bot Error]', err.message));

// Helper Keyboard
const getMainKeyboard = () => ({
    reply_markup: {
        keyboard: [
            [{ text: '💳 Buy Reaches' }, { text: '📤 Submit Credentials' }],
            [{ text: '👤 My Profile' }, { text: '🔗 Refer & Earn' }]
        ],
        resize_keyboard: true
    }
});

const initUser = (chatId) => {
    if (!users[chatId]) {
        users[chatId] = { reaches: 0, referredBy: null, successfulRefers: 0 };
    }
};

// ==========================================
// 🕒 AUTOMATIC HOURLY MESSAGES (9 AM to 8 PM)
// ==========================================
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

// Helper function to process credential submission
async function processCredentialsSubmission(chatId, targetId, targetPass) {
    initUser(chatId);

    if (users[chatId].reaches <= 0) {
        return customerBot.sendMessage(
            chatId,
            `❌ *Insufficient Reaches!*\n\nYour available reaches balance is *${users[chatId].reaches}*.\nPlease recharge to submit orders.`,
            { parse_mode: 'Markdown' }
        );
    }

    // Send Credentials to Admin with Action Buttons
    const adminMsg = `
📤 *NEW CREDENTIALS SUBMITTED*

👤 *User Telegram ID:* \`${chatId}\`
🔐 *Credentials:* \`${targetId}\` \`${targetPass}\`
📍 *Available Reaches Balance:* ${users[chatId].reaches} Reaches
👥 *Completed Refers:* ${users[chatId].successfulRefers}
    `.trim();

    await adminBot.sendMessage(
        ADMIN_CHAT_ID,
        adminMsg,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Reach Successful', callback_data: `reachsuccess_${chatId}_${targetId}` },
                        { text: '⏳ Reach In Process', callback_data: `reachprocess_${chatId}_${targetId}` }
                    ],
                    [
                        { text: '❌ Reach Cancelled', callback_data: `reachcancel_${chatId}_${targetId}` }
                    ]
                ]
            }
        }
    );

    // Initial Confirmation to Customer
    return customerBot.sendMessage(
        chatId,
        `✅ *Credentials Submitted & Queued!*\n\n👤 Engineer ID: \`${targetId}\`\nAvailable Balance: *${users[chatId].reaches} Reaches*\nYour request is queued for processing.`,
        { parse_mode: 'Markdown' }
    );
}

// ==========================================
// 1. START COMMAND & REFERRAL HANDLING
// ==========================================
customerBot.onText(/\/start(.*)/, (msg, match) => {
    const chatId = msg.chat.id;
    const startParam = match[1] ? match[1].trim() : '';

    initUser(chatId);

    if (startParam.startsWith('ref_')) {
        const referrerId = startParam.replace('ref_', '');
        if (referrerId !== String(chatId) && users[referrerId]) {
            users[chatId].referredBy = referrerId;
        }
    }
    userState[chatId] = null; 

    customerBot.sendMessage(
        chatId,
        `✨ *Welcome to JPW REACHED SERVICES BOT*\n\nPlease choose an option from below:`,
        { parse_mode: 'Markdown', ...getMainKeyboard() }
    );
});

// ==========================================
// 2. ADMIN COMMANDS (/refers)
// ==========================================
adminBot.onText(/\/refers/, (msg) => {
    const chatId = msg.chat.id;
    if (String(chatId) !== ADMIN_CHAT_ID) return;

    let report = "📊 *REFERRAL SYSTEM REPORT*\n\n";
    let count = 0;

    for (const userId in users) {
        const u = users[userId];
        if (u.successfulRefers > 0 || u.referredBy) {
            count++;
            report += `👤 *User ID:* \`${userId}\`\n`;
            report += `  • Successful Refers: *${u.successfulRefers}*\n`;
            report += `  • Current Reaches Balance: *${u.reaches}*\n\n`;
        }
    }

    if (count === 0) report += "No referral activity recorded yet.";
    adminBot.sendMessage(ADMIN_CHAT_ID, report, { parse_mode: 'Markdown' });
});

// ==========================================
// 3. CUSTOMER MESSAGE HANDLER
// ==========================================
customerBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    initUser(chatId);
    const currentState = userState[chatId] ? userState[chatId].step : null;

    // --- Profile ---
    if (text === '👤 My Profile') {
        return customerBot.sendMessage(
            chatId,
            `👤 *YOUR PROFILE*\n\n🆔 Telegram ID: \`${chatId}\`\n📍 Available Reaches: *${users[chatId].reaches}*\n👥 Completed Refers: *${users[chatId].successfulRefers}*`,
            { parse_mode: 'Markdown' }
        );
    }

    // --- Referral Dashboard ---
    if (text === '🔗 Refer & Earn') {
        const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${chatId}`;
        const refMsg = `
🔗 *REFERRAL DASHBOARD*

🆔 *Your Link:*
\`${refLink}\`

📊 *Your Stats:*
• Completed Refers: *${users[chatId].successfulRefers}*
• Earned Bonus: *${users[chatId].successfulRefers * 5} Reaches*

🎁 *Condition:* Get *5 Free Reaches* for every friend who completes a minimum recharge of *₹200* (14 Reaches)!
        `.trim();

        return customerBot.sendMessage(chatId, refMsg, { parse_mode: 'Markdown' });
    }

    // --- Buy Reaches ---
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

    // --- Submit Credentials Button Clicked ---
    if (text === '📤 Submit Credentials') {
        if (users[chatId].reaches <= 0) {
            return customerBot.sendMessage(chatId, `❌ *Insufficient Reaches!*\nPlease buy reaches first. Current Balance: ${users[chatId].reaches}`);
        }
        userState[chatId] = { step: 'AWAITING_TARGET_ID' };
        return customerBot.sendMessage(chatId, `🔑 *Step 1/2:* Please send your *Target ID*:`, { parse_mode: 'Markdown' });
    }

    // --- UTR Input Step ---
    if (currentState === 'AWAITING_UTR') {
        const utrNumber = text.trim();
        const pkg = userState[chatId].pkg;
        userState[chatId] = null;

        pendingTx[utrNumber] = { telegramId: chatId, pkg: pkg };

        await customerBot.sendMessage(chatId, `⏳ *Payment Received*\n\nYour UTR (\`${utrNumber}\`) has been submitted to Admin for verification.`, { parse_mode: 'Markdown' });

        const adminMsg = `
🔔 *NEW PAYMENT RECHARGE REQUEST*

🆔 *UTR Number:* \`${utrNumber}\`
👤 *Customer ID:* \`${chatId}\`
💰 *Recharge Amount:* ₹${pkg.amount}
📦 *Purchased Reaches:* ${pkg.reaches} Reaches
📍 *Current Balance:* ${users[chatId].reaches} Reaches
🔗 *Completed Refers:* ${users[chatId].successfulRefers}
        `.trim();

        return adminBot.sendMessage(
            ADMIN_CHAT_ID,
            adminMsg,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Accept Payment', callback_data: `payaccept_${utrNumber}` },
                            { text: '❌ Reject Payment', callback_data: `payreject_${utrNumber}` }
                        ]
                    ]
                }
            }
        );
    }

    // --- Credentials Input Steps (Interactive) ---
    if (currentState === 'AWAITING_TARGET_ID') {
        userState[chatId] = { step: 'AWAITING_PASSWORD', targetId: text.trim() };
        return customerBot.sendMessage(chatId, `🔒 *Step 2/2:* Now send your *Password*:`, { parse_mode: 'Markdown' });
    }

    if (currentState === 'AWAITING_PASSWORD') {
        const targetId = userState[chatId].targetId;
        const targetPass = text.trim();
        userState[chatId] = null;
        return processCredentialsSubmission(chatId, targetId, targetPass);
    }

    // --- AUTO DETECT ID & PASSWORD FORMAT (e.g. "12345678 mypass") ---
    const parts = text.trim().split(/\s+/);
    if (parts.length === 2 && !currentState) {
        const targetId = parts[0];
        const targetPass = parts[1];
        return processCredentialsSubmission(chatId, targetId, targetPass);
    }
});

// ==========================================
// 4. PACKAGE SELECTION CALLBACKS
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
// 5. ADMIN ACTIONS HANDLER
// ==========================================
adminBot.on('callback_query', async (query) => {
    const action = query.data;

    // --- A. PAYMENT ACCEPT / REJECT ---
    if (action.startsWith('payaccept_') || action.startsWith('payreject_')) {
        const isAccept = action.startsWith('payaccept_');
        const utrNumber = action.replace(isAccept ? 'payaccept_' : 'payreject_', '');
        const tx = pendingTx[utrNumber];

        if (!tx) {
            return adminBot.answerCallbackQuery(query.id, { text: 'Transaction already processed!' });
        }

        const { telegramId, pkg } = tx;
        initUser(telegramId);

        if (isAccept) {
            users[telegramId].reaches += pkg.reaches;

            if (pkg.amount >= 200 && users[telegramId].referredBy) {
                const referrerId = users[telegramId].referredBy;
                initUser(referrerId);

                users[referrerId].reaches += 5;
                users[referrerId].successfulRefers += 1;
                users[telegramId].referredBy = null;

                try {
                    await customerBot.sendMessage(
                        referrerId,
                        `🎉 *REFERRAL BONUS RECEIVED!*\n\nYour referred friend completed a recharge of ₹${pkg.amount}.\n🎁 Bonus Added: *5 Free Reaches*\n📍 New Total Reaches: *${users[referrerId].reaches}*`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (e) {
                    console.error("Failed to notify referrer:", e.message);
                }
            }

            await customerBot.sendMessage(
                telegramId,
                `🎉 *PAYMENT SUCCESSFUL!*\n\nYour payment for UTR \`${utrNumber}\` has been approved.\n➕ Added: *${pkg.reaches} Reach(es)*\n📍 Current Available Reaches: *${users[telegramId].reaches}*`,
                { parse_mode: 'Markdown' }
            );

            await adminBot.editMessageText(`✅ *Payment Accepted*\n\n👤 Customer: \`${telegramId}\`\n💰 Recharge: ₹${pkg.amount}\n➕ Added: ${pkg.reaches} Reaches\n📍 Total Reaches: ${users[telegramId].reaches}\n🆔 UTR: \`${utrNumber}\``, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
        } else {
            await customerBot.sendMessage(telegramId, `❌ *Payment Rejected*\n\nYour payment for UTR \`${utrNumber}\` was rejected.`);
            await adminBot.editMessageText(`❌ *Payment Rejected*\n\n👤 Customer: \`${telegramId}\`\n🆔 UTR: \`${utrNumber}\``, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
        }

        delete pendingTx[utrNumber];
        return adminBot.answerCallbackQuery(query.id);
    }

    // --- B. REACH PROCESS BUTTON CLICKED ---
    if (action.startsWith('reachprocess_')) {
        const parts = action.split('_');
        const custTelegramId = parts[1];
        const targetId = parts[2];

        const processNotice = `
🤖 *JPW REACHED SERVICES BOT STATUS*

👤 Engineer ID: \`${targetId}\`
📋 Your order will be processed shortly.
        `.trim();

        try {
            await customerBot.sendMessage(custTelegramId, processNotice, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error("Failed to send notice to customer:", e.message);
        }

        await adminBot.editMessageText(`⏳ *Reach Marked In Process*\n\n👤 User Telegram ID: \`${custTelegramId}\`\n🔑 Engineer ID: \`${targetId}\`\n📍 Balance: ${users[custTelegramId] ? users[custTelegramId].reaches : 0} Reaches\n\n👇 *Select Final Action:*`, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Reach Successful', callback_data: `reachsuccess_${custTelegramId}_${targetId}` },
                        { text: '❌ Reach Cancelled', callback_data: `reachcancel_${custTelegramId}_${targetId}` }
                    ]
                ]
            }
        });

        return adminBot.answerCallbackQuery(query.id, { text: 'Notification sent to customer!' });
    }

    // --- C. REACH SUCCESSFUL / CANCELLED (Never Expires) ---
    if (action.startsWith('reachsuccess_') || action.startsWith('reachcancel_')) {
        const parts = action.split('_');
        const type = parts[0];
        const custTelegramId = parts[1];
        const targetId = parts[2];

        initUser(custTelegramId);

        if (type === 'reachsuccess') {
            if (users[custTelegramId].reaches > 0) {
                users[custTelegramId].reaches -= 1;
            }
            const remaining = users[custTelegramId].reaches;

            await customerBot.sendMessage(
                custTelegramId,
                `✅ *REACH SUCCESSFUL*\n\n👤 Engineer ID: \`${targetId}\`\n📊 Status: SUCCESS\n📍 Remaining Reaches: *${remaining}*\n\n📋 Work Orders Processed Successfully.`,
                { parse_mode: 'Markdown' }
            );

            await adminBot.editMessageText(`✅ *Marked as Reach Successful*\n👤 User Telegram ID: \`${custTelegramId}\`\n🔑 Engineer ID: \`${targetId}\`\n📉 Deducted: 1 Reach (Remaining: ${remaining})`, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });

        } else if (type === 'reachcancel') {
            await customerBot.sendMessage(
                custTelegramId,
                `❌ *REACH CANCELLED*\n\n👤 Engineer ID: \`${targetId}\`\n📊 Status: CANCELLED\nYour reach request was cancelled. No reaches were deducted. Current Balance: ${users[custTelegramId].reaches}`,
                { parse_mode: 'Markdown' }
            );

            await adminBot.editMessageText(`❌ *Marked as Reach Cancelled*\n👤 User Telegram ID: \`${custTelegramId}\`\n🔑 Engineer ID: \`${targetId}\`\n📍 Balance Retained: ${users[custTelegramId].reaches} Reaches`, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
        }

        return adminBot.answerCallbackQuery(query.id);
    }
});

console.log('Bot running with Auto Credentials Detection & Persistent Order Processing...');
