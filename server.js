require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// These pull your secret keys directly from the Render dashboard.
// DO NOT paste your actual keys here.
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET,
  META_PIXEL_ID,
  META_ACCESS_TOKEN,
  TELEGRAM_INVITE_LINK,
  PUBLIC_BASE_URL
} = process.env;

const TG = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Endpoint for the frontend to get the Telegram invite link (if needed)
app.get('/api/config', (req, res) => {
  res.json({ inviteLink: TELEGRAM_INVITE_LINK });
});

// Telegram Webhook Endpoint
app.post('/webhook/telegram', async (req, res) => {
  // 1. Security Check: Verify the request is actually from Telegram
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (TELEGRAM_WEBHOOK_SECRET && secret !== TELEGRAM_WEBHOOK_SECRET) {
    console.warn('Rejected forged webhook call');
    return res.sendStatus(401);
  }

  const update = req.body;
  
  // Always respond to Telegram immediately so it doesn't retry
  res.sendStatus(200); 

  try {
    // 2. Check if this is a join request
    if (update.chat_join_request) {
      const { chat, from } = update.chat_join_request;
      const userId = from.id;
      const chatId = chat.id;

      console.log(`Join request received from: ${from.username || userId}`);

      // 3. Approve the user
      const approveRes = await fetch(`${TG}/approveChatJoinRequest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, user_id: userId }),
      });
      const approveJson = await approveRes.json();

      if (!approveJson.ok) {
        console.error('Failed to approve user:', approveJson);
        return;
      }
      console.log(`Successfully approved user ${userId} into channel.`);

      // 4. ONLY NOW: Send conversion to Meta
      await sendMetaConversion(userId, from);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

// Function to send data to Meta Conversions API
async function sendMetaConversion(userId, tgUser) {
  const eventTime = Math.floor(Date.now() / 1000);

  // Hash the Telegram ID for Meta tracking
  const externalId = crypto
    .createHash('sha256')
    .update(String(userId))
    .digest('hex');

  const payload = {
    data: [
      {
        event_name: 'Lead',
        event_time: eventTime,
        action_source: 'website',
        user_data: {
          external_id: [externalId],
        },
        custom_data: {
          source: 'telegram_join',
          telegram_username: tgUser.username || '',
        },
      },
    ],
  };

  const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await r.json();
    console.log('Meta CAPI Response:', JSON.stringify(json));
  } catch (error) {
    console.error('Error sending Meta CAPI event:', error);
  }
}

// Helper endpoint to register the webhook easily
app.get('/setup-webhook', async (req, res) => {
  const base = PUBLIC_BASE_URL;
  if (!base) return res.send('Error: Set PUBLIC_BASE_URL in your environment variables first.');

  const url = `${base}/webhook/telegram?secret_token=${encodeURIComponent(TELEGRAM_WEBHOOK_SECRET || '')}`;

  try {
    const r = await fetch(`${TG}/setWebhook?url=${encodeURIComponent(url)}`);
    const json = await r.json();
    res.json(json);
  } catch (error) {
    res.send('Error setting webhook: ' + error.message);
  }
});

// Health check endpoint
app.get('/health', (req, res) => res.send('Server is running!'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
