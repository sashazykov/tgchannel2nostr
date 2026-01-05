/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npx wrangler dev src/index.js` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npx wrangler publish src/index.js --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { generateNip01Event, sendEvent } from './nostr';

export default {
	async fetch(request, env, ctx) {

		if (request.method != "POST") {
			return new Response("Error")
		} else {
			const data = await request.json();
			// log the received update
			console.log('Received update:', data);
			if (data["channel_post"] === undefined) {
				return new Response("No channel_post found")
			} else {
				const channelPost = data["channel_post"]["text"];
				const nip01Event = await generateNip01Event(channelPost, env.publicKey, env.privateKey);
				const eventPayload = `["EVENT", ${nip01Event}]`;
				console.log(eventPayload);
				const sendPromise = sendEvent(eventPayload).then((msg) => {
					console.log("Relay response:", msg);
				});
				ctx.waitUntil(sendPromise.catch((err) => {
					console.warn("Nostr send failed:", err);
				}));
				return new Response("OK")
			}
		}
	}
}
