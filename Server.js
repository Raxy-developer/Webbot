const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    Browsers,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const axios = require('axios'); // <-- BARU: Untuk downloader

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =================================================================
// KONFIGURASI BOT (PENTING!)
// =================================================================

// Taruh API Key Anda di sini. Dapatkan dari https://api.lolhuman.xyz
// (Banyak bot Indonesia pakai ini, registrasi gratis untuk dapat key)
const LOLHUMAN_API_KEY = "MASUKKAN_API_KEY_ANDA_DISINI"; 

// =================================================================

// Fungsi utama untuk memulai koneksi bot
async function startBot(phoneNumber) {
    const sessionPath = `sessions/${phoneNumber}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        auth: state,
    });

    if (!sock.authState.creds.registered) {
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const code = await sock.requestPairingCode(phoneNumber);
            const formattedCode = code.match(/.{1,3}/g).join('-');
            console.log(`[BOT ${phoneNumber}] Pairing Code: ${formattedCode}`);
            return { success: true, code: formattedCode };
        } catch (error) {
            console.error(`[BOT ${phoneNumber}] Gagal meminta pairing code:`, error);
            return { success: false, message: 'Gagal meminta pairing code.' };
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log(`[BOT ${phoneNumber}] Terhubung! Bot siap digunakan.`);
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log(`[BOT ${phoneNumber}] Koneksi ditutup. Alasan: ${lastDisconnect?.error?.output?.statusCode}. Konek ulang: ${shouldReconnect}`);
            if (shouldReconnect) {
                // Logika konek ulang bisa ditambahkan di sini
            }
        }
    });

    // =================================================================
    // LISTENER FITUR BOT (ANTI-LINK & DOWNLOADER)
    // =================================================================
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || m.type !== 'notify') return;

        const senderId = msg.key.remoteJid;
        const isGroup = senderId.endsWith('@g.us');
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        // 1. FITUR ANTI-LINK (Hanya di Grup)
        if (isGroup) {
            // Cek apakah pesan mengandung link grup WhatsApp
            if (body.includes('chat.whatsapp.com/')) {
                console.log(`[Anti-Link] Terdeteksi link grup di ${senderId}`);
                
                try {
                    // Ambil metadata grup
                    const groupMeta = await sock.groupMetadata(senderId);
                    // Cari admin grup
                    const admins = groupMeta.participants.filter(p => p.admin).map(p => p.id);
                    // Cek apakah pengirim BUKAN admin
                    const isSenderAdmin = admins.includes(msg.key.participant);

                    if (!isSenderAdmin) {
                        console.log(`[Anti-Link] Pengirim (${msg.key.participant}) bukan admin. Menghapus pesan...`);
                        
                        // Kirim peringatan
                        await sock.sendMessage(senderId, { 
                            text: `🚨 *ANTI-LINK DETECTED* 🚨\n\n@${msg.key.participant.split('@')[0]}, dilarang mengirim link grup lain di sini!`,
                            mentions: [msg.key.participant]
                        });

                        // Hapus pesan
                        await sock.sendMessage(senderId, { delete: msg.key });
                    }
                } catch (err) {
                    console.error("[Anti-Link] Gagal memproses:", err);
                }
            }
        }

        // 2. FITUR DOWNLOADER (Contoh: TikTok)
        // Perintah: .tiktok [url]
        if (body.startsWith('.tiktok')) {
            if (LOLHUMAN_API_KEY === "MASUKKAN_API_KEY_ANDA_DISINI") {
                await sock.sendMessage(senderId, { text: 'Fitur downloader belum aktif. Harap atur API Key di file server.js' }, { quoted: msg });
                return;
            }

            const url = body.split(' ')[1];
            if (!url) {
                await sock.sendMessage(senderId, { text: 'Format salah. Contoh: .tiktok https://vt.tiktok.com/xxxx' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(senderId, { text: 'Sedang memproses... mohon tunggu.' }, { quoted: msg });

            try {
                // Panggil API eksternal (Contoh: LolHuman)
                const apiUrl = `https://api.lolhuman.xyz/api/tiktokslide?apikey=${LOLHUMAN_API_KEY}&url=${url}`;
                const response = await axios.get(apiUrl);

                if (response.data.status === 200) {
                    const result = response.data.result;
                    
                    // Kirim video
                    await sock.sendMessage(senderId, {
                        video: { url: result.link },
                        caption: `*TikTok Downloader Sukses!*\n\nDeskripsi: ${result.title}`
                    }, { quoted: msg });
                
                } else {
                    await sock.sendMessage(senderId, { text: 'Gagal mendownload video. Pastikan link valid.' }, { quoted: msg });
                }

            } catch (err) {
                console.error("[Downloader] Gagal memproses:", err.message);
                await sock.sendMessage(senderId, { text: 'Terjadi kesalahan saat menghubungi server downloader.' }, { quoted: msg });
            }
        }
        
        // Contoh: Fitur Downloader IG & FB (mirip, hanya beda endpoint API)
        if (body.startsWith('.ig')) {
            // Logika mirip, tapi panggil endpoint API IG
            await sock.sendMessage(senderId, { text: 'Fitur IG Downloader sedang dikembangkan.' }, { quoted: msg });
        }
        if (body.startsWith('.fb')) {
            // Logika mirip, tapi panggil endpoint API FB
            await sock.sendMessage(senderId, { text: 'Fitur FB Downloader sedang dikembangkan.' }, { quoted: msg });
        }
    });

    return { success: true, message: 'Bot sudah terhubung sebelumnya.' };
}

// =================================================================
// API ENDPOINT (Sama seperti sebelumnya)
// =================================================================
app.post('/get-pairing-code', async (req, res) => {
    const { number } = req.body;
    if (!number) {
        return res.status(400).json({ success: false, message: 'Nomor telepon diperlukan.' });
    }
    const formattedNumber = number.replace(/\D/g, '');
    if (!formattedNumber.startsWith('62')) {
         return res.status(400).json({ success: false, message: 'Gunakan kode negara 62 (Indonesia).' });
    }
    try {
        const result = await startBot(formattedNumber);
        res.status(200).json(result);
    } catch (error) {
        console.error('Error di endpoint /get-pairing-code:', error);
        res.status(500).json({ success: false, message: 'Kesalahan internal server.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
    console.log('Buka browser Anda untuk menghubungkan bot.');
});
