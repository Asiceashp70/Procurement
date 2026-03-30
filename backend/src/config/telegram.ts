import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN || '';
let bot: TelegramBot | null = null;

if (token && token !== 'your_telegram_bot_token') {
    bot = new TelegramBot(token, { polling: false });
}

export const sendMessage = async (message: string) => {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (bot && chatId && chatId !== 'your_chat_id') {
        try {
            await bot.sendMessage(chatId, message);
        } catch (error) {
            console.error('Error sending Telegram message:', error);
        }
    } else {
        console.log(`[Telegram Mock] Would send message: ${message}`);
    }
};

export default bot;
