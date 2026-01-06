const MEDIA_GROUP_FLUSH_MS = 2000;

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

async function buildFileUrl(file, botToken, requestUrl, label) {
	if (!file || !file.file_id) {
		return null;
	}
	if (!botToken) {
		console.warn(`Missing telegramBotToken, skipping ${label}`);
		return null;
	}
	try {
		const filePath = await getTelegramFilePath(file.file_id, botToken);
		const origin = new URL(requestUrl).origin;
		return `${origin}/tg/file/${encodeURI(filePath)}`;
	} catch (err) {
		console.warn(`Failed to resolve Telegram ${label}:`, err);
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

export async function collectTelegramMediaUrls(channelPost, botToken, requestUrl) {
	const urls = [];
	const photoUrl = await buildPhotoUrl(channelPost.photo, botToken, requestUrl);
	if (photoUrl) {
		urls.push(photoUrl);
	}
	const stickerUrl = await buildStickerUrl(channelPost.sticker, botToken, requestUrl);
	if (stickerUrl) {
		urls.push(stickerUrl);
	}
	const videoUrl = await buildFileUrl(channelPost.video, botToken, requestUrl, "video");
	if (videoUrl) {
		urls.push(videoUrl);
	}
	const animationUrl = await buildFileUrl(channelPost.animation, botToken, requestUrl, "animation");
	if (animationUrl) {
		urls.push(animationUrl);
	}
	const documentUrl = await buildFileUrl(channelPost.document, botToken, requestUrl, "document");
	if (documentUrl) {
		urls.push(documentUrl);
	}
	const audioUrl = await buildFileUrl(channelPost.audio, botToken, requestUrl, "audio");
	if (audioUrl) {
		urls.push(audioUrl);
	}
	const voiceUrl = await buildFileUrl(channelPost.voice, botToken, requestUrl, "voice");
	if (voiceUrl) {
		urls.push(voiceUrl);
	}
	const videoNoteUrl = await buildFileUrl(channelPost.video_note, botToken, requestUrl, "video_note");
	if (videoNoteUrl) {
		urls.push(videoNoteUrl);
	}
	return urls;
}

function buildTelegramMessageLink(channelPost) {
	if (!channelPost) {
		return null;
	}
	const messageId = channelPost.message_id;
	const chat = channelPost.chat ?? channelPost.sender_chat;
	const chatId = chat?.id;
	if (!messageId || !chatId) {
		return null;
	}
	if (chat?.username) {
		return `https://t.me/${chat.username}/${messageId}`;
	}
	const idStr = String(chatId);
	const stripped = idStr.startsWith("-100") ? idStr.slice(4) : idStr.replace("-", "");
	if (!stripped) {
		return null;
	}
	return `https://t.me/c/${stripped}/${messageId}`;
}

export function buildTelegramPollContent(channelPost) {
	const poll = channelPost?.poll;
	if (!poll) {
		return null;
	}
	const parts = [];
	if (poll.question) {
		parts.push(`Poll: ${poll.question}`);
	}
	if (Array.isArray(poll.options) && poll.options.length > 0) {
		const optionLines = poll.options.map((option, index) => `${index + 1}. ${option.text}`);
		parts.push(optionLines.join("\n"));
	}
	const link = buildTelegramMessageLink(channelPost);
	if (link) {
		parts.push(link);
	}
	if (parts.length === 0) {
		return null;
	}
	return parts.join("\n\n");
}

export function createTelegramMediaGroupManager({ flushDelayMs = MEDIA_GROUP_FLUSH_MS } = {}) {
	const mediaGroups = new Map();

	async function flushMediaGroup(mediaGroupId) {
		const group = mediaGroups.get(mediaGroupId);
		if (!group) {
			return;
		}
		mediaGroups.delete(mediaGroupId);
		const contentParts = [];
		if (group.text) {
			contentParts.push(group.text);
		} else if (group.emoji) {
			contentParts.push(group.emoji);
		}
		const urls = Array.from(group.urls);
		if (urls.length > 0) {
			contentParts.push(...urls);
		}
		if (contentParts.length === 0) {
			return;
		}
		const content = contentParts.join("\n\n");
		if (typeof group.onFlush === "function") {
			await group.onFlush(content);
		}
	}

	function enqueueMediaGroup({ mediaGroupId, text, emoji, urls, onFlush }) {
		if (!mediaGroupId) {
			return null;
		}
		const group = mediaGroups.get(mediaGroupId) ?? {
			text: "",
			emoji: "",
			urls: new Set(),
			flushPromise: null,
			onFlush: null,
		};
		if (typeof text === "string" && text.length > 0 && !group.text) {
			group.text = text;
		}
		if (emoji && !group.emoji) {
			group.emoji = emoji;
		}
		if (Array.isArray(urls)) {
			for (const url of urls) {
				if (url) {
					group.urls.add(url);
				}
			}
		}
		if (typeof onFlush === "function") {
			group.onFlush = onFlush;
		}
		if (!group.flushPromise) {
			group.flushPromise = new Promise((resolve) => {
				setTimeout(() => {
					flushMediaGroup(mediaGroupId).finally(resolve);
				}, flushDelayMs);
			});
		}
		mediaGroups.set(mediaGroupId, group);
		return group.flushPromise;
	}

	return { enqueueMediaGroup };
}

export async function handleTelegramFileProxy(request, env) {
	const url = new URL(request.url);
	if (request.method !== "GET" || !url.pathname.startsWith("/tg/file/")) {
		return null;
	}
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
