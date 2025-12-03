# Railway Setup - Complete Guide

This guide covers all setup tasks for the aegis-guardian service on Railway.

## ✅ 1. Railway Environment Variables (DEVNET)

### Quick Setup Script

Run the automated script:
```bash
cd aegis-guardian
./scripts/set-railway-devnet.sh aegis-guardian
```

### Manual Setup

Go to Railway Dashboard → Your Project → `aegis-guardian` service → **Variables** tab

**Critical Variables for DEVNET:**

```bash
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=d0bb1f98-b8e3-4f52-9108-778ff3d7dcf1
SOLANA_WS_URL=wss://devnet.helius-rpc.com/?api-key=d0bb1f98-b8e3-4f52-9108-778ff3d7dcf1
SOLANA_CLUSTER=devnet
PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
AEGIS_PROGRAM_ID=ET9WDoFE2bf4bSmciLL7q7sKdeSYeNkWbNMHbAMBu2ZJ
```

**Application URLs:**
```bash
BASE_URL=https://aegis-guardian-production.up.railway.app
ACTIONS_BASE_URL=https://aegis-guardian-production.up.railway.app/api/actions
NEXT_PUBLIC_API_URL=https://aegis-guardian-production.up.railway.app
NEXT_PUBLIC_GUARDIAN_URL=https://aegis-guardian-production.up.railway.app
```

**Event Listener:**
```bash
EVENT_LISTENER_ENABLED=true
EVENT_LISTENER_RESTART_DELAY=5000
EVENT_LISTENER_MAX_RECONNECT_ATTEMPTS=10
```

**Feature Flags:**
```bash
BLINK_GENERATION_ENABLED=true
ANALYTICS_ENABLED=true
WEBHOOKS_ENABLED=true
```

### Verification

After setting variables, check logs:
```bash
railway logs --service aegis-guardian | grep -i "event listener"
```

You should see:
```
✅ Event listener started (polling mode, devnet)
```

---

## ✅ 2. User Notification Preferences

Notification preferences are stored in the `User` table. Users can configure them via the API or frontend.

### Default Preferences

When a user is created, they get these defaults:
- `notifyOnBlocked: true` - Get notified when transactions are blocked
- `notifyOnExecuted: false` - Don't notify on successful transactions
- `notifyOnOverride: true` - Get notified when overrides are requested

### Setting Preferences via API

**Get current preferences:**
```bash
curl -X GET "https://aegis-guardian-production.up.railway.app/api/user/profile" \
  -H "x-user-id: YOUR_USER_ID"
```

**Update preferences:**
```bash
curl -X PATCH "https://aegis-guardian-production.up.railway.app/api/user/profile" \
  -H "Content-Type: application/json" \
  -H "x-user-id: YOUR_USER_ID" \
  -d '{
    "notifyOnBlocked": true,
    "notifyOnExecuted": false,
    "notifyOnOverride": true,
    "quietHoursStart": 22,
    "quietHoursEnd": 8,
    "timezone": "America/New_York"
  }'
```

### Setting Preferences via Frontend

1. Go to https://aegis-vaults.xyz/settings
2. Navigate to **Notifications** section
3. Configure preferences:
   - ✅ Notify on blocked transactions
   - ✅ Notify on override requests
   - ⬜ Notify on executed transactions (optional)
   - Set quiet hours (optional)
   - Set timezone (optional)

### Database Schema

The `User` model has these notification fields:
```prisma
model User {
  // Notification Preferences
  notifyOnBlocked   Boolean @default(true)
  notifyOnExecuted  Boolean @default(false)
  notifyOnOverride  Boolean @default(true)
  quietHoursStart   Int?    // Hour (0-23)
  quietHoursEnd     Int?    // Hour (0-23)
  timezone          String? @db.VarChar(50)
  
  // Telegram
  telegramChatId String?
  telegramUsername String?
  telegramLinkToken String? @unique
  telegramLinkExpiry DateTime?
  
  // Discord
  discordWebhook String?
  
  // Webhook
  webhookUrl String?
}
```

---

## ✅ 3. Telegram Bot Setup

### How It Works

1. User requests a Telegram link via API
2. System generates a unique token (valid 15 minutes)
3. User opens Telegram bot link and sends `/start <token>`
4. Bot verifies token and links chat ID to user account
5. User receives notifications via Telegram

### Step 1: Configure Telegram Bot Token

