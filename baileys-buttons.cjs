'use strict';
/**
 * baileys-buttons — send WhatsApp interactive buttons, lists and polls
 * with Baileys (WhiskeySockets), without modifying Baileys' source.
 *
 * Why this exists: Baileys' own `sock.sendMessage()` has no branch for
 * `interactiveMessage` and throws "Invalid media type", and a bare
 * `relayMessage` is not enough either — WhatsApp expects binary wrapper
 * nodes (`biz` + `interactive`/`native_flow`, plus `bot` in private chats)
 * around interactive messages, otherwise the client silently drops them.
 * This helper builds the message exactly the way the official client does.
 *
 * Supported button types (stable on official clients):
 *   - quick_reply : simple reply button, its `id` comes back on tap
 *   - single_select : in-button dropdown list (sections + rows)
 *   - cta_url : open a URL
 *   - cta_copy : copy text to clipboard
 *   - cta_call : tap to dial a phone number
 * Plus: native polls via `sendPoll`.
 *
 * Lists: `sendList` sends the classic ListMessage proto (renders on iOS
 * and Android). `sendInteractiveList` sends the native_flow single_select
 * variant (Android only — does not render on iOS).
 *
 * Plus: `sendRequestPhoneNumber` (ask the recipient to share their number),
 * `sendLocation` (send a map pin).
 *
 * Usage:
 *   const { sendButtons, sendUrlButtons, sendCopyButtons, sendCallButtons,
 *           sendList, sendPoll, getButtonReplyId } = require('./baileys-buttons');
 *
 *   await sendButtons(sock, jid, {
 *     text: 'Pick one:',
 *     buttons: [
 *       { id: 'yes', displayText: 'Yes ✅' },
 *       { id: 'no', displayText: 'No ❌' },
 *     ],
 *   });
 *
 *   await sendUrlButtons(sock, jid, {
 *     text: 'Links:',
 *     buttons: [{ displayText: 'Open site 🌐', url: 'https://example.com' }],
 *   });
 */

const {
  generateWAMessageFromContent,
  proto,
} = require('@whiskeysockets/baileys');

// ---------------------------------------------------------------------------
// Button builders — each returns a raw native-flow button definition
// ({ name, buttonParamsJson }) accepted by sendInteractive.
// ---------------------------------------------------------------------------

/** Simple reply button. Tapping sends `id` back to the bot. */
function quickReply(id, displayText) {
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: displayText, id }),
  };
}

/** Open a URL when tapped. */
function ctaUrl(displayText, url) {
  return {
    name: 'cta_url',
    buttonParamsJson: JSON.stringify({ display_text: displayText, url }),
  };
}

/** Copy `copyCode` to the clipboard when tapped. */
function ctaCopy(displayText, copyCode) {
  return {
    name: 'cta_copy',
    buttonParamsJson: JSON.stringify({ display_text: displayText, copy_code: copyCode }),
  };
}

/** Dial `phoneNumber` when tapped (e.g. '+972501234567'). */
function ctaCall(displayText, phoneNumber) {
  return {
    name: 'cta_call',
    buttonParamsJson: JSON.stringify({ display_text: displayText, phone_number: phoneNumber }),
  };
}

/**
 * Dropdown list button.
 * @param {string} buttonTitle text on the button that opens the list
 * @param {Array<{title?:string, rows:Array<{id:string,title:string,description?:string}>}>} sections
 */
function singleSelectButton(buttonTitle, sections) {
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
      title: buttonTitle,
      sections: sections.map((s) => ({
        title: s.title || '',
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description || '',
        })),
      })),
    }),
  };
}

// ---------------------------------------------------------------------------
// Binary wrapper nodes WhatsApp requires around interactive messages.
// ---------------------------------------------------------------------------

