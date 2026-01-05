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

async function getTelegramFilePath(fileId, botToken) {
	if (!botToken) {
		throw new Error("Missing telegramBotToken");
	}
	const resp = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
	if (!resp.ok) {
		throw new Error(`Telegram getFile failed: ${resp.status}`);
	}
	const payload = await resp.json();
	if (!payload.ok || !payload.result || !payload.result.file_path) {
		throw new Error("Telegram getFile response missing file_path");
	}
	return payload.result.file_path;
}

async function buildPhotoUrl(photoArray, botToken, requestUrl) {
	if (!Array.isArray(photoArray) || photoArray.length === 0) {
		return null;
	}
	if (!botToken) {
		console.warn("Missing telegramBotToken, skipping photo");
		return null;
	}
	const bestPhoto = photoArray[photoArray.length - 1];
	if (!bestPhoto || !bestPhoto.file_id) {
		return null;
	}
	try {
		const filePath = await getTelegramFilePath(bestPhoto.file_id, botToken);
		const origin = new URL(requestUrl).origin;
		return `${origin}/tg/file/${encodeURI(filePath)}`;
	} catch (err) {
		console.warn("Failed to resolve Telegram photo:", err);
		return null;
	}
}

async function buildStickerUrl(sticker, botToken, requestUrl) {
	if (!sticker || !sticker.file_id) {
		return null;
	}
	if (!botToken) {
		console.warn("Missing telegramBotToken, skipping sticker");
		return null;
	}
	const isAnimated = sticker.is_animated || sticker.is_video;
	const thumbId = sticker.thumbnail?.file_id ?? sticker.thumb?.file_id;
	const fileId = isAnimated && thumbId ? thumbId : sticker.file_id;
	const format = isAnimated && thumbId ? "png" : null;
	try {
		const filePath = await getTelegramFilePath(fileId, botToken);
		const origin = new URL(requestUrl).origin;
		const query = format ? `?format=${format}` : "";
		return `${origin}/tg/file/${encodeURI(filePath)}${query}`;
	} catch (err) {
		console.warn("Failed to resolve Telegram sticker:", err);
		return null;
	}
}

export default {
	async fetch(request, env, ctx) {

		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname.startsWith("/tg/file/")) {
			const filePath = url.pathname.slice("/tg/file/".length);
			if (!filePath) {
				return new Response("Missing file path", { status: 400 });
			}
			if (!env.telegramBotToken) {
				return new Response("Missing telegramBotToken", { status: 500 });
			}
			const tgUrl = `https://api.telegram.org/file/bot${env.telegramBotToken}/${filePath}`;
			const format = url.searchParams.get("format");
			let tgResp;
			if (format === "png") {
				tgResp = await fetch(tgUrl, { cf: { image: { format: "png" } } });
				if (!tgResp.ok) {
					console.warn("Image conversion failed, falling back:", tgResp.status);
					tgResp = await fetch(tgUrl);
				}
			} else {
				tgResp = await fetch(tgUrl);
			}
			const headers = new Headers(tgResp.headers);
			headers.set("Cache-Control", "public, max-age=86400");
			return new Response(tgResp.body, { status: tgResp.status, headers });
		}

		if (request.method !== "POST") {
			return new Response("Error");
		}

		const data = await request.json();
		// log the received update
		console.log("Received update:", data);
		if (data["channel_post"] === undefined) {
			return new Response("No channel_post found");
		}

		const channelPost = data["channel_post"]["text"] ?? data["channel_post"]["caption"] ?? "";
		const photoUrl = await buildPhotoUrl(data["channel_post"]["photo"], env.telegramBotToken, request.url);
		const stickerUrl = await buildStickerUrl(data["channel_post"]["sticker"], env.telegramBotToken, request.url);
		const contentParts = [];
		if (typeof channelPost === "string" && channelPost.length > 0) {
			contentParts.push(channelPost);
		}
		if (stickerUrl && data["channel_post"]["sticker"]?.emoji && contentParts.length === 0) {
			contentParts.push(data["channel_post"]["sticker"].emoji);
		}
		if (photoUrl) {
			contentParts.push(photoUrl);
		}
		if (stickerUrl) {
			contentParts.push(stickerUrl);
		}
		if (contentParts.length === 0) {
			return new Response("No text, caption, photo, or sticker found");
		}
		const content = contentParts.join("\n\n");
		const nip01Event = await generateNip01Event(content, env.publicKey, env.privateKey);
		const eventPayload = `["EVENT", ${nip01Event}]`;
		console.log(eventPayload);
		const sendPromise = sendEvent(eventPayload).then((msg) => {
			console.log("Relay response:", msg);
		});
		ctx.waitUntil(sendPromise.catch((err) => {
			console.warn("Nostr send failed:", err);
		}));
		return new Response("OK");
	}
}
