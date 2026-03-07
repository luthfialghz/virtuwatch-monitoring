const ping = require('ping');
const axios = require('axios');
require('dotenv').config();

// --- CONFIGURATION FROM ENV ---
const TARGET_IP_STRING = process.env.TARGET_IP || '';
const TARGET_HOSTS = TARGET_IP_STRING.split(',').map(s => s.trim()).filter(s => s !== '');
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const PING_INTERVAL = parseInt(process.env.PING_INTERVAL) || 30000;
const LATENCY_THRESHOLD = parseInt(process.env.LATENCY_THRESHOLD) || 150;
const FAILURE_THRESHOLD = parseInt(process.env.FAILURE_THRESHOLD) || 3; // Alert only after X failures
const DELAY_BETWEEN_HOSTS = parseInt(process.env.DELAY_BETWEEN_HOSTS) || 1000; // Delay in ms to avoid "bruteforce" detection
// -----------------------------

const lastStatuses = {}; // Track previous status per host
const failureCounts = {}; // Track consecutive failures per host

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendDiscordAlert(host, title, message, color = 16711680) {
    if (!DISCORD_WEBHOOK_URL) {
        console.warn('Discord Webhook URL not configured in .env file. Alert skipped.');
        return;
    }

    try {
        console.log(`[${new Date().toLocaleTimeString()}] Sending Discord alert for ${host}: ${title}...`);
        await axios.post(DISCORD_WEBHOOK_URL, {
            embeds: [
                {
                    title: `🚨 ${title}`,
                    description: `**Target: ${host}**\n${message}`,
                    color: color,
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: 'IP Monitoring System'
                    }
                }
            ]
        });
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Discord notification sent successfully for ${host}.`);
    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] ❌ Failed to send Discord alert for ${host}:`, error.response?.data || error.message);
    }
}

async function monitorHost(host) {
    if (!lastStatuses[host]) lastStatuses[host] = 'ONLINE';
    if (failureCounts[host] === undefined) failureCounts[host] = 0;

    try {
        const res = await ping.promise.probe(host, {
            timeout: 10,
        });

        if (!res.alive) {
            failureCounts[host]++;
            console.log(`[${new Date().toLocaleTimeString()}] [${host}] STATUS: RTO (Failure ${failureCounts[host]}/${FAILURE_THRESHOLD})`);
            
            if (failureCounts[host] >= FAILURE_THRESHOLD) {
                if (lastStatuses[host] !== 'RTO') {
                    await sendDiscordAlert(host, 'Host Down (RTO)', `Host is currently unreachable (Request Time Out). Reported after ${failureCounts[host]} consecutive failures.`);
                    lastStatuses[host] = 'RTO';
                }
            }
        } else {
            const latency = parseFloat(res.time);
            const wasDown = lastStatuses[host] !== 'ONLINE';
            
            // Ensure all results are logged every cycle
            console.log(`[${new Date().toLocaleTimeString()}] [${host}] STATUS: ONLINE | Latency: ${latency}ms`);

            if (latency > LATENCY_THRESHOLD) {
                if (lastStatuses[host] !== 'HIGH_PING') {
                    await sendDiscordAlert(host, 'High Latency Alert', `High ping detected: **${latency}ms** (Threshold: ${LATENCY_THRESHOLD}ms)`, 16776960);
                    lastStatuses[host] = 'HIGH_PING';
                }
            } else {
                if (wasDown) {
                    await sendDiscordAlert(host, 'Connection Restored', `Connection to ${host} is back to normal. Current Ping: **${latency}ms**`, 65280);
                    lastStatuses[host] = 'ONLINE';
                }
            }
            failureCounts[host] = 0; // Reset failure count on successful ping
        }
    } catch (error) {
        console.error(`Error during monitoring for ${host}:`, error);
    }
}

async function monitorAll() {
    console.log(`[${new Date().toLocaleTimeString()}] Starting monitoring cycle for ${TARGET_HOSTS.length} targets...`);
    for (const host of TARGET_HOSTS) {
        await monitorHost(host);
        if (TARGET_HOSTS.length > 1) await sleep(DELAY_BETWEEN_HOSTS);
    }
}

// Initial Run
monitorAll();

// Schedule Monitoring
setInterval(monitorAll, PING_INTERVAL);
