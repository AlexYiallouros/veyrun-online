VEYRUN ONLINE STARTER — ADMIN + SHARED WORLD UPDATE

Files:
- veyrun_v20.html: mobile game client
- veyrun_server.js: Node.js WebSocket/HTTP server
- package.json: npm start configuration
- README_ONLINE.txt: this guide

Deploy on Render:
Build command: npm install
Start command: npm start
Root directory: blank

IMPORTANT: configure Render Environment variables before claiming admin:
- VEYRUN_ADMIN_KEY = a long random secret you create and keep private
- VEYRUN_ADMIN_USERNAME = your exact Veyrun account username (recommended; restricts admin claim to this account)

In Render: open your Web Service -> Environment -> Add Environment Variable. Save changes and redeploy.
Then sign into Veyrun using your chosen admin username, open Online, and enter the VEYRUN_ADMIN_KEY into Admin setup -> Claim admin access. The server persists your role in its user data.

Admin panel:
- Give/remove any named item by exact item name and quantity
- Add coins or set a player's balance
- View online/offline accounts, balances and ban state
- Ban/unban or kick players
All admin actions are checked by the server. Admin cannot ban/kick another admin via this panel.

Shared world:
- Online players share a 7x7 live movement grid in the Online tab.
- Direction buttons update server positions and broadcast them to all connected clients.
- This is a starter shared movement space, not yet a fully integrated graphical combat world.

Security / persistence:
- Use a strong unique VEYRUN_ADMIN_KEY. Do not paste it into GitHub or share it with players.
- This is a prototype. Before inviting the public, add a persistent disk/database on Render, rate limiting, stronger moderation/logging, and security review.
- Render filesystems may be ephemeral unless persistent storage is configured; account, ban, and chat JSON files can be lost on redeploy/restart depending on hosting setup.
- Online profiles remain separate from offline localStorage saves.
