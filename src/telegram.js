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

function extractTelegramFileName(filePath) {
	if (!filePath) {
		return null;
	}
	const parts = filePath.split("/").filter(Boolean);
	if (parts.length === 0) {
		return null;
	}
	return parts[parts.length - 1] ?? null;
}

function inferFileExtension(filename) {
	if (!filename) {
		return null;
	}
	const lastDot = filename.lastIndexOf(".");
	if (lastDot <= 0 || lastDot === filename.length - 1) {
		return null;
	}
	return filename.slice(lastDot + 1).toLowerCase();
}

function formatTimestamp(date = new Date()) {
	const pad = (value) => String(value).padStart(2, "0");
	const year = date.getUTCFullYear();
	const month = pad(date.getUTCMonth() + 1);
	const day = pad(date.getUTCDate());
	const hours = pad(date.getUTCHours());
	const minutes = pad(date.getUTCMinutes());
	const seconds = pad(date.getUTCSeconds());
	return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function generateTimestampId(counter, date = new Date()) {
	const base = formatTimestamp(date);
	const suffix = counter > 0 ? `-${String(counter).padStart(2, "0")}` : "";
	return `${base}${suffix}`;
}

function buildR2PublicUrl({ baseUrl, objectKey }) {
	if (!baseUrl || !objectKey) {
		return null;
	}
	return `${baseUrl.replace(/\/$/, "")}/${objectKey}`;
}

let uploadCounter = 0;
let uploadCounterSecond = null;

function nextUploadCounter(date) {
	const secondKey = date.toISOString().slice(0, 19);
	if (uploadCounterSecond !== secondKey) {
		uploadCounterSecond = secondKey;
		uploadCounter = 0;
	}
	const current = uploadCounter;
	uploadCounter += 1;
	return current;
}

async function uploadTelegramFile({ fileId, botToken, bucket, format, label }) {
	console.log("Uploading Telegram media to R2", { fileId, label: label ?? "media" });
	const date = new Date();
	const counter = nextUploadCounter(date);
	const filePath = await getTelegramFilePath(fileId, botToken);
	const filename = extractTelegramFileName(filePath);
	let extension = inferFileExtension(filename);
	if (format === "png") {
		extension = "png";
	}
	const idBase = generateTimestampId(counter, date);
	const objectKey = extension ? `${idBase}.${extension}` : idBase;
	const tgUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
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
	if (!tgResp.ok) {
		throw new Error(`Telegram download failed: ${tgResp.status}`);
	}
	const contentType = tgResp.headers.get("Content-Type") ?? undefined;
	const cacheControl = tgResp.headers.get("Cache-Control") ?? "public, max-age=31536000, immutable";
	const httpMetadata = contentType ? { contentType, cacheControl } : { cacheControl };
	await bucket.put(objectKey, tgResp.body, {
		httpMetadata,
	});
	console.log("Uploaded Telegram media to R2", { fileId, objectKey });
	return { objectKey, filename, extension, contentType };
}

async function buildMediaUrl({ fileId, botToken, bucket, baseUrl, format, label }) {
	if (!fileId) {
		return null;
	}
	try {
		const result = await uploadTelegramFile({ fileId, botToken, bucket, format, label });
		return buildR2PublicUrl({ baseUrl, objectKey: result.objectKey });
	} catch (err) {
		console.warn("Failed to upload Telegram media:", err);
		return null;
	}
}

async function buildPhotoUrl(photoArray, botToken, requestUrl, bucket, baseUrl) {
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
	return buildMediaUrl({ fileId: bestPhoto.file_id, botToken, bucket, baseUrl, label: "photo" });
}

async function buildFileUrl(file, botToken, requestUrl, label, bucket, baseUrl) {
	if (!file || !file.file_id) {
		return null;
	}
	if (!botToken) {
		console.warn(`Missing telegramBotToken, skipping ${label}`);
		return null;
	}
	return buildMediaUrl({ fileId: file.file_id, botToken, bucket, baseUrl, label });
}

async function buildStickerUrl(sticker, botToken, requestUrl, bucket, baseUrl) {
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
	return buildMediaUrl({ fileId, botToken, bucket, baseUrl, format, label: "sticker" });
}

export async function collectTelegramMediaUrls(channelPost, botToken, requestUrl, env) {
	const urls = [];
	if (!env?.MEDIA_BUCKET || !env?.R2_PUBLIC_BASE_URL) {
		console.warn("Missing MEDIA_BUCKET or R2_PUBLIC_BASE_URL, skipping media uploads");
		return urls;
	}
	const baseUrl = env.R2_PUBLIC_BASE_URL;
	const bucket = env.MEDIA_BUCKET;
	const photoUrl = await buildPhotoUrl(channelPost.photo, botToken, requestUrl, bucket, baseUrl);
	if (photoUrl) {
		urls.push(photoUrl);
	}
	const stickerUrl = await buildStickerUrl(channelPost.sticker, botToken, requestUrl, bucket, baseUrl);
	if (stickerUrl) {
		urls.push(stickerUrl);
	}
	const videoUrl = await buildFileUrl(channelPost.video, botToken, requestUrl, "video", bucket, baseUrl);
	if (videoUrl) {
		urls.push(videoUrl);
	}
	const animationUrl = await buildFileUrl(channelPost.animation, botToken, requestUrl, "animation", bucket, baseUrl);
	if (animationUrl) {
		urls.push(animationUrl);
	}
	const documentUrl = await buildFileUrl(channelPost.document, botToken, requestUrl, "document", bucket, baseUrl);
	if (documentUrl) {
		urls.push(documentUrl);
	}
	const audioUrl = await buildFileUrl(channelPost.audio, botToken, requestUrl, "audio", bucket, baseUrl);
	if (audioUrl) {
		urls.push(audioUrl);
	}
	const voiceUrl = await buildFileUrl(channelPost.voice, botToken, requestUrl, "voice", bucket, baseUrl);
	if (voiceUrl) {
		urls.push(voiceUrl);
	}
	const videoNoteUrl = await buildFileUrl(channelPost.video_note, botToken, requestUrl, "video_note", bucket, baseUrl);
	if (videoNoteUrl) {
		urls.push(videoNoteUrl);
	}
	return urls;
}

function buildTelegramChatMessageLink(chat, messageId) {
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

function buildTelegramMessageLink(channelPost) {
	if (!channelPost) {
		return null;
	}
	const messageId = channelPost.message_id;
	const chat = channelPost.chat ?? channelPost.sender_chat;
	return buildTelegramChatMessageLink(chat, messageId);
}

function buildTelegramSourceLabel(source) {
	if (!source) {
		return null;
	}
	if (source.title) {
		return source.username ? `${source.title} (@${source.username})` : source.title;
	}
	if (source.first_name || source.last_name) {
		const nameParts = [source.first_name, source.last_name].filter(Boolean);
		return nameParts.join(" ");
	}
	if (source.username) {
		return `@${source.username}`;
	}
	return null;
}

function resolveForwardOrigin(channelPost) {
	const origin = channelPost?.forward_origin;
	if (!origin) {
		return null;
	}
	if (origin.type === "channel") {
		return {
			label: buildTelegramSourceLabel(origin.chat),
			chat: origin.chat,
			messageId: origin.message_id,
		};
	}
	if (origin.type === "chat") {
		return {
			label: buildTelegramSourceLabel(origin.sender_chat),
			chat: origin.sender_chat,
			messageId: null,
		};
	}
	if (origin.type === "user") {
		return {
			label: buildTelegramSourceLabel(origin.sender_user),
			chat: null,
			messageId: null,
		};
	}
	if (origin.type === "hidden_user") {
		return {
			label: origin.sender_user_name,
			chat: null,
			messageId: null,
		};
	}
	return null;
}

export function buildTelegramForwardContent(channelPost) {
	if (!channelPost) {
		return null;
	}
	const origin = resolveForwardOrigin(channelPost);
	let label = origin?.label ?? null;
	let chat = origin?.chat ?? null;
	let messageId = origin?.messageId ?? null;
	if (!label) {
		const forwardedChat = channelPost.forward_from_chat ?? null;
		label = buildTelegramSourceLabel(forwardedChat);
		chat = forwardedChat;
		messageId = channelPost.forward_from_message_id ?? null;
	}
	if (!label && channelPost.forward_from) {
		label = buildTelegramSourceLabel(channelPost.forward_from);
	}
	if (!label && channelPost.forward_sender_name) {
		label = channelPost.forward_sender_name;
	}
	if (!label) {
		return null;
	}
	const link = buildTelegramChatMessageLink(chat, messageId);
	const linkText = link ? `\n${link}` : "";
	return `Forwarded from ${label}${linkText}`;
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
		if (group.forwardedText) {
			contentParts.push(group.forwardedText);
		}
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

	function enqueueMediaGroup({ mediaGroupId, text, emoji, urls, forwardedText, onFlush }) {
		if (!mediaGroupId) {
			return null;
		}
		const group = mediaGroups.get(mediaGroupId) ?? {
			text: "",
			emoji: "",
			forwardedText: "",
			urls: new Set(),
			flushPromise: null,
			onFlush: null,
		};
		if (typeof forwardedText === "string" && forwardedText.length > 0 && !group.forwardedText) {
			group.forwardedText = forwardedText;
		}
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

