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
wrangler secret put telegramBotToken
```

It will prompt you to enter the respective keys for your Nostr identity. The keys can be hex or bech32 (npub/nsec).
The Telegram bot token is used to fetch and upload media to R2 so Nostr posts can include a public media URL.

Create the R2 bucket in the Cloudflare dashboard:
1. Cloudflare Dashboard -> R2 -> Create bucket
2. Open the bucket, go to Settings, and enable public access via `r2.dev`
3. Copy the r2.dev URL into `R2_PUBLIC_BASE_URL` in `wrangler.toml`

Request the following link to setup webhook:
```
https://api.telegram.org/bot[Telegram bot Token]/setWebhook?url=[Cloudflare worker link]
```
