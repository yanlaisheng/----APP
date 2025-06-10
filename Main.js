const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const ddp = require('./ddp');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { address } = require('ref-napi');
const { logWithTime } = require('./logger');
const https = require('https');

const server = dgram.createSocket('udp4');


// 监听端口
const PORT = 8888;
// process.env.LANG = 'zh_CN.UTF-8';

// 创建数据库连接
const dbPath = path.join(__dirname, 'monitor.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        return;
    }
    logWithTime('Connected to monitor.db database');
});

// 数据库操作函数   
const dbOperations = {
    // 插入数据
    insertData: (dtuNo, data) => {
        return new Promise((resolve, reject) => {
            if (!dtuNo || !data) {
                reject(new Error('DTU number and data are required'));
                return;
            }
            // 使用当前时间
            const rcvTime = getBeijingTime();
            const sql = `INSERT INTO RcvData (DtuNo, RcvTime, Rcvdata) VALUES (?, ?, ?)`;
            db.run(sql, [dtuNo, rcvTime, data], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(this.lastID);
            });
        });
    },

    // 查询数据
    queryData: (conditions = {}) => {
        return new Promise((resolve, reject) => {
            let sql = 'SELECT * FROM RcvData';
            const params = [];

            // 构建查询条件
            if (Object.keys(conditions).length > 0) {
                const whereClauses = [];
                if (conditions.dtuNo) {
                    whereClauses.push('DtuNo = ?');
                    params.push(conditions.dtuNo);
                }
                if (conditions.startTime) {
                    whereClauses.push('RcvTime >= ?');
                    params.push(conditions.startTime);
                }
                if (conditions.endTime) {
                    whereClauses.push('RcvTime <= ?');
                    params.push(conditions.endTime);
                }
                if (whereClauses.length > 0) {
                    sql += ' WHERE ' + whereClauses.join(' AND ');
                }
            }
            
            sql += ' ORDER BY RcvTime DESC';

            db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                // 转换查询结果中的时间格式
                const formattedRows = rows.map(row => {
                    const date = new Date(row.RcvTime);
                    date.setHours(date.getHours() + 8);
                    return {
                        ...row,
                        RcvTime: date.toISOString().replace('Z', '+08:00')
                    };
                });
                resolve(formattedRows);
            });
        });
    },

    // 删除数据
    deleteData: (conditions) => {
        return new Promise((resolve, reject) => {
            let sql = 'DELETE FROM RcvData';
            const params = [];

            if (conditions.id) {
                sql += ' WHERE id = ?';
                params.push(conditions.id);
            } else if (conditions.dtuNo) {
                sql += ' WHERE DtuNo = ?';
                params.push(conditions.dtuNo);
            }

            db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(this.changes);
            });
        });
    },

    // 更新数据
    updateData: (id, newData) => {
        return new Promise((resolve, reject) => {
            const sql = `UPDATE RcvData SET Rcvdata = ? WHERE id = ?`;
            db.run(sql, [newData, id], function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(this.changes);
            });
        });
    }
};

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

    // 如果日志文件不存在，则创建文件并写入 UTF-8 BOM
    if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '\ufeff', { encoding: 'utf8' });
    }
    // 将日志信息写入文件
    const logMessage = `[${timeStr}] ${message}\r\n`;
    fs.appendFileSync(logFile, logMessage, { encoding: 'utf8' });


}



// UDP服务启动时
server.on('listening', () => {
    const address = server.address();
    Buffer.from(JSON.stringify(address)).toString('utf8');
    const message = `UDP Service Listening ${address.address}:${address.port}`;
    logWithTime(message);
    writeLog(message);
});

