import { generateNip01Event, sendEvent } from './nostr';
import {
	buildTelegramPollContent,
	collectTelegramMediaUrls,
	createTelegramMediaGroupManager,
	handleTelegramFileProxy,
} from './telegram';

const telegramMediaGroups = createTelegramMediaGroupManager();

async function sendNostrContent(content, env) {
	const nip01Event = await generateNip01Event(content, env.publicKey, env.privateKey);
	const eventPayload = `["EVENT", ${nip01Event}]`;
	console.log(eventPayload);
	try {
		const msg = await sendEvent(eventPayload);
		console.log("Relay response:", msg);
	} catch (err) {
		console.warn("Nostr send failed:", err);
	}
}

export default {
	async fetch(request, env, ctx) {
		const telegramFileResponse = await handleTelegramFileProxy(request, env);
		if (telegramFileResponse) {
			return telegramFileResponse;
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

		const channelPostData = data["channel_post"];
		const channelPost = channelPostData["text"] ?? channelPostData["caption"] ?? "";
		const mediaUrls = await collectTelegramMediaUrls(channelPostData, env.telegramBotToken, request.url);
		const stickerEmoji = channelPostData["sticker"]?.emoji ?? "";
		const mediaGroupId = channelPostData["media_group_id"];
		const pollContent = buildTelegramPollContent(channelPostData);

		if (mediaGroupId) {
			const flushPromise = telegramMediaGroups.enqueueMediaGroup({
				mediaGroupId,
				text: channelPost,
				emoji: stickerEmoji,
				urls: mediaUrls,
				onFlush: (content) => sendNostrContent(content, env),
			});
			if (flushPromise) {
				ctx.waitUntil(flushPromise);
			}
			return new Response("OK");
		}

		const contentParts = [];
		if (typeof channelPost === "string" && channelPost.length > 0) {
			contentParts.push(channelPost);
		}
		if (stickerEmoji && contentParts.length === 0) {
			contentParts.push(stickerEmoji);
		}
		if (mediaUrls.length > 0) {
			contentParts.push(...mediaUrls);
		}
		if (pollContent) {
			contentParts.push(pollContent);
		}
		if (contentParts.length === 0) {
			return new Response("No content found");
		}
		const content = contentParts.join("\n\n");
		ctx.waitUntil(sendNostrContent(content, env));
		return new Response("OK");
	}
}
