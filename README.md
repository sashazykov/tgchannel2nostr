# tgchannel2nostr

This is a Telegram bot for forwarding Telegram channel information to Nostr. The bot uses Cloudflare Worker and Telegram bot webhook.

# Use

Prerequisites:

1. [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
1. Telegram bot token
1. Schnorr private key and public key


Update `name` in wrangler.toml to your desired Cloudflare worker name.

Type the following command inside the terminal:

```bash
npm install
wrangler deploy
wrangler secret put publicKey
wrangler secret put privateKey
```

It will prompt you to enter the respective keys for your Nostr identity. The keys should be in hex format.

Request the following link to setup webhook:
```
https://api.telegram.org/bot[Telegram bot Token]/setWebhook?url=[Cloudflare worker link]
```
