const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const ddp = require('./ddp');

// ������־Ŀ¼
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// ��־��¼����
function writeLog(message) {
    const now = new Date();
    // ��ʽ������Ϊ YYYY-MM-DD
    const date = now.toISOString().split('T')[0];

    // ��ʽ��ʱ��Ϊ YYYY-MM-DD HH:mm:ss
    const timeStr = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(/\//g, '-');

    const logFile = path.join(logDir, `${date}.log`);

    // ����ļ������ڣ������ļ���д�� UTF-8 BOM
    if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '\ufeff', { encoding: 'utf8' });
    }
    // ����־��Ϣд���ļ�
    const logMessage = `[${timeStr}] ${message}\r\n`;
    fs.appendFileSync(logFile, logMessage, { encoding: 'utf8' });


}

const server = dgram.createSocket('udp4');

// ���ÿ���̨����
process.stdout.setEncoding('utf8');
process.stderr.setEncoding('utf8');

// �����˿ں�
const PORT = 8888;
process.env.LANG = 'zh_CN.UTF-8';

// ��UDP����������������ʱ����
server.on('listening', () => {
    const address = server.address();
    Buffer.from(JSON.stringify(address)).toString('utf8');
    const message = `UDP Service Listening ${address.address}:${address.port}`;
    console.log(message);
    writeLog(message);
});

// �����յ���Ϣʱ����
server.on('message', (msg, rinfo) => {
    const receiveMessage = `Receive Message from ${rinfo.address}:${rinfo.port}`;
    console.log(receiveMessage);
    writeLog(receiveMessage);

    try {
        const result = ddp.parsePacket(msg);
        
        switch (result.type) {
            case 'register':
                // Handle registration
                const registerMsg = `Device Registration: DTU=${result.dtuNumber}, IP=${result.ipAddress}, Port=${result.port}`;
                console.log(registerMsg);
                writeLog(registerMsg);
                
                // Send registration success response
                server.send(result.response, rinfo.port, rinfo.address);
                break;

            case 'unregister':
                // Handle unregistration
                const unregisterMsg = `Device Unregistration: DTU=${result.dtuNumber}`;
                console.log(unregisterMsg);
                writeLog(unregisterMsg);
                
                // Send unregistration success response
                server.send(result.response, rinfo.port, rinfo.address);
                break;

            case 'data':
                // Handle data
                const dataMsg = `Received Data: DTU=${result.dtuNumber}, Data=${result.data.toString('hex')}`;
                console.log(dataMsg);
                writeLog(dataMsg);
                break;

            default:
                const unknownMsg = `Unknown Data Type: ${result.type}`;
                console.log(unknownMsg);
                writeLog(unknownMsg);
        }
    } catch (error) {
        const errorMessage = `��������ʱ��������: ${error.message}`;
        console.error(errorMessage);
        writeLog(`[ERROR] ${errorMessage}`);
    }
});

// ������
server.on('error', (err) => {
    let errorMessage = '';
    if (err.message && err.message.includes('iconv')) {
        errorMessage = 'UDP Server Error: Please install iconv-lite module (npm install iconv-lite)';
    } else {
        errorMessage = `UDP Server Error: ${err.message}`;
    }
    console.error(errorMessage);
    writeLog(`[ERROR] ${errorMessage}`);
    server.close();
});

// ���ݴ�����
function handleType1Data(data) {
    const message = `Process Type1 Data: ${data}`;
    console.log(message);
    writeLog(message);
}

function handleType2Data(data) {
    const message = `Process Type2 Data: ${data}`;
    console.log(message);
    writeLog(message);
}

// �󶨶˿ڲ���ʼ����
server.bind(PORT);