**In Railway Variables:**
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
```

**Get a Bot Token:**
1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow instructions to create a bot
4. Copy the token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
5. Set it in Railway variables

### Step 2: User Linking Flow

**User requests link:**
```bash
curl -X POST "https://aegis-guardian-production.up.railway.app/api/user/telegram/link" \
  -H "x-user-id: YOUR_USER_ID"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "botLink": "https://t.me/your_bot?start=abc123...",
    "expiresAt": "2025-12-03T14:30:00.000Z",
    "instructions": "Click the link to open Telegram and send /start to link your account"
  }
}
```

**User action:**
1. Click the `botLink` URL
2. Opens Telegram with the bot
3. Bot sends: "Welcome! Send /start <token> to link your account"
4. User sends: `/start abc123...`
5. Bot verifies token and links account
6. Bot confirms: "✅ Account linked! You'll receive notifications here."

### Step 3: Webhook Endpoint

The bot needs to receive webhook updates. Set this in Railway:

```bash
TELEGRAM_WEBHOOK_URL=https://aegis-guardian-production.up.railway.app/api/webhooks/telegram
```

**Set webhook (one-time setup):**
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://aegis-guardian-production.up.railway.app/api/webhooks/telegram"
  }'
```

### Step 4: Test Telegram Notification

**Send test notification:**
```bash
curl -X POST "https://aegis-guardian-production.up.railway.app/api/user/telegram/test" \
  -H "x-user-id: YOUR_USER_ID"
```

**Expected:**
- User receives a test message in Telegram
- Response confirms message sent

### Telegram Bot Commands

Users can interact with the bot:

- `/start <token>` - Link account (first time)
- `/start` - Show help (if already linked)
- `/status` - Check notification settings
- `/unlink` - Unlink Telegram account

### Troubleshooting Telegram

**Bot not responding:**
1. Verify `TELEGRAM_BOT_TOKEN` is set in Railway
2. Check webhook is set: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
3. Check Railway logs: `railway logs --service aegis-guardian | grep telegram`

**User can't link:**
1. Token expires after 15 minutes - request a new one
2. Token can only be used once
3. Check user is authenticated (has `x-user-id` header)

**Notifications not sending:**
1. Verify user has `telegramChatId` set in database
2. Check `notifyOnBlocked` / `notifyOnOverride` preferences are `true`
3. Check bot token is valid: `curl "https://api.telegram.org/bot<TOKEN>/getMe"`

---

## Complete Setup Checklist

### ✅ Environment Variables
- [ ] `SOLANA_CLUSTER=devnet`
- [ ] `SOLANA_RPC_URL` (Helius devnet)
- [ ] `SOLANA_WS_URL` (Helius devnet)
- [ ] `PROGRAM_ID` (Aegis program)
- [ ] `BASE_URL` (Railway URL)
- [ ] `EVENT_LISTENER_ENABLED=true`

### ✅ Event Listener
- [ ] Event listener starts successfully
- [ ] Logs show "Connected to Solana devnet"
- [ ] Logs show "Polling mode enabled"
- [ ] Transactions are being recorded

### ✅ Blink Generation
- [ ] `BLINK_GENERATION_ENABLED=true`
- [ ] Blink GET endpoint returns metadata
- [ ] Blink POST endpoint builds transactions
- [ ] Blink URLs work in wallets

### ✅ Notifications
- [ ] `TELEGRAM_BOT_TOKEN` set (if using Telegram)
- [ ] Telegram webhook configured
- [ ] Users can link Telegram accounts
- [ ] Test notifications work

### ✅ Database
- [ ] PostgreSQL connection working
- [ ] Redis connection working
- [ ] Migrations applied
- [ ] Users can be created/updated

---

## Verification Commands

**Check health:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/health"
```

**Check event listener:**
```bash
railway logs --service aegis-guardian | grep -i "event listener"
```

**Check Telegram bot:**
```bash
curl "https://api.telegram.org/bot<TOKEN>/getMe"
```

**Test Blink endpoint:**
```bash
curl "https://aegis-guardian-production.up.railway.app/api/blinks/override?vault=3DK1x5h8ivW93f4Xc1aiVyvyNDQ5xcwgt6rJaddRegja&destination=HMrBkPPnedC5qzeZfXcyaWxiBk74utEqGPGGJSos4MzA&amount=250000000&reason=exceeded_daily_limit"
```

---

## Support

If you encounter issues:
1. Check Railway logs: `railway logs --service aegis-guardian --tail`
2. Verify all environment variables are set
3. Check Railway service status
4. Review this guide for common issues

