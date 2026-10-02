# baileys-buttons

Send WhatsApp **interactive buttons, dropdown lists and polls** with
[Baileys](https://github.com/WhiskeySockets/Baileys), without modifying
Baileys' source.

## Files

| File | For |
|---|---|
| `baileys-buttons.mjs` | ES modules (`import`) — recommended |
| `baileys-buttons.cjs` | CommonJS (`require`) |
| `demo.mjs` | Standalone verification script (ESM) |
| `package.json` | Metadata with `exports` map for both builds |

Both builds export the exact same API.

## Why this exists

Baileys' own `sock.sendMessage()` has no branch for `interactiveMessage`
(it throws `Invalid media type`), and a bare `relayMessage` is not enough
either — WhatsApp expects binary wrapper nodes (`biz` +
`interactive`/`native_flow`, plus `bot` in private chats) around interactive
messages, otherwise the client silently drops them. This helper builds the
message exactly the way the official client does:

- `generateWAMessageFromContent` + `relayMessage`
- `interactiveMessage` wrapped in `viewOnceMessage`, with
  `messageContextInfo` **inside** the wrapper (a top-level
  `interactiveMessage` renders with disabled/grayed-out buttons)
- required binary nodes: `biz → interactive(type=native_flow,v=1) →
  native_flow(v=9,name=mixed)` and `bot(biz_bot=1)` in private chats
- `userJid: sock.user.id` passed to the message generator

Dropdown lists (`sendList`) use the classic `ListMessage` proto instead:
`generateWAMessageFromContent` + `relayMessage` with the
`biz → list(type=product_list,v=2)` node and no `viewOnceMessage` wrapper —
the interactive `single_select` variant does not render on iOS.

## Install

```bash
npm install baileys-buttons
```

It only needs `@whiskeysockets/baileys` as a peer dependency:

```js
// ESM
import { sendButtons, sendList } from 'baileys-buttons';
// CommonJS
const { sendButtons, sendList } = require('baileys-buttons');
```

Prefer a single file? Copy `baileys-buttons.mjs` (ESM) or `baileys-buttons.cjs`
(CommonJS) directly into your project instead.


## API — one ready function per type

**AI badge:** in 1:1 chats the helper adds the `bot` binary node, which makes
WhatsApp show the AI ✨ badge on the message. Pass `ai: false` to any sender
(`sendButtons`, `sendList`, `sendUrlButtons`, `sendCopyButtons`,
`sendCallButtons`, `sendInteractive`, `sendFooterOnly`) to send without the
badge. Group chats never get the badge.

### `sendButtons` — quick-reply buttons (up to 3)

```js
await sendButtons(sock, jid, {
  text: 'Pick one:',
  footer: 'optional footer',   // optional
  title: 'optional header',    // optional
  buttons: [
    { id: 'yes', displayText: 'Yes ✅' },
    { id: 'no', displayText: 'No ❌' },
  ],
  quoted,                      // optional: quote a message
});
// → returns msg.key
```

### `sendUrlButtons` — open a URL on tap

```js
await sendUrlButtons(sock, jid, {
  text: 'Links:',
  buttons: [
    { displayText: 'Open site 🌐', url: 'https://example.com' },
  ],
});
```

### `sendCopyButtons` — copy text to clipboard on tap

```js
await sendCopyButtons(sock, jid, {
  text: 'Your code:',
  buttons: [
    { displayText: 'Copy code 📋', copyCode: 'DEMO-1234' },
  ],
});
```

### `sendCallButtons` — tap to dial

```js
await sendCallButtons(sock, jid, {
  text: 'Call us:',
  buttons: [
    { displayText: 'Call 📞', phoneNumber: '+972501234567' },
  ],
});
```

### `sendList` — dropdown menu with sections (iOS-compatible)

Sends the classic `ListMessage` proto (`ListType.SINGLE_SELECT`) with the
`<biz><list type="product_list" v="2"/></biz>` relay node — no
`viewOnceMessage` wrapper. The interactive `single_select` (native_flow)
list does **not** render on iOS, so this is the default. Tapping a row
returns its `id`; read it with `getListReplyId()`.

```js
await sendList(sock, jid, {
  text: 'Choose an item:',
  buttonText: 'Open menu 📋',
  sections: [
    {
      title: 'Fruits',
      rows: [
        { id: 'apple', title: 'Apple 🍎', description: 'Green and crisp' },
        { id: 'banana', title: 'Banana 🍌' },
      ],
    },
  ],
});
```

### `sendInteractiveList` — dropdown via native_flow `single_select`

Same options as `sendList`, but uses the interactive `single_select` button.
Renders on Android; does **not** render on iOS. Kept for cases where the
interactive variant is preferred.

### `sendFooterOnly` — footer text, no buttons

```js
await sendFooterOnly(sock, jid, {
  text: 'Just a message',
  footer: 'small footer text',  // optional
  title: 'optional header',     // optional
  ai: false,                    // optional: skip the AI ✨ badge
});
```

### `sendPoll` — native poll

```js
await sendPoll(sock, jid, {
  name: 'Best time? 🕐',
  options: ['Morning 🌅', 'Noon ☀️', 'Evening 🌙'],
  selectableOptionsCount: 1, // optional
});
```

### `sendInteractive` — mix any types in one message

For mixed-type messages, build buttons with the builders and pass them raw:

```js
const { sendInteractive, quickReply, ctaUrl, ctaCopy } = require('baileys-buttons');

await sendInteractive(sock, jid, {
  text: 'Mixed actions:',
  buttons: [
    quickReply('later', 'Later ⏰'),
    ctaUrl('Open site 🌐', 'https://example.com'),
    ctaCopy('Copy code 📋', 'DEMO-1234'),
  ],
});
```

Available builders: `quickReply(id, displayText)`, `ctaUrl(displayText, url)`,
`ctaCopy(displayText, copyCode)`, `ctaCall(displayText, phoneNumber)`,
`singleSelectButton(buttonTitle, sections)`.

## Reading replies

```js
sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const m of messages) {
    // quick_reply taps AND single_select picks (some clients)
    const btnId = getButtonReplyId(m.message);
    if (btnId) {
      console.log('pressed:', btnId);
      continue;
    }
    // legacy list replies
    const rowId = getListReplyId(m.message);
    if (rowId) console.log('picked row:', rowId);
  }
});
```

## Notes

- If your project uses ES modules (`"type": "module"` in package.json),
  rename both files to `.cjs` (`baileys-buttons.cjs`, `demo.cjs`) and run
  `node demo.cjs` — `require` does not work in ESM scope.
- `quick_reply` buttons render grayed-out/disabled in **self-chat** ("message
  yourself") — WhatsApp disables reply-buttons on messages you sent yourself.
  They are fully tappable for the recipient in a normal chat. `cta_*`
  buttons are tappable everywhere.
- Keep button counts small (quick replies: max 3 per message).
- Tested with `@whiskeysockets/baileys` `7.0.0-rc14`.