function interactiveNodes(jid, ai = true) {
  const nodes = [
    {
      tag: 'biz',
      attrs: {},
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [
            {
              tag: 'native_flow',
              attrs: { v: '9', name: 'mixed' },
            },
          ],
        },
      ],
    },
  ];
  // Private (non-group) chats get the bot node (renders the AI badge) —
  // pass ai: false to skip it and send without the badge.
  if (ai && !String(jid).endsWith('@g.us')) {
    nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

/**
 * Generic interactive message sender. `buttons` are raw native-flow
 * definitions — use the builders above (quickReply, ctaUrl, ctaCopy,
 * ctaCall, singleSelectButton) or craft your own { name, buttonParamsJson }.
 */
async function sendInteractive(
  sock,
  jid,
  { text, footer = '', title = '', buttons, quoted, ai = true } = {}
) {
  if (!text) throw new Error('sendInteractive: text is required');
  if (!Array.isArray(buttons) || buttons.length === 0) {
    throw new Error('sendInteractive: buttons must be a non-empty array');
  }

  const msg = generateWAMessageFromContent(
    jid,
    {
      // The interactiveMessage MUST be wrapped in viewOnceMessage with
      // messageContextInfo INSIDE the wrapper — a top-level
      // interactiveMessage renders with disabled (grayed-out) buttons.
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: proto.Message.InteractiveMessage.create({
            header: proto.Message.InteractiveMessage.Header.create({
              title,
              hasMediaAttachment: false,
            }),
            body: proto.Message.InteractiveMessage.Body.create({ text }),
            footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
            nativeFlowMessage:
              proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons }),
          }),
        },
      },
    },
    { quoted, userJid: sock.user?.id }
  );

  await sock.relayMessage(jid, msg.message, {
    messageId: msg.key.id,
    additionalNodes: interactiveNodes(jid, ai),
  });
  return msg.key;
}

/**
 * Quick-reply buttons (up to 3).
 * @param {Array<{id:string, displayText:string}>} opts.buttons
 */
async function sendButtons(
  sock,
  jid,
  { text, footer = '', title = '', buttons, quoted, ai = true } = {}
) {
  if (!Array.isArray(buttons) || buttons.length === 0) {
    throw new Error('sendButtons: buttons must be a non-empty array');
  }
  if (buttons.length > 3) {
    throw new Error('sendButtons: WhatsApp allows max 3 buttons per message');
  }
  return sendInteractive(sock, jid, {
    text,
    footer,
    title,
    quoted,
    ai,
    buttons: buttons.map((b) => quickReply(b.id, b.displayText)),
  });
}

/**
 * Dropdown list message (menu with sections) — iOS-compatible.
 *
 * The interactive native_flow `single_select` list does NOT render on iOS.
 * This sends the classic `ListMessage` proto with `ListType.SINGLE_SELECT`
 * and the `<biz><list type="product_list" v="2"/></biz>` relay node instead —
 * without the viewOnceMessage wrapper. Tapping a row returns its `id`,
 * readable with `getListReplyId()` (listResponseMessage.singleSelectReply).
 *
 * `ai` is accepted for API consistency but has no effect here — classic
 * lists never show the AI badge (no `bot` binary node is sent).
 */
async function sendList(
  sock,
  jid,
  { text, footer = '', title = '', buttonText, sections, quoted, ai = true } = {}
) {
  if (!buttonText) throw new Error('sendList: buttonText is required');
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('sendList: sections must be a non-empty array');
  }

  const msg = generateWAMessageFromContent(
    jid,
    {
      // Classic ListMessage — sent WITHOUT the viewOnceMessage wrapper.
      listMessage: proto.Message.ListMessage.create({
        title: title || undefined,
        description: text,
        buttonText,
        listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
        sections: sections.map((s) => ({
          title: s.title || '',
          rows: s.rows.map((r) => ({
            title: r.title,
            description: r.description || '',
            rowId: r.id,
          })),
        })),
        footerText: footer || undefined,
      }),
    },
    { quoted, userJid: sock.user?.id }
  );

  await sock.relayMessage(jid, msg.message, {
    messageId: msg.key.id,
    additionalNodes: [
      {
        tag: 'biz',
        attrs: {},
        content: [{ tag: 'list', attrs: { type: 'product_list', v: '2' } }],
      },
    ],
  });
  return msg.key;
}

