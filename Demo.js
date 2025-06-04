const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
// const iconv = require('iconv-lite');

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

    // // ȷ����Ϣ���ַ�������
    // const strMessage = String(message);

    // // ����־��Ϣת��Ϊ GBK ����
    // const logMessage = `[${timeStr}] ${strMessage}\r\n`;
    // const buffer = iconv.encode(logMessage, 'gbk');

    // // �Զ����Ʒ�ʽд���ļ�
    // fs.appendFileSync(logFile, buffer);

    // // �������� BOM �� UTF-8 �ļ�ͷ�������ļ�������ʱ��ӣ�
    // if (!fs.existsSync(logFile)) {
    //     fs.writeFileSync(logFile, '\ufeff', { encoding: 'utf8' });
    // }

    // ����־��Ϣת��Ϊ Buffer ��д���ļ�
    // const logMessage = `[${timeStr}] ${strMessage}\n`;
    // fs.appendFileSync(logFile, logMessage, { encoding: 'utf8' });


    // const logMessage = `[${timeStr}] ${message}\n`;
    // const buffer = iconv.encode(logMessage, 'utf8');
    // fs.appendFileSync(logFile, buffer);
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
        // �����յ�������ת��Ϊ UTF-8 �ַ���
        const data = Buffer.from(msg).toString('utf8');

        if (data.startsWith('TYPE1')) {
            handleType1Data(data);
        } else if (data.startsWith('TYPE2')) {
            handleType2Data(data);
        } else {
            const unknownMessage = `Receive Data����: ${data}`;
            console.log(unknownMessage);
            writeLog(unknownMessage);
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
        errorMessage = 'UDP����������: ���Ȱ�װiconv-liteģ�� (npm install iconv-lite)';
    } else {
        errorMessage = `UDP����������: ${err.message}`;
    }
    console.error(errorMessage);
    writeLog(`[ERROR] ${errorMessage}`);
    server.close();
});

// ���ݴ�����
function handleType1Data(data) {
    const message = `��������1����: ${data}`;
    console.log(message);
    writeLog(message);
}

function handleType2Data(data) {
    const message = `��������2����: ${data}`;
    console.log(message);
    writeLog(message);
}

// �󶨶˿ڲ���ʼ����
server.bind(PORT);
