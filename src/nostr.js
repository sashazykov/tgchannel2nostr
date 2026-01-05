import * as secp from '@noble/secp256k1';

const regex = /#(.*?) /gm;

function exactHashTag(content) {
    const array = [...content.matchAll(regex)];
    return array.map(m => ["t", m[1]])
}

function serializeEvent(content, publicKey, createdAt, tags) {
    return JSON.stringify(
        [
            0,
            publicKey,
            createdAt,
            1,
            tags,
            content
        ]
    )
}

export async function generateNip01Event(content, publicKey, privateKey) {
    let nip01Event = {};
    const createdAt = Math.floor(Date.now() / 1000);
    const tags = exactHashTag(content);
    const idImage = new TextEncoder().encode(
        serializeEvent(content, publicKey, createdAt, tags)
    );
    const idHash = await crypto.subtle.digest(
        {
            name: 'SHA-256',
        },
        idImage
    );
    nip01Event.id = secp.utils.bytesToHex(new Uint8Array(idHash));
    nip01Event.pubkey = publicKey;
    nip01Event.created_at = createdAt;
    nip01Event.kind = 1;
    nip01Event.tags = tags;
    nip01Event.content = content;
    nip01Event.sig = secp.utils.bytesToHex(await secp.schnorr.sign(nip01Event.id, privateKey));
    return JSON.stringify(nip01Event)
}

export async function sendEvent(nip01Event, { timeoutMs = 5000 } = {}) {
    const resp = await fetch("https://nos.lol",
        {
            headers: {
                Upgrade: 'websocket',
            },
        });
    const ws = resp.webSocket;
    if (!ws) {
        throw new Error("server didn't accept WebSocket");
    }
    ws.accept();

    return await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            ws.close(1000, "timeout");
            reject(new Error(`nostr relay timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const finalize = (fn) => (value) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            fn(value);
        };

        ws.addEventListener('message', finalize((msg) => {
            ws.close(1000, "ok");
            resolve(msg.data);
        }));

        ws.addEventListener('close', finalize(() => {
            resolve("closed");
        }));

        ws.addEventListener('error', finalize((err) => {
            reject(err);
        }));

        ws.send(nip01Event);
    });
}
