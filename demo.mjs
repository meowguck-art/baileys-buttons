'use strict';
/**
 * demo.mjs — standalone verification script for the baileys-buttons helper.
 *
 * Setup (on your own machine):
 *   1. Put this file and baileys-buttons.mjs in the same folder
 *      (both are at https://github.com/meowguck-art/baileys-buttons)
 *   2. npm install @whiskeysockets/baileys qrcode-terminal
 *   3. node demo.mjs [target-jid]
 *      - no arg: sends the demo to your own self-chat
 *        ("Message yourself" — note: quick_reply buttons appear
 *        grayed-out there because YOU are the sender; everything else works)
 *      - with arg: e.g. node demo.mjs 972501234567@s.whatsapp.net
 *        sends to that chat — best tested from a second phone so you can tap
 *   4. Scan the QR code with WhatsApp on first run (login persists in ./auth)
 *
 * After the demo messages arrive, tap the buttons — every tap is logged
 * here and answered with a confirmation message.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import {
  sendButtons,
  sendUrlButtons,
  sendCopyButtons,
  sendCallButtons,
  sendList,
  sendPoll,
  getButtonReplyId,
  getListReplyId,
} from './baileys-buttons.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runDemo(sock, targetJid) {
  console.log(`\n▶ Sending demo sequence to ${targetJid} ...\n`);

  // 1. quick_reply
  await sendButtons(sock, targetJid, {
    text: '1️⃣ כפתורי תשובה (quick_reply)',
    footer: 'לחצו על אחד הכפתורים',
    buttons: [
      { id: 'demo_yes', displayText: 'כן ✅' },
      { id: 'demo_no', displayText: 'לא ❌' },
    ],
  });
  console.log('✔ quick_reply sent');
  await sleep(2500);

  // 2. cta_url
  await sendUrlButtons(sock, targetJid, {
    text: '2️⃣ כפתור קישור (cta_url)',
    buttons: [{ displayText: 'פתח אתר 🌐', url: 'https://example.com' }],
  });
  console.log('✔ cta_url sent');
  await sleep(2500);

  // 3. cta_copy
  await sendCopyButtons(sock, targetJid, {
    text: '3️⃣ כפתור העתקה (cta_copy)',
    buttons: [{ displayText: 'העתק קוד 📋', copyCode: 'DEMO-1234' }],
  });
  console.log('✔ cta_copy sent');
  await sleep(2500);

  // 4. cta_call
  await sendCallButtons(sock, targetJid, {
    text: '4️⃣ כפתור חיוג (cta_call)',
    buttons: [{ displayText: 'חייג 📞', phoneNumber: '+972501234567' }],
  });
  console.log('✔ cta_call sent');
  await sleep(2500);

  // 5. single_select list
  await sendList(sock, targetJid, {
    text: '5️⃣ תפריט נפתח (single_select)',
    buttonText: 'פתח תפריט 📋',
    sections: [
      {
        title: 'פירות',
        rows: [
          { id: 'demo_apple', title: 'תפוח 🍎', description: 'ירוק ופריך' },
          { id: 'demo_banana', title: 'בננה 🍌' },
        ],
      },
      {
        title: 'שתייה',
        rows: [{ id: 'demo_coffee', title: 'קפה ☕', description: 'חם וחזק' }],
      },
    ],
  });
  console.log('✔ list sent');
  await sleep(2500);

  // 6. poll
  await sendPoll(sock, targetJid, {
    name: '6️⃣ סקר — מה מועדף? 🕐',
    options: ['בוקר 🌅', 'צהריים ☀️', 'ערב 🌙'],
  });
  console.log('✔ poll sent');

  console.log('\n✅ Demo complete — tap the buttons, replies will be logged below.\n');
}

async function main() {
  const targetArg = process.argv[2]; // optional target JID

  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const sock = makeWASocket({
    auth: state,
    // quiet logs; QR is handled manually below
    logLevel: 'warn',
  });
  sock.ev.on('creds.update', saveCreds);

  let demoSent = false;

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('Scan this QR with WhatsApp:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('✅ Connected as', sock.user.id);
      if (!demoSent) {
        demoSent = true;
        // sock.user.id includes a device suffix (e.g. 972...:8@s.whatsapp.net)
        // which WhatsApp rejects for sending — normalize to a bare chat JID.
        const normalizeJid = (j) => {
          j = String(j).split(':')[0]; // strip device suffix
          return j.includes('@') ? j : `${j}@s.whatsapp.net`;
        };
        const target = targetArg ? normalizeJid(targetArg) : normalizeJid(sock.user.id);
        console.log('Target JID:', target);
        await sleep(1000);
        try {
          await runDemo(sock, target);
        } catch (err) {
          console.error('Demo failed:', err.message);
        }
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('Connection closed:', code);
      if (code !== DisconnectReason.loggedOut) {
        console.log('Reconnecting in 3s… (Ctrl+C to stop)');
        await sleep(3000);
        main();
      } else {
        console.log('Logged out — delete ./auth and run again.');
      }
    }
  });

  // Log + confirm every button tap / list pick
  const seen = new Set();
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      if (!m?.message || seen.has(m.key.id)) continue;
      seen.add(m.key.id);
      const id = getButtonReplyId(m.message) || getListReplyId(m.message);
      if (id) {
        console.log(`👆 Button pressed: ${id}`);
        await sock.sendMessage(m.key.remoteJid, {
          text: `✅ קיבלתי לחיצה על: ${id}`,
        });
      }
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