// 接收到消息时
server.on('message', async (msg, rinfo) => {
    const receiveMessage = `Receive Message from ${rinfo.address}:${rinfo.port}`;
    logWithTime(receiveMessage);
    writeLog(receiveMessage);

    try {
        const result = ddp.parsePacket(msg, rinfo);
        
        switch (result.type) {
            case 'register':
                // 查询设备名称
                const deviceName = await getDeviceNameByDtuNo(result.dtuNumber);

                // 更新/注册设备信息，并记录最后活跃时间和设备名称
                if (ddp.registeredDevices.has(result.dtuNumber)) {
                    const info = ddp.registeredDevices.get(result.dtuNumber);
                    info.ipAddress = rinfo.address;
                    info.port = rinfo.port;
                    info.lastActiveTime = Date.now();
                    info.deviceName = deviceName;
                    ddp.registeredDevices.set(result.dtuNumber, info);
                } else {
                    ddp.registeredDevices.set(result.dtuNumber, {
                        ipAddress: rinfo.address,
                        port: rinfo.port,
                        registerTime: new Date(),
                        lastActiveTime: Date.now(),
                        deviceName: deviceName
                    });
                }

                // 控制台和日志输出带设备名称
                const regMsg = `Device Registration: DTU=${result.dtuNumber}, Name=${deviceName}, IP=${rinfo.address}`;
                logWithTime(regMsg);
                writeLog(regMsg);

                // Send registration success response
                server.send(result.response, rinfo.port, rinfo.address);
                break;

            case 'unregister':
                // Handle unregistration
                const unregisterMsg = `Device Unregistration: DTU=${result.dtuNumber}`;
                logWithTime(unregisterMsg);
                writeLog(unregisterMsg);
                
                // Send unregistration success response
                server.send(result.response, rinfo.port, rinfo.address);
                break;

            case 'data':
                // 数据包也要更新lastActiveTime
                if (ddp.registeredDevices.has(result.dtuNumber)) {
                    const info = ddp.registeredDevices.get(result.dtuNumber);
                    info.lastActiveTime = Date.now();
                    ddp.registeredDevices.set(result.dtuNumber, info);
                }
                // Handle data and save to database
                const dataMsg = `Received Data: DTU=${result.dtuNumber}, Data=${result.data.toString('hex')}`;
                logWithTime(dataMsg);
                writeLog(dataMsg);

                // 解析700~710地址的值
                let parsed = null;
                try {
                    parsed = parse700to710Registers(result.data);
                } catch (e) {
                    parsed = null;
                }

                try {
                    // 插入数据到数据库
                    const sql = `
                        INSERT INTO RcvData (
                            DtuNo, RcvTime, Rcvdata,
                            addr700, addr701, addr702, addr703, addr704, addr705,
                            addr706, addr707, addr708, addr709, addr710
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    const now = new Date();
                    // 设置为北京时间
                    now.setHours(now.getHours() + 8);
                    const beijingTime = now.toISOString().replace('Z', '+08:00');
                    // 插入数据到数据库
                    const values = [
                        result.dtuNumber,
                        beijingTime, // 北京时间
                        result.data.toString('hex'),
                        parsed ? parsed.addr700 : null,
                        parsed ? parsed.addr701 : null,
                        parsed ? parsed.addr702 : null,
                        parsed ? parsed.addr703 : null,
                        parsed ? parsed.addr704 : null,
                        parsed ? parsed.addr705 : null,
                        parsed ? parsed.addr706 : null,
                        parsed ? parsed.addr707 : null,
                        parsed ? parsed.addr708 : null,
                        parsed ? parsed.addr709 : null,
                        parsed ? parsed.addr710 : null
                    ];
                    db.run(sql, values, function(err) {
                        if (err) {
                            console.error('Failed to save data:', err);
                            writeLog(`[ERROR] Failed to save data: ${err.message}`);
                        } else {
                            logWithTime('Data saved to database successfully');
                        }
                    });
                } catch (dbError) {
                    console.error('Failed to save data:', dbError);
                    writeLog(`[ERROR] Failed to save data: ${dbError.message}`);
                }
                break;

            case 'ack': // 新增应答包处理
                // 更新lastActiveTime
                if (ddp.registeredDevices.has(result.dtuNumber)) {
                    const info = ddp.registeredDevices.get(result.dtuNumber);
                    info.lastActiveTime = Date.now();
                    ddp.registeredDevices.set(result.dtuNumber, info);
                }
                const ackMsg = `收到DTU[${result.dtuNumber}]的应答包`;
                logWithTime(ackMsg);
                writeLog(ackMsg);
                break;

            default:
                const unknownMsg = `Unknown Data Type: ${result.type}`;
                logWithTime(unknownMsg);
                writeLog(unknownMsg);
        }
    } catch (error) {
        const errorMessage = `Error on resolve received data: ${error.message}`;
        console.error(errorMessage);
        writeLog(`[ERROR] ${errorMessage}`);
    }
});

// 处理错误
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


// 绑定端口并开始监听
server.bind(PORT);

// 监听退出信号，关闭数据库连接
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        logWithTime('Database connection closed');
        process.exit(0);
    });
});

// 创建Express应用
const app = express();
const API_PORT = 3000;

app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});
app.use(cors());
app.use(bodyParser.json());

// API路由
// 1. 查询数据
app.get('/api/data', async (req, res) => {
    try {
        const conditions = {
            dtuNo: req.query.dtuNo,
            startTime: req.query.startTime,
            endTime: req.query.endTime
        };
        const data = await dbOperations.queryData(conditions);

        // 查询所有涉及到的DTU号的设备名称
        const dtuNos = [...new Set(data.map(row => row.DtuNo))];
        const deviceNames = {};
        await Promise.all(dtuNos.map(async dtuNo => {
            deviceNames[dtuNo] = await getDeviceNameByDtuNo(dtuNo);
        }));

        // 返回时加上DeviceName
        const dataWithName = data.map(row => ({
            ...row,
            deviceName: deviceNames[row.DtuNo] || ''
        }));

        res.json({
            success: true,
            data: dataWithName
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/data/:id', async (req, res) => {
    try {
        const data = await dbOperations.queryData({ id: req.params.id });
        if (data.length === 0) {
            res.status(404).json({
                success: false,
                error: 'Record not found'
            });
            return;
        }
        // 查询DeviceName
        const deviceName = await getDeviceNameByDtuNo(data[0].DtuNo);
        res.json({
            success: true,
            data: { ...data[0], deviceName }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. 创建数据
app.post('/api/data', async (req, res) => {
    try {
        const { dtuNo, data } = req.body;

        // 验证请求参数
        if (!dtuNo || !data) {
            res.status(400).json({
                success: false,
                error: 'DTU number and data are required'
            });
            return;
        }

        // 记录接收到的请求
        logWithTime('Received POST request:', {
            dtuNo: dtuNo,
            data: data
        });

        const id = await dbOperations.insertData(dtuNo, data);
        res.json({
            success: true,
            id: id,
            message: 'Data inserted successfully'
        });
    } catch (error) {
        console.error('Insert data error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. 更新数据
app.put('/api/data/:id', async (req, res) => {
    try {
        const { data } = req.body;
        const result = await dbOperations.updateData(req.params.id, data);
        if (result === 0) {
            res.status(404).json({
                success: false,
                error: 'Record not found'
            });
            return;
        }
        res.json({
            success: true,
            changes: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. 删除数据
app.delete('/api/data/:id', async (req, res) => {
    try {
        const result = await dbOperations.deleteData({ id: req.params.id });
        if (result === 0) {
            res.status(404).json({
                success: false,
                error: 'Record not found'
            });
            return;
        }
        res.json({
            success: true,
            changes: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 添加继电器控制 API
app.post('/api/control/relay', async (req, res) => {
    try {
        const { dtuNo, command } = req.body;

        // 验证请求参数
        if (!dtuNo || !command) {
            res.status(400).json({
                success: false,
                error: 'DTU number and command are required'
            });
            return;
        }

        // 验证命令
        if (command !== 'ON' && command !== 'OFF') {
            res.status(400).json({
                success: false,
                error: 'Invalid command. Must be ON or OFF'
            });
            return;
        }

        // 获取设备信息（假设已在ddp.js中维护了设备信息）
        const deviceInfo = ddp.registeredDevices.get(dtuNo);
        if (!deviceInfo) {
            res.status(404).json({
                success: false,
                error: 'DTU device not found or not registered'
            });
            return;
        }

        // 构建 MODBUS 命令
        const value = command === 'ON' ? 0x0001 : 0x0000;
        const modbusCommand = buildModbusCommand(0x02, value); // 设备地址设为 0x02

        // 发送命令
        await sendCommandToDTU(dtuNo, modbusCommand, {
            address: deviceInfo.ipAddress,
            port: deviceInfo.port
        });

        // 记录日志
        const logMessage = `Relay control command sent: DTU=${dtuNo}, IP=${deviceInfo.ipAddress}, Port=${deviceInfo.port}, Command=${command}`;
        logWithTime(logMessage);
        writeLog(logMessage);

        res.json({
            success: true,
            message: `Relay ${command} command sent successfully`,
            dtuNo: dtuNo
        });

    } catch (error) {
        const errorMessage = `Failed to send relay control command: ${error.message}`;
        console.error(errorMessage);
        writeLog(`[ERROR] ${errorMessage}`);
        
        res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
});

// 获取当前在线DTU设备列表
app.get('/api/online-dtus', (req, res) => {
    function formatTime(t) {
        if (!t) return '';
        const date = new Date(t);
        const pad = n => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
             + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    const onlineList = Array.from(ddp.registeredDevices.entries()).map(([dtuNo, info]) => ({
        dtuNo,
        deviceName: info.deviceName || '',
        ipAddress: info.ipAddress,
        port: info.port,
        registerTime: info.registerTime ? formatTime(info.registerTime) : '',
        lastActiveTime: info.lastActiveTime ? formatTime(info.lastActiveTime) : ''
    }));
    res.json({
        success: true,
        count: onlineList.length,
        devices: onlineList
    });
});

// 查询指定DTU的状态
app.get('/api/dtu-status/:dtuNo', async (req, res) => {
    try {
        const dtuNo = req.params.dtuNo;
        const deviceName = await getDeviceNameByDtuNo(dtuNo);
        // 查询DTU的最新一条记录
        const sql = `
            SELECT * FROM RcvData
            WHERE DtuNo = ?
            ORDER BY RcvTime DESC
            LIMIT 1
        `;
        db.get(sql, [dtuNo], (err, row) => {
            if (err) {
                res.status(500).json({ success: false, error: err.message });
                return;
            }
            if (!row) {
                res.status(404).json({ success: false, error: 'No data found for this DTU' });
                return;
            }
            const result = {
                dtuNo: row.DtuNo,
                deviceName,
                rcvTime: row.RcvTime,
                voltageAB: row.addr700 != null ? (row.addr700 / 10).toFixed(1) : null,
                voltageBC: row.addr701 != null ? (row.addr701 / 10).toFixed(1) : null,
                voltageCA: row.addr702 != null ? (row.addr702 / 10).toFixed(1) : null,
                currentA: row.addr703 != null ? (row.addr703 / 100).toFixed(2) : null,
                currentB: row.addr704 != null ? (row.addr704 / 100).toFixed(2) : null,
                currentC: row.addr705 != null ? (row.addr705 / 100).toFixed(2) : null,
                energy: (row.addr706 != null && row.addr707 != null)
                    ? (((row.addr707 << 16) | row.addr706) / 100).toFixed(2)
                    : null,
                pressure: row.addr708 != null ? (row.addr708 / 1000).toFixed(3) : null,
                relayStatus: row.addr710 == 1 ? '闭合' : (row.addr710 == 0 ? '断开' : null)
            };
            res.json({ success: true, data: result });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// // 启动Express服务器
// app.listen(API_PORT, () => {
//     logWithTime(`API Server running on port ${API_PORT}`);
// });

const sslKey = fs.readFileSync(path.join(__dirname, 'SSL', '202411111203382639_key.key'));
const sslCert = fs.readFileSync(path.join(__dirname, 'SSL', 'star.sanli.cn_cert.pem'));

const httpsServer = https.createServer({
    key: sslKey,
    cert: sslCert
}, app);

httpsServer.listen(API_PORT, () => {
    logWithTime(`HTTPS API Server running on https://monitor.sanli.cn:${API_PORT}`);
});

// 计算 MODBUS CRC 校验
function calculateModbusCRC(buffer) {
    let crc = 0xFFFF;
    for (let pos = 0; pos < buffer.length; pos++) {
        crc ^= buffer[pos];
        for (let i = 8; i !== 0; i--) {
            if ((crc & 0x0001) !== 0) {
                crc >>= 1;
                crc ^= 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    // 返回两个字节的 CRC
    return Buffer.from([crc & 0xFF, (crc >> 8) & 0xFF]);
}

// 构建 MODBUS 命令
function buildModbusCommand(deviceAddress, value) {
    // 构建命令（不含 CRC）
    const command = Buffer.from([
        deviceAddress,  // 设备地址
        0x06,          // 功能码
        0x02, 0xC5,    // 寄存器地址
        (value >> 8) & 0xFF, value & 0xFF  // 寄存器值（高字节在前）
    ]);

    // 计算 CRC
    const crc = calculateModbusCRC(command);

    // 拼接命令和 CRC
    return Buffer.concat([command, crc]);
}

// 构建DDP协议数据包
function buildDDPServerDataPacket(dtuNo, modbusCommand) {
    // DDP协议头部16字节
    const buffer = Buffer.alloc(16);
    buffer[0] = 0x7B; // 起始字节
    buffer[1] = 0x89; // 设备类型（DTU设备）
    buffer[2] = 0x00; // 设备序号
    buffer[3] = 0x10; // 数据长度（16字节）
    // 写入DTU编号，ASCII码11字节，填充0x00
    Buffer.from(dtuNo.padEnd(11, '\0')).copy(buffer, 4, 0, 11);
    buffer[15] = 0x7B; // 结束字节

    // 拼接实际数据，MODBUS命令
    return Buffer.concat([buffer, modbusCommand]);
}

// 将 MODBUS 命令发送到 DTU 设备并封装成DDP协议
function sendCommandToDTU(dtuNo, modbusCommand, rinfo) {
    return new Promise((resolve, reject) => {
        const ddpPacket = buildDDPServerDataPacket(dtuNo, modbusCommand);
        server.send(ddpPacket, rinfo.port, rinfo.address, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

// 示例数据库操作
async function exampleDatabaseOperations() {
    try {
        // 查询示例
        const data = await dbOperations.queryData({
            dtuNo: '13912345678',
            startTime: '2024-01-01',
            endTime: '2024-12-31'
        });
        logWithTime('Query results:', JSON.stringify(data, null, 2));

        // 删除示例
        const deleteResult = await dbOperations.deleteData({ id: 1 });
        logWithTime('Delete result:', deleteResult);

        // 更新示例
        const updateResult = await dbOperations.updateData(2, 'new data');
        logWithTime('Update result:', updateResult);

    } catch (error) {
        console.error('Database operation error:', error);
    }
}

// 定时查询在线DTU设备
const POLL_INTERVAL = 3 * 1000; // 3秒

// 构建MODBUS读取命令（从地址700开始，读取11个寄存器）
function buildRead700to710Command(deviceAddress = 0x02) {
    const startAddr = 700; // 起始地址
    const quantity = 11;   // 获取11个寄存器
    const command = Buffer.from([
        deviceAddress,
        0x03, // 功能码
        (startAddr >> 8) & 0xFF, startAddr & 0xFF,
        (quantity >> 8) & 0xFF, quantity & 0xFF
    ]);
    const crc = calculateModbusCRC(command);
    return Buffer.concat([command, crc]);
}

// 解析700到710寄存器的值
function parse700to710Registers(buffer) {
    // buffer为MODBUS响应报文，前4个字节为地址和功能码，后22个字节为寄存器值，每2个字节一个寄存器
    // 示例buffer = [0x02, 0x03, 0x16, ...22个字节..., CRC]
    if (buffer.length < 25) return null; // 2+1+22=25
    const data = {};
    for (let i = 0; i < 11; i++) {
        // 数据从3字节开始，buffer[3]是每2字节一个寄存器
        const hi = buffer[3 + i * 2];
        const lo = buffer[3 + i * 2 + 1];
        data[`addr${700 + i}`] = (hi << 8) | lo;
    }
    return data;
}

// 定时查询在线DTU设备
setInterval(async () => {
    for (const [dtuNo, info] of ddp.registeredDevices.entries()) {
        try {
            const modbusCmd = buildRead700to710Command();
            await sendCommandToDTU(dtuNo, modbusCmd, {
                address: info.ipAddress,
                port: info.port
            });
            // 等待DTU返回数据，并将DTU发送的响应数据解析后写入数据库
            // 需要将响应数据扩展为Promise+事件驱动
        } catch (err) {
            const logMsg = `查询DTU ${dtuNo} 失败: ${err.message}`;
            console.error(logMsg);
            writeLog(logMsg);
        }
    }
}, POLL_INTERVAL);

// 每5分钟检查一次超时未响应的DTU
setInterval(() => {
    const now = Date.now();
    const TIMEOUT = 5 * 60 * 1000; // 5分钟
    for (const [dtuNo, info] of ddp.registeredDevices.entries()) {
        if (!info.lastActiveTime || now - info.lastActiveTime > TIMEOUT) {
            ddp.registeredDevices.delete(dtuNo);
            const logMsg = `DTU ${dtuNo} offline (timeout, removed from online list)`;
            logWithTime(logMsg);
            writeLog(logMsg);
        }
    }
}, 60 * 1000); // 每分钟执行一次

function getDeviceNameByDtuNo(dtuNo) {
    return new Promise((resolve, reject) => {
        db.get('SELECT DeviceName FROM DeviceDTU WHERE DtuNo = ?', [dtuNo], (err, row) => {
            if (err) {
                resolve(''); // 查询失败时返回空字符串
            } else {
                resolve(row ? row.DeviceName : '');
            }
        });
    });
}

// 查询所有设备列表
app.get('/api/devices', (req, res) => {
    const sql = `SELECT DtuNo, DeviceName FROM DeviceDTU`;
    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ success: false, error: err.message });
            return;
        }
        res.json({
            success: true,
            count: rows.length,
            devices: rows
        });
    });
});
