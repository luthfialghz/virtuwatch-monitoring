const ping = require('ping');
const axios = require('axios');
require('dotenv').config();

// --- CONFIGURATION FROM ENV ---
const TARGET_IP_STRING = process.env.TARGET_IP || '';
const TARGET_HOSTS = TARGET_IP_STRING.split(',').map(s => s.trim()).filter(s => s !== '');
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const PING_INTERVAL = parseInt(process.env.PING_INTERVAL) || 30000;
const FAILURE_THRESHOLD = parseInt(process.env.FAILURE_THRESHOLD) || 3; // Alert only after X failures
const DELAY_BETWEEN_HOSTS = parseInt(process.env.DELAY_BETWEEN_HOSTS) || 1000;
const ALERT_REMINDER_INTERVAL = parseInt(process.env.ALERT_REMINDER_INTERVAL) || 600000; // Default 10 minutes

// Parse LATENCY_THRESHOLD: bisa single value (berlaku semua host) atau comma-separated per host (sesuai urutan TARGET_IP)
const DEFAULT_LATENCY_THRESHOLD = 150;
const LATENCY_THRESHOLD_STRING = process.env.LATENCY_THRESHOLD || '';
const LATENCY_THRESHOLD_VALUES = LATENCY_THRESHOLD_STRING.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
const LATENCY_THRESHOLDS = {}; // Map: host -> threshold
TARGET_HOSTS.forEach((host, index) => {
    if (LATENCY_THRESHOLD_VALUES.length === 1) {
        LATENCY_THRESHOLDS[host] = LATENCY_THRESHOLD_VALUES[0];
    } else if (LATENCY_THRESHOLD_VALUES.length > index) {
        LATENCY_THRESHOLDS[host] = LATENCY_THRESHOLD_VALUES[index];
    } else {
        LATENCY_THRESHOLDS[host] = DEFAULT_LATENCY_THRESHOLD;
    }
});
// -----------------------------

const lastStatuses = {}; // Track previous status per host
const failureCounts = {}; // Track consecutive failures per host
const lastAlertTimes = {}; // Track last notification time per host

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
                const now = Date.now();
                const shouldRemind = (now - (lastAlertTimes[host] || 0)) >= ALERT_REMINDER_INTERVAL;

                if (lastStatuses[host] !== 'RTO' || shouldRemind) {
                    const alertType = lastStatuses[host] !== 'RTO' ? 'Host Down (RTO)' : 'Host Still Down (Reminder)';
                    await sendDiscordAlert(host, alertType, `Host is currently unreachable (Request Time Out). Reported after ${failureCounts[host]} consecutive failures.`);
                    lastStatuses[host] = 'RTO';
                    lastAlertTimes[host] = now;
                }
            }
        } else {
            const latency = parseFloat(res.time);
            const wasDown = lastStatuses[host] !== 'ONLINE';
            
            // Ensure all results are logged every cycle
            console.log(`[${new Date().toLocaleTimeString()}] [${host}] STATUS: ONLINE | Latency: ${latency}ms`);

            const latencyThreshold = LATENCY_THRESHOLDS[host];
            if (latency > latencyThreshold) {
                const now = Date.now();
                const shouldRemind = (now - (lastAlertTimes[host] || 0)) >= ALERT_REMINDER_INTERVAL;

                if (lastStatuses[host] !== 'HIGH_PING' || shouldRemind) {
                    const alertType = lastStatuses[host] !== 'HIGH_PING' ? 'High Latency Alert' : 'High Latency Still Detected (Reminder)';
                    await sendDiscordAlert(host, alertType, `High ping detected: **${latency}ms** (Threshold: ${latencyThreshold}ms)`, 16776960);
                    lastStatuses[host] = 'HIGH_PING';
                    lastAlertTimes[host] = now;
                }
            } else {
                if (wasDown) {
                    await sendDiscordAlert(host, 'Connection Restored', `Connection to ${host} is back to normal. Current Ping: **${latency}ms**`, 65280);
                    lastStatuses[host] = 'ONLINE';
                    lastAlertTimes[host] = 0; // Reset alert time on recovery
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
