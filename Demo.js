const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
// const iconv = require('iconv-lite');

// 创建日志目录
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// 日志记录函数
function writeLog(message) {
    const now = new Date();
    // 格式化日期为 YYYY-MM-DD
    const date = now.toISOString().split('T')[0];

    // 格式化时间为 YYYY-MM-DD HH:mm:ss
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

    // 如果文件不存在，创建文件并写入 UTF-8 BOM
    if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '\ufeff', { encoding: 'utf8' });
    }
    // 将日志信息写入文件
    const logMessage = `[${timeStr}] ${message}\r\n`;
    fs.appendFileSync(logFile, logMessage, { encoding: 'utf8' });

    // // 确保消息是字符串类型
    // const strMessage = String(message);

    // // 将日志信息转换为 GBK 编码
    // const logMessage = `[${timeStr}] ${strMessage}\r\n`;
    // const buffer = iconv.encode(logMessage, 'gbk');

    // // 以二进制方式写入文件
    // fs.appendFileSync(logFile, buffer);

    // // 创建带有 BOM 的 UTF-8 文件头（仅在文件不存在时添加）
    // if (!fs.existsSync(logFile)) {
    //     fs.writeFileSync(logFile, '\ufeff', { encoding: 'utf8' });
    // }

    // 将日志信息转换为 Buffer 并写入文件
    // const logMessage = `[${timeStr}] ${strMessage}\n`;
    // fs.appendFileSync(logFile, logMessage, { encoding: 'utf8' });


    // const logMessage = `[${timeStr}] ${message}\n`;
    // const buffer = iconv.encode(logMessage, 'utf8');
    // fs.appendFileSync(logFile, buffer);
}

const server = dgram.createSocket('udp4');

// 设置控制台编码
process.stdout.setEncoding('utf8');
process.stderr.setEncoding('utf8');

// 监听端口号
const PORT = 8888;
process.env.LANG = 'zh_CN.UTF-8';

// 当UDP服务器启动并监听时触发
server.on('listening', () => {
    const address = server.address();
    Buffer.from(JSON.stringify(address)).toString('utf8');
    const message = `UDP Service Listening ${address.address}:${address.port}`;
    console.log(message);
    writeLog(message);
});

// 当接收到消息时触发
server.on('message', (msg, rinfo) => {
    const receiveMessage = `Receive Message from ${rinfo.address}:${rinfo.port}`;
    console.log(receiveMessage);
    writeLog(receiveMessage);

    try {
        // 将接收到的数据转换为 UTF-8 字符串
        const data = Buffer.from(msg).toString('utf8');

        if (data.startsWith('TYPE1')) {
            handleType1Data(data);
        } else if (data.startsWith('TYPE2')) {
            handleType2Data(data);
        } else {
            const unknownMessage = `Receive Data数据: ${data}`;
            console.log(unknownMessage);
            writeLog(unknownMessage);
        }
    } catch (error) {
        const errorMessage = `处理数据时发生错误: ${error.message}`;
        console.error(errorMessage);
        writeLog(`[ERROR] ${errorMessage}`);
    }
});

// 错误处理
server.on('error', (err) => {
    let errorMessage = '';
    if (err.message && err.message.includes('iconv')) {
        errorMessage = 'UDP服务器错误: 请先安装iconv-lite模块 (npm install iconv-lite)';
    } else {
        errorMessage = `UDP服务器错误: ${err.message}`;
    }
    console.error(errorMessage);
    writeLog(`[ERROR] ${errorMessage}`);
    server.close();
});

// 数据处理函数
function handleType1Data(data) {
    const message = `处理类型1数据: ${data}`;
    console.log(message);
    writeLog(message);
}

function handleType2Data(data) {
    const message = `处理类型2数据: ${data}`;
    console.log(message);
    writeLog(message);
}

// 绑定端口并开始监听
server.bind(PORT);
