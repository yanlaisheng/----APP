function getBeijingTimeStr() {
    const now = new Date();
    now.setHours(now.getHours() + 8);
    return now.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}

function logWithTime(...args) {
    console.log(`[${getBeijingTimeStr()}]`, ...args);
}

module.exports = { logWithTime };