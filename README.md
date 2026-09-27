# baileys-buttons

Send WhatsApp **interactive buttons, dropdown lists and polls** with
[Baileys](https://github.com/WhiskeySockets/Baileys), without modifying
Baileys' source.

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

## Install

Copy `baileys-buttons.js` into your project (it only needs
`@whiskeysockets/baileys` as a peer dependency):

```js
const {
  sendButtons,
  sendUrlButtons,
  sendCopyButtons,
  sendCallButtons,
  sendList,
  sendPoll,
  sendInteractive,
  getButtonReplyId,
  getListReplyId,
} = require('./baileys-buttons');
```

## API — one ready function per type

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

### `sendList` — dropdown menu with sections

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
const { sendInteractive, quickReply, ctaUrl, ctaCopy } = require('./baileys-buttons');

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
