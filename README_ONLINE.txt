# Veyrun Online Starter v2.0

This is a starter online layer for the Veyrun browser RPG. It adds accounts, shared live chat, online player list, friends, trade requests, and server-side inventory/coin transfers.

## Quick start (PC/Mac/Linux)

1. Install Node.js 18 or newer.
2. Extract this ZIP into a folder.
3. Open a terminal in that folder and run:

   ```bash
   npm install
   npm start
   ```

4. Open `http://localhost:8787` in your browser.
5. Open the same URL in another browser/device connected to the same network to test two accounts.

The online client defaults to `ws://localhost:8787`. For another device on the same Wi-Fi, set the URL in the Online tab to `ws://YOUR-COMPUTER-LAN-IP:8787`. Your firewall may need to allow the port.

## Hosting for friends over the internet

Deploy the folder on a Node.js host that supports long-lived WebSocket connections. Put it behind HTTPS and use `wss://your-domain/` for the Online tab. Do not expose a plain `ws://` service publicly. A reverse proxy must forward WebSocket upgrades to the Node process.

## What is included

- Username/password registration (passwords are salted and hashed with Node's built-in scrypt).
- Shared world chat with basic link filtering and bounded message history.
- Live online player list.
- Friends list.
- Trade requests, accept/decline, and server-side checks for item/coin balances before transfers.
- Server-side online profile inventory and coins.
- JSON persistence under `data/`.

## Important prototype limitations

- This is a starter, not a production MMO backend. It needs deployment, HTTPS/WSS, backups, rate limits, account recovery, moderation/reporting, and stronger abuse/security controls before public release.
- The online profile inventory is separate from the offline Veyrun save. It is intentionally not automatically synced from the browser because a client-supplied inventory cannot be trusted as authoritative.
- Trade profiles start with a small sample inventory and 100 coins. The trade system only transfers items and coins already present in the server-side online profile.
- Friends are a stored list; friend presence/DMs and a full shared movement/combat world are not implemented yet.
- The server keeps account and chat JSON files locally. For a real public game, use a proper database and a deployment platform with persistent storage.
- This project is an original fan-style prototype and is not affiliated with RuneScape.

## Safety

Use a unique test password. Do not collect or store real personal information. Only host for people you trust until you have added moderation, rate limiting, backups, and security review.
