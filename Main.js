const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const ddp = require('./ddp');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { address } = require('ref-napi');

// 创建数据库连接
const db = new sqlite3.Database('monitor.db', (err) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        return;
    }
    console.log('Connected to monitor.db database');
});

// 在文件顶部添加一个格式化时间的辅助函数
function getBeijingTime() {
    const date = new Date();
    // 设置为北京时间
    date.setHours(date.getHours() + 8);
    return date.toISOString().replace('Z', '+08:00');
}

// 数据库操作函数
const dbOperations = {
    // 插入数据
    insertData: (dtuNo, data) => {
        return new Promise((resolve, reject) => {
            if (!dtuNo || !data) {
                reject(new Error('DTU number and data are required'));
                return;
            }
            // 使用北京时间
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
                // 转换查询结果中的时间
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

    // 如果文件不存在，创建文件并写入 UTF-8 BOM
    if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '\ufeff', { encoding: 'utf8' });
    }
    // 将日志信息写入文件
    const logMessage = `[${timeStr}] ${message}\r\n`;
    fs.appendFileSync(logFile, logMessage, { encoding: 'utf8' });


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
server.on('message', async (msg, rinfo) => {
    const receiveMessage = `Receive Message from ${rinfo.address}:${rinfo.port}`;
    console.log(receiveMessage);
    writeLog(receiveMessage);

    try {
        const result = ddp.parsePacket(msg, rinfo);
        
        switch (result.type) {
            case 'register':
                // 更新/注册设备信息，并记录最后活跃时间
                if (ddp.registeredDevices.has(result.dtuNumber)) {
                    const info = ddp.registeredDevices.get(result.dtuNumber);
                    info.ipAddress = rinfo.address;
                    info.port = rinfo.port;
                    info.lastActiveTime = Date.now();
                    ddp.registeredDevices.set(result.dtuNumber, info);
                }
                // 下面这句其实ddp.js里也有，但这里确保lastActiveTime一定有
                else {
                    ddp.registeredDevices.set(result.dtuNumber, {
                        ipAddress: rinfo.address,
                        port: rinfo.port,
                        registerTime: new Date(),
                        lastActiveTime: Date.now()
                    });
                }
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
                // 数据包也要更新lastActiveTime
                if (ddp.registeredDevices.has(result.dtuNumber)) {
                    const info = ddp.registeredDevices.get(result.dtuNumber);
                    info.lastActiveTime = Date.now();
                    ddp.registeredDevices.set(result.dtuNumber, info);
                }
                // Handle data and save to database
                const dataMsg = `Received Data: DTU=${result.dtuNumber}, Data=${result.data.toString('hex')}`;
                console.log(dataMsg);
                writeLog(dataMsg);

                // 解析700~710寄存器
                let parsed = null;
                try {
                    parsed = parse700to710Registers(result.data);
                } catch (e) {
                    parsed = null;
                }

                try {
                    // 保存到数据库
                    const sql = `
                        INSERT INTO RcvData (
                            DtuNo, RcvTime, Rcvdata,
                            addr700, addr701, addr702, addr703, addr704, addr705,
                            addr706, addr707, addr708, addr709, addr710
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    const now = new Date();
                    // 转为北京时间
                    now.setHours(now.getHours() + 8);
                    const beijingTime = now.toISOString().replace('Z', '+08:00');
                    // 保存到数据库
                    const values = [
                        result.dtuNumber,
                        beijingTime, // 用北京时间
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
                            console.log('Data saved to database successfully');
                        }
                    });
                } catch (dbError) {
                    console.error('Failed to save data:', dbError);
                    writeLog(`[ERROR] Failed to save data: ${dbError.message}`);
                }
                break;

            default:
                const unknownMsg = `Unknown Data Type: ${result.type}`;
                console.log(unknownMsg);
                writeLog(unknownMsg);
        }
    } catch (error) {
        const errorMessage = `Error on resolve received data: ${error.message}`;
        console.error(errorMessage);
        writeLog(`[ERROR] ${errorMessage}`);
    }
});

// 错误处理
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

// 在程序退出时关闭数据库连接
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        console.log('Database connection closed');
        process.exit(0);
    });
});

// 创建Express应用
const app = express();
const API_PORT = 3000;

// 使用中间件
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
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. 获取单条数据
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
        res.json({
            success: true,
            data: data[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. 插入数据
app.post('/api/data', async (req, res) => {
    try {
        const { dtuNo, data } = req.body;
        
        // 验证必要参数
        if (!dtuNo || !data) {
            res.status(400).json({
                success: false,
                error: 'DTU number and data are required'
            });
            return;
        }

        // 记录接收到的数据
        console.log('Received POST request:', {
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
        
        // 验证必要参数
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

        // 获取设备信息（假设已在 ddp.js 中维护了设备连接信息）
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
        const modbusCommand = buildModbusCommand(0x02, value); // 设备地址固定为 0x02

        // 发送命令
        await sendCommandToDTU(dtuNo, modbusCommand, {
            address: deviceInfo.ipAddress,
            port: deviceInfo.port
        });

        // 记录操作
        const logMessage = `Relay control command sent: DTU=${dtuNo}, IP=${deviceInfo.ipAddress}, Port=${deviceInfo.port}, Command=${command}`;
        console.log(logMessage);
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
        // 补0
        const pad = n => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
             + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    const onlineList = Array.from(ddp.registeredDevices.entries()).map(([dtuNo, info]) => ({
        dtuNo,
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

// 启动 Express 服务器
app.listen(API_PORT, () => {
    console.log(`API Server running on port ${API_PORT}`);
});

// 添加 MODBUS CRC 校验计算函数
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

// 构建 MODBUS 写指令
function buildModbusCommand(deviceAddress, value) {
    // 构建基本命令（不含 CRC）
    const command = Buffer.from([
        deviceAddress,  // 设备地址
        0x06,          // 功能码
        0x02, 0xC5,    // 写入地址
        (value >> 8) & 0xFF, value & 0xFF  // 写入值（高字节在前）
    ]);
    
    // 计算 CRC
    const crc = calculateModbusCRC(command);
    
    // 合并命令和 CRC
    return Buffer.concat([command, crc]);
}

// 构建DDP协议包（服务器向DTU发送）
function buildDDPServerDataPacket(dtuNo, modbusCommand) {
    // DDP协议头部16字节
    const buffer = Buffer.alloc(16);
    buffer[0] = 0x7B; // 起始字节
    buffer[1] = 0x89; // 包类型：服务器向DTU发送
    buffer[2] = 0x00; // 包长度高字节
    buffer[3] = 0x10; // 包长度低字节（固定16）
    // 写入DTU号（ASCII，11字节，不足补0x00）
    Buffer.from(dtuNo.padEnd(11, '\0')).copy(buffer, 4, 0, 11);
    buffer[15] = 0x7B; // 结束字节

    // 拼接实际数据（MODBUS命令）
    return Buffer.concat([buffer, modbusCommand]);
}

// 发送 MODBUS 命令到 DTU 设备（自动封装DDP协议）
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

// 示例：如何使用数据库操作函数
async function exampleDatabaseOperations() {
    try {
        // 查询示例
        const data = await dbOperations.queryData({
            dtuNo: '13912345678',
            startTime: '2024-01-01',
            endTime: '2024-12-31'
        });
        console.log('Query results:', JSON.stringify(data, null, 2));

        // 删除示例
        const deleteResult = await dbOperations.deleteData({ id: 1 });
        console.log('Delete result:', deleteResult);

        // 更新示例
        const updateResult = await dbOperations.updateData(2, 'new data');
        console.log('Update result:', updateResult);

    } catch (error) {
        console.error('Database operation error:', error);
    }
}

// 轮询间隔（单位：毫秒）
const POLL_INTERVAL = 3 * 1000; // 3秒

// 构建MODBUS读寄存器命令（功能码03，起始地址700，长度11）
function buildRead700to710Command(deviceAddress = 0x02) {
    const startAddr = 700; // 起始地址
    const quantity = 11;   // 读取11个寄存器
    const command = Buffer.from([
        deviceAddress,
        0x03, // 读保持寄存器
        (startAddr >> 8) & 0xFF, startAddr & 0xFF,
        (quantity >> 8) & 0xFF, quantity & 0xFF
    ]);
    const crc = calculateModbusCRC(command);
    return Buffer.concat([command, crc]);
}

// 解析寄存器数据
function parse700to710Registers(buffer) {
    // buffer为MODBUS数据区（不含协议头），第4字节为字节数，后面每2字节一个寄存器
    // 例：buffer = [0x02, 0x03, 0x16, ...22字节数据..., CRC]
    if (buffer.length < 25) return null; // 2+1+22=25
    const data = {};
    for (let i = 0; i < 11; i++) {
        // 数据从第3字节开始（buffer[3]），每2字节一个寄存器
        const hi = buffer[3 + i * 2];
        const lo = buffer[3 + i * 2 + 1];
        data[`addr${700 + i}`] = (hi << 8) | lo;
    }
    return data;
}

// 定时轮询所有在线DTU
setInterval(async () => {
    for (const [dtuNo, info] of ddp.registeredDevices.entries()) {
        try {
            const modbusCmd = buildRead700to710Command();
            await sendCommandToDTU(dtuNo, modbusCmd, {
                address: info.ipAddress,
                port: info.port
            });
            // 发送后，等待DTU上报数据（假设DTU收到后会主动上传数据包，已在UDP接收逻辑中处理）
            // 如果需要主动等待响应，可扩展为Promise+事件回调
        } catch (err) {
            const logMsg = `轮询DTU ${dtuNo} 失败: ${err.message}`;
            console.error(logMsg);
            writeLog(logMsg);
        }
    }
}, POLL_INTERVAL);

// 每分钟检查一次，移除超过5分钟未活跃的DTU
setInterval(() => {
    const now = Date.now();
    const TIMEOUT = 5 * 60 * 1000; // 5分钟
    for (const [dtuNo, info] of ddp.registeredDevices.entries()) {
        if (!info.lastActiveTime || now - info.lastActiveTime > TIMEOUT) {
            ddp.registeredDevices.delete(dtuNo);
            const logMsg = `DTU ${dtuNo} offline (timeout, removed from online list)`;
            console.log(logMsg);
            writeLog(logMsg);
        }
    }
}, 60 * 1000); // 每分钟执行一次