/**
 * Dropdown list via interactive native_flow `single_select`.
 * Same options as `sendList`. Renders on Android; does NOT render on iOS —
 * use `sendList` for the iOS-compatible classic list.
 */
async function sendInteractiveList(
  sock,
  jid,
  { text, footer = '', title = '', buttonText, sections, quoted, ai = true } = {}
) {
  if (!buttonText) throw new Error('sendInteractiveList: buttonText is required');
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('sendInteractiveList: sections must be a non-empty array');
  }
  return sendInteractive(sock, jid, {
    text,
    footer,
    title,
    quoted,
    ai,
    buttons: [singleSelectButton(buttonText, sections)],
  });
}

/**
 * URL buttons (open a link on tap).
 * @param {Array<{displayText:string, url:string}>} opts.buttons
 */
async function sendUrlButtons(
  sock,
  jid,
  { text, footer = '', title = '', buttons, quoted, ai = true } = {}
) {
  if (!Array.isArray(buttons) || buttons.length === 0) {
    throw new Error('sendUrlButtons: buttons must be a non-empty array');
  }
  return sendInteractive(sock, jid, {
    text,
    footer,
    title,
    quoted,
    ai,
    buttons: buttons.map((b) => ctaUrl(b.displayText, b.url)),
  });
}

/**
 * Copy-to-clipboard buttons.
 * @param {Array<{displayText:string, copyCode:string}>} opts.buttons
 */
async function sendCopyButtons(
  sock,
  jid,
  { text, footer = '', title = '', buttons, quoted, ai = true } = {}
) {
  if (!Array.isArray(buttons) || buttons.length === 0) {
    throw new Error('sendCopyButtons: buttons must be a non-empty array');
  }
  return sendInteractive(sock, jid, {
    text,
    footer,
    title,
    quoted,
    ai,
    buttons: buttons.map((b) => ctaCopy(b.displayText, b.copyCode)),
  });
}

/**
 * Call buttons (tap to dial).
 * @param {Array<{displayText:string, phoneNumber:string}>} opts.buttons
 */
async function sendCallButtons(
  sock,
  jid,
  { text, footer = '', title = '', buttons, quoted, ai = true } = {}
) {
  if (!Array.isArray(buttons) || buttons.length === 0) {
    throw new Error('sendCallButtons: buttons must be a non-empty array');
  }
  return sendInteractive(sock, jid, {
    text,
    footer,
    title,
    quoted,
    ai,
    buttons: buttons.map((b) => ctaCall(b.displayText, b.phoneNumber)),
  });
}

/**
 * Native poll (vote buttons).
 */
async function sendPoll(
  sock,
  jid,
  { name, options, selectableOptionsCount = 1, quoted } = {}
) {
  if (!name) throw new Error('sendPoll: name is required');
  if (!Array.isArray(options) || options.length < 2) {
    throw new Error('sendPoll: options must be an array of at least 2');
  }
  const msg = generateWAMessageFromContent(
    jid,
    {
      poll: {
        name,
        values: options,
        selectableCount: selectableOptionsCount,
      },
    },
    { quoted }
  );
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  return msg.key;
}

/**
 * Ask the recipient to share their phone number.
 * Sends the native `requestPhoneNumberMessage` — WhatsApp shows the
 * recipient a system "share phone number" prompt.
 *
 * NOTE: this was previously tried via baileys-easy and stripped after
 * failed live tests, so verify on a real phone before relying on it.
 * When the recipient shares, tell me what message arrives and I'll add
 * a reply parser for it.
 */
