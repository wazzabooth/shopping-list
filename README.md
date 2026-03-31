# 🛒 My Shop — Self-Hosted Shopping List

A self-hosted shopping list with Alexa voice control, Home Assistant integration, and a mobile-first dark UI. Runs on Node.js/Express with a NeDB database. No cloud services required except an Alexa Developer account for the voice skill.

---

## Features

- 🎤 Alexa voice control — add items, read list, multi-item support ("add milk and bread and eggs")
- 📱 Mobile-first PWA — installable on iPhone/Android home screen
- 🌙 Dark mode UI with emoji icons per item
- 🔐 Password protected — username/password login, permanent session token
- ⚙️ Admin panel — stats, share link for a second user, Home Assistant config
- 🔗 Share link — give someone access without a password (e.g. a partner)
- 🏠 Home Assistant integration — push notifications when items are added, add items via HA automations
- ↕️ Drag to reorder items
- 👆 Swipe left to delete on mobile
- ✏️ Double-tap to rename items
- 🔤 Title Case capitalisation on all items

---

## Quick Install

On a fresh Ubuntu LXC, run:

```bash
curl -fsSL https://raw.githubusercontent.com/wazzabooth/shopping-list/main/install.sh | bash
```

The script will:
- Install Node.js 20
- Clone the repo
- Ask for your domain and generate a JWT secret
- Create and start a systemd service
- Print the local URL and next steps

---

## Update

```bash
bash /opt/shopping-list/update.sh
```

Backs up your data (`auth.json`, `stats.json`, `shopping.db`) before pulling the latest version, restores it after, then restarts the service. Your credentials and list are never lost.

---

## Manual Install

If you prefer to set things up yourself:

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Clone repo
git clone https://github.com/wazzabooth/shopping-list.git /opt/shopping-list
cd /opt/shopping-list
npm install
node server.js
# → Shopping list: http://0.0.0.0:3000
# → Default login — username: user  password: user
```

### Systemd service

```bash
cat > /etc/systemd/system/shopping-list.service << 'UNIT'
[Unit]
Description=My Shop — Shopping List
After=network.target

[Service]
WorkingDirectory=/opt/shopping-list
ExecStart=/usr/bin/node /opt/shopping-list/server.js
Restart=always
RestartSec=5
User=root
Environment=PORT=3000
Environment=JWT_SECRET=replace-with-a-long-random-string

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now shopping-list
```

---

## Cloudflare Tunnel

A Cloudflare Tunnel is required to expose the app publicly (needed for Alexa).

### Zero Trust dashboard (recommended)

1. Go to [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Networks → Tunnels**
2. Open your tunnel → **Public Hostnames → Add**
3. Fill in:
   - Subdomain: `shopping`
   - Domain: `yourdomain.com`
   - Service Type: `HTTP`
   - URL: `<lxc-ip>:3000`
   - Leave **Path** empty
4. Save

### config.yml

```yaml
ingress:
  - hostname: shopping.yourdomain.com
    service: http://<lxc-ip>:3000
  # ... your other rules
```

### Cloudflare Security

If requests are being silently blocked, check:
- **Security → WAF** — no custom rules blocking POSTs
- **Security → Bots** — Bot Fight Mode off
- **Zero Trust → Access** — no Access policies on `shopping.yourdomain.com`

---

## Alexa Skill Setup

The skill is **Alexa-Hosted** — Amazon runs the Lambda, you don't need to host an endpoint.

### Step 1 — Create the skill

1. Go to [developer.amazon.com](https://developer.amazon.com) → **Alexa → Create Skill**
2. Name: anything (e.g. "Shopping List")
3. Primary locale: **English (UK/IE)**
4. Experience: Other → Model: **Custom** → Hosting: **Alexa-Hosted (Node.js)**
5. Template: **Start from scratch**
6. Click **Create Skill** and wait (~1 min)

### Step 2 — Interaction model

1. **Build → JSON Editor**
2. Select all and replace with the contents of `alexa-interaction-model.json`
3. **Save Model → Build Model** — wait for green tick

### Step 3 — Invocation name

1. **Build → Invocations → Skill Invocation Name**
2. Set to your preferred phrase e.g. `the list`, `my shop`, `basket`
3. **Save Model → Build Model**

### Step 4 — Lambda code

1. **Code** tab → open `index.js`
2. Replace everything with:

```javascript
const Alexa = require('ask-sdk-core');
const https = require('https');
const API_HOST = 'shopping.yourdomain.com';  // ← change this
const API_PATH = '/api';

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      path: API_PATH + path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const LaunchHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest'; },
  async handle(h) {
    const items = await apiRequest('GET', '/items');
    const unchecked = items.filter(i => !i.checked);
    const speech = unchecked.length > 0
      ? `Shopping list open. You have ${unchecked.length} item${unchecked.length !== 1 ? 's' : ''}. What would you like to add?`
      : 'Shopping list is empty. What would you like to add?';
    return h.responseBuilder.speak(speech).reprompt('Say add, then an item.').getResponse();
  }
};

const AddItemHandler = {
  canHandle(h) {
    return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(h.requestEnvelope) === 'AddItemIntent';
  },
  async handle(h) {
    const item = Alexa.getSlotValue(h.requestEnvelope, 'item');
    const qty  = Alexa.getSlotValue(h.requestEnvelope, 'quantity') || '1';
    if (!item) return h.responseBuilder.speak("Sorry, I didn't catch that. Try: add milk.").reprompt('What to add?').getResponse();
    const itemList = item.split(/,|\band\b/i).map(s => s.trim()).filter(Boolean);
    for (const i of itemList) {
      await apiRequest('POST', '/items', { name: i, quantity: itemList.length === 1 ? qty : '1' });
    }
    const speech = itemList.length > 1
      ? `Added ${itemList.length} items: ${itemList.join(', ')}.`
      : qty !== '1' ? `Added ${qty} ${item}.` : `Added ${item}.`;
    return h.responseBuilder.speak(speech).getResponse();
  }
};

const ReadListHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'ReadListIntent'; },
  async handle(h) {
    const items = await apiRequest('GET', '/items');
    const unchecked = items.filter(i => !i.checked);
    if (!unchecked.length) return h.responseBuilder.speak('Your shopping list is empty.').getResponse();
    const list = unchecked.map(i => i.quantity !== '1' ? `${i.quantity} ${i.name}` : i.name).join(', ');
    return h.responseBuilder.speak(`You have ${unchecked.length} items: ${list}.`).getResponse();
  }
};

const HelpHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent'; },
  handle(h) { return h.responseBuilder.speak("Say add then an item. Or: what's on my list.").reprompt('What to add?').getResponse(); }
};

const StopHandler = {
  canHandle(h) { return Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && ['AMAZON.CancelIntent', 'AMAZON.StopIntent'].includes(Alexa.getIntentName(h.requestEnvelope)); },
  handle(h) { return h.responseBuilder.speak('Bye!').getResponse(); }
};

const ErrorHandler = {
  canHandle() { return true; },
  handle(h, err) { console.error(err); return h.responseBuilder.speak('Something went wrong. Please try again.').getResponse(); }
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(LaunchHandler, AddItemHandler, ReadListHandler, HelpHandler, StopHandler)
  .addErrorHandlers(ErrorHandler)
  .lambda();
```

3. **Save → Deploy**

### Step 5 — Enable for testing

1. **Test** tab → set dropdown to **Development**
2. Type your invocation name to test e.g. `open the list`
3. On your Echo, the skill appears automatically under **More → Skills → Your Skills → Dev**

### Alexa voice commands

| Say | Action |
|-----|--------|
| `Alexa, open the list` | Open the skill |
| `add milk` | Add milk |
| `add milk and bread and eggs` | Add 3 items at once |
| `add two pints of milk` | Add with quantity |
| `what's on my list` | Read all unchecked items |
| `Alexa, ask the list to add milk` | Add without opening first |

---

## First Login

1. Open `https://shopping.yourdomain.com`
2. Log in with username `user`, password `user`
3. You'll be prompted immediately to set your own username and password
4. After saving you're logged in permanently — no need to log in again

---

## Admin Panel

Click ⚙️ in the top right of the app.

### Share link (for a partner / second user)
1. Admin → **Generate share link**
2. Copy and send the link — anyone with it can view and edit the list without logging in
3. Revoke it anytime from the same panel

### Home Assistant integration

1. In HA go to **Profile → Long-Lived Access Tokens → Create Token**
2. Copy the token
3. In Admin → Home Assistant:
   - **URL**: `http://homeassistant.local:8123`
   - **Token**: your long-lived token
   - **Notify service**: `notify` or e.g. `notify.mobile_app_iphone`
4. **Save HA config → Send test notification**

When any item is added (web or Alexa) a push notification is sent to HA automatically.

### Add items from HA automations

Generate a share link first to get your share token, then:

```yaml
# configuration.yaml
rest_command:
  add_to_shopping_list:
    url: "https://shopping.yourdomain.com/ha/add"
    method: POST
    headers:
      x-share-token: "your-share-token-here"
    payload: '{"name": "{{ name }}"}'
    content_type: "application/json"
```

Example automation:
```yaml
automation:
  - alias: "Low milk — add to shopping list"
    trigger:
      - platform: state
        entity_id: sensor.milk_level
        to: "low"
    action:
      - service: rest_command.add_to_shopping_list
        data:
          name: "Milk"
```

---

## Install on Phone (PWA)

### iPhone (Safari)
1. Open the app in Safari
2. Tap Share → **Add to Home Screen** → **Add**

### Android (Chrome)
1. Open the app in Chrome
2. Tap the install banner or three-dot menu → **Add to Home Screen**

---

## File Structure

```
shopping-list/
├── install.sh                     # One-line install script
├── update.sh                      # Update to latest version
├── server.js                      # Express server, API, auth, HA integration
├── package.json
├── alexa-interaction-model.json   # Paste into Alexa Developer Console
├── README.md
├── .gitignore
└── public/
    ├── index.html                 # Full SPA — login, app, admin panel
    ├── manifest.json              # PWA manifest
    ├── sw.js                      # Service worker
    ├── icon-192.svg               # PWA icon
    └── icon-512.svg               # PWA icon
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port to listen on |
| `JWT_SECRET` | `myshop-secret-change-me` | JWT signing secret — **always change this** |

---

## Troubleshooting

**Alexa says "something went wrong"**
- Check Alexa Developer Console → Code → CloudWatch Logs
- Verify `API_HOST` in `index.js` matches your Cloudflare domain
- Run `curl https://shopping.yourdomain.com/api/items` — should return a JSON array

**App won't load / stuck on login**
- Clear browser localStorage and log in again
- Check `systemctl status shopping-list` on the LXC

**Forgot password**
- Delete `/opt/shopping-list/auth.json` and restart — resets to `user`/`user`
- Or run `bash /opt/shopping-list/update.sh` which preserves your data

**Cloudflare silently blocking requests**
- Zero Trust → Access — no policies on your subdomain
- Security → WAF — no custom rules blocking POSTs
- Security → Bots — Bot Fight Mode off
