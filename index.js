const ping = require('ping');
const axios = require('axios');
require('dotenv').config();

// --- CONFIGURATION FROM ENV ---
const TARGET_IP = process.env.TARGET_IP;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const PING_INTERVAL = parseInt(process.env.PING_INTERVAL);
const LATENCY_THRESHOLD = parseInt(process.env.LATENCY_THRESHOLD);
// -----------------------------

let lastStatus = 'ONLINE'; // Track previous status to avoid spamming

async function sendDiscordAlert(title, message, color = 16711680) { // Default color Red
    if (!DISCORD_WEBHOOK_URL) {
        console.warn('Discord Webhook URL not configured in .env file. Alert skipped.');
        return;
    }

    try {
        await axios.post(DISCORD_WEBHOOK_URL, {
            embeds: [
                {
                    title: `🚨 ${title}`,
                    description: message,
                    color: color,
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: 'IP Monitoring System'
                    }
                }
            ]
        });
        console.log('Discord notification sent.');
    } catch (error) {
        console.error('Failed to send Discord alert:', error.message);
    }
}

async function monitorIP() {
    console.log(`[${new Date().toLocaleTimeString()}] Monitoring IP: ${TARGET_IP}...`);

    try {
        const res = await ping.promise.probe(TARGET_IP, {
            timeout: 10,
        });

        if (!res.alive) {
            if (lastStatus !== 'RTO') {
                await sendDiscordAlert('IP Address Down (RTO)', `Target: ${TARGET_IP} is currently unreachable (Request Time Out).`);
                lastStatus = 'RTO';
            }
            console.log(`[${new Date().toLocaleTimeString()}] STATUS: RTO`);
        } else {
            const latency = parseFloat(res.time);
            console.log(`[${new Date().toLocaleTimeString()}] STATUS: ONLINE | Latency: ${latency}ms`);

            if (latency > LATENCY_THRESHOLD) {
                if (lastStatus !== 'HIGH_PING') {
                    await sendDiscordAlert('High Latency Alert', `High ping detected on ${TARGET_IP}: **${latency}ms** (Threshold: ${LATENCY_THRESHOLD}ms)`, 16776960); // Yellow
                    lastStatus = 'HIGH_PING';
                }
            } else {
                if (lastStatus !== 'ONLINE') {
                    await sendDiscordAlert('Connection Restored', `Connection to ${TARGET_IP} is back to normal. Current Ping: **${latency}ms**`, 65280); // Green
                    lastStatus = 'ONLINE';
                }
            }
        }
    } catch (error) {
        console.error('Error during ping monitoring:', error);
    }
}

// Initial Run
monitorIP();

// Schedule Monitoring
setInterval(monitorIP, PING_INTERVAL);