async function sendRequestPhoneNumber(sock, jid, { quoted } = {}) {
  const msg = generateWAMessageFromContent(
    jid,
    { requestPhoneNumberMessage: {} },
    { quoted, userJid: sock.user?.id }
  );
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  return msg.key;
}

/**
 * Send a location (map pin).
 * Note: WhatsApp has no API to *request* the recipient's location —
 * this sends the bot's location. There is no request-location message
 * in the protocol.
 */
async function sendLocation(
  sock,
  jid,
  { latitude, longitude, name = '', address = '', quoted } = {}
) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('sendLocation: latitude and longitude (numbers) are required');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('sendLocation: latitude must be -90..90, longitude -180..180');
  }
  const msg = generateWAMessageFromContent(
    jid,
    {
      locationMessage: {
        degreesLatitude: latitude,
        degreesLongitude: longitude,
        name: name || undefined,
        address: address || undefined,
      },
    },
    { quoted, userJid: sock.user?.id }
  );
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  return msg.key;
}

// ---------------------------------------------------------------------------
/**
 * Footer-only interactive message (no buttons).
 * WhatsApp renders body + footer text. Pass `ai: false` to send
 * without the AI badge (skips the `bot` binary node).
 */
async function sendFooterOnly(
  sock,
  jid,
  { text, footer = '', title = '', quoted, ai = true } = {}
) {
  if (!text) throw new Error('sendFooterOnly: text is required');

  const msg = generateWAMessageFromContent(
    jid,
    {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: proto.Message.InteractiveMessage.create({
            header: proto.Message.InteractiveMessage.Header.create({
              title,
              hasMediaAttachment: false,
            }),
            body: proto.Message.InteractiveMessage.Body.create({ text }),
            footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
            nativeFlowMessage:
              proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons: [] }),
          }),
        },
      },
    },
    { quoted, userJid: sock.user?.id }
  );

  await sock.relayMessage(jid, msg.message, {
    messageId: msg.key.id,
    additionalNodes: interactiveNodes(jid, ai),
  });
  return msg.key;
}

// Reply parsing
// ---------------------------------------------------------------------------

/**
 * Extract the pressed button id from an interactive reply.
 * Handles quick_reply taps (nativeFlowResponseMessage.paramsJson)
 * and single_select picks (singleSelectReply) on some clients.
 * Returns the id string, or null if not a button reply.
 */
function getButtonReplyId(message) {
  try {
    const r = message?.interactiveResponseMessage;
    if (!r) return null;
    const params = r?.nativeFlowResponseMessage?.paramsJson;
    if (params) return JSON.parse(params).id || null;
    return r?.singleSelectReply?.selectedRowId || null;
  } catch {
    return null;
  }
}

/**
 * Extract the selected row id from a legacy list reply.
 * (Also checks the interactive location some mobile clients use.)
 */
function getListReplyId(message) {
  try {
    return (
      message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
      message?.interactiveResponseMessage?.singleSelectReply?.selectedRowId ||
      null
    );
  } catch {
    return null;
  }
}

module.exports = {
  // senders — one ready function per type
  sendInteractive, // generic: raw [{ name, buttonParamsJson }] for mixing types
  sendButtons, // quick_reply (up to 3)
  sendUrlButtons, // cta_url
  sendCopyButtons, // cta_copy
  sendCallButtons, // cta_call
  sendList, // classic ListMessage dropdown (iOS-compatible)
  sendInteractiveList, // native_flow single_select dropdown (Android only)
  sendPoll, // native poll
  sendRequestPhoneNumber, // ask the recipient to share their number
  sendLocation, // send a map pin
  sendFooterOnly, // footer text, no buttons (ai: false skips the AI badge)
  // reply parsing
  getButtonReplyId,
  getListReplyId,
  // button builders (for sendInteractive)
  quickReply,
  ctaUrl,
  ctaCopy,
  ctaCall,
  singleSelectButton,
};
