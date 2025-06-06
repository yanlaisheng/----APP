const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const ddp = require('./ddp');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { address } = require('ref-napi');

// �������ݿ�����
const db = new sqlite3.Database('monitor.db', (err) => {
    if (err) {
        console.error('Database connection failed:', err.message);
        return;
    }
    console.log('Connected to monitor.db database');
});

// ���ļ��������һ����ʽ��ʱ��ĸ�������
function getBeijingTime() {
    const date = new Date();
    // ����Ϊ����ʱ��
    date.setHours(date.getHours() + 8);
    return date.toISOString().replace('Z', '+08:00');
}

// ���ݿ��������
const dbOperations = {
    // ��������
    insertData: (dtuNo, data) => {
        return new Promise((resolve, reject) => {
            if (!dtuNo || !data) {
                reject(new Error('DTU number and data are required'));
                return;
            }
            // ʹ�ñ���ʱ��
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

    // ��ѯ����
    queryData: (conditions = {}) => {
        return new Promise((resolve, reject) => {
            let sql = 'SELECT * FROM RcvData';
            const params = [];
            
            // ������ѯ����
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
                // ת����ѯ����е�ʱ��
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

    // ɾ������
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

    // ��������
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
server.on('message', async (msg, rinfo) => {
    const receiveMessage = `Receive Message from ${rinfo.address}:${rinfo.port}`;
    console.log(receiveMessage);
    writeLog(receiveMessage);

    try {
        const result = ddp.parsePacket(msg, rinfo);
        
        switch (result.type) {
            case 'register':
                // ����/ע���豸��Ϣ������¼����Ծʱ��
                if (ddp.registeredDevices.has(result.dtuNumber)) {
                    const info = ddp.registeredDevices.get(result.dtuNumber);
                    info.ipAddress = rinfo.address;
                    info.port = rinfo.port;
                    info.lastActiveTime = Date.now();
                    ddp.registeredDevices.set(result.dtuNumber, info);
                }
                // ���������ʵddp.js��Ҳ�У�������ȷ��lastActiveTimeһ����
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
                // ���ݰ�ҲҪ����lastActiveTime
                if (ddp.registeredDevices.has(result.dtuNumber)) {
                    const info = ddp.registeredDevices.get(result.dtuNumber);
                    info.lastActiveTime = Date.now();
                    ddp.registeredDevices.set(result.dtuNumber, info);
                }
                // Handle data and save to database
                const dataMsg = `Received Data: DTU=${result.dtuNumber}, Data=${result.data.toString('hex')}`;
                console.log(dataMsg);
                writeLog(dataMsg);

                // ����700~710�Ĵ���
                let parsed = null;
                try {
                    parsed = parse700to710Registers(result.data);
                } catch (e) {
                    parsed = null;
                }

                try {
                    // ���浽���ݿ�
                    const sql = `
                        INSERT INTO RcvData (
                            DtuNo, RcvTime, Rcvdata,
                            addr700, addr701, addr702, addr703, addr704, addr705,
                            addr706, addr707, addr708, addr709, addr710
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    const now = new Date();
                    // תΪ����ʱ��
                    now.setHours(now.getHours() + 8);
                    const beijingTime = now.toISOString().replace('Z', '+08:00');
                    // ���浽���ݿ�
                    const values = [
                        result.dtuNumber,
                        beijingTime, // �ñ���ʱ��
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


// �󶨶˿ڲ���ʼ����
server.bind(PORT);

// �ڳ����˳�ʱ�ر����ݿ�����
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        console.log('Database connection closed');
        process.exit(0);
    });
});

// ����ExpressӦ��
const app = express();
const API_PORT = 3000;

// ʹ���м��
app.use(cors());
app.use(bodyParser.json());

// API·��
// 1. ��ѯ����
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

// 2. ��ȡ��������
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

// 3. ��������
app.post('/api/data', async (req, res) => {
    try {
        const { dtuNo, data } = req.body;
        
        // ��֤��Ҫ����
        if (!dtuNo || !data) {
            res.status(400).json({
                success: false,
                error: 'DTU number and data are required'
            });
            return;
        }

        // ��¼���յ�������
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

// 4. ��������
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

// 5. ɾ������
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

// ��Ӽ̵������� API
app.post('/api/control/relay', async (req, res) => {
    try {
        const { dtuNo, command } = req.body;
        
        // ��֤��Ҫ����
        if (!dtuNo || !command) {
            res.status(400).json({
                success: false,
                error: 'DTU number and command are required'
            });
            return;
        }

        // ��֤����
        if (command !== 'ON' && command !== 'OFF') {
            res.status(400).json({
                success: false,
                error: 'Invalid command. Must be ON or OFF'
            });
            return;
        }

        // ��ȡ�豸��Ϣ���������� ddp.js ��ά�����豸������Ϣ��
        const deviceInfo = ddp.registeredDevices.get(dtuNo);
        if (!deviceInfo) {
            res.status(404).json({
                success: false,
                error: 'DTU device not found or not registered'
            });
            return;
        }

        // ���� MODBUS ����
        const value = command === 'ON' ? 0x0001 : 0x0000;
        const modbusCommand = buildModbusCommand(0x02, value); // �豸��ַ�̶�Ϊ 0x02

        // ��������
        await sendCommandToDTU(dtuNo, modbusCommand, {
            address: deviceInfo.ipAddress,
            port: deviceInfo.port
        });

        // ��¼����
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

// ��ȡ��ǰ����DTU�豸�б�
app.get('/api/online-dtus', (req, res) => {
    function formatTime(t) {
        if (!t) return '';
        const date = new Date(t);
        // ��0
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

// ���� Express ������
app.listen(API_PORT, () => {
    console.log(`API Server running on port ${API_PORT}`);
});

// ��� MODBUS CRC У����㺯��
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
    // ���������ֽڵ� CRC
    return Buffer.from([crc & 0xFF, (crc >> 8) & 0xFF]);
}

// ���� MODBUS дָ��
function buildModbusCommand(deviceAddress, value) {
    // ��������������� CRC��
    const command = Buffer.from([
        deviceAddress,  // �豸��ַ
        0x06,          // ������
        0x02, 0xC5,    // д���ַ
        (value >> 8) & 0xFF, value & 0xFF  // д��ֵ�����ֽ���ǰ��
    ]);
    
    // ���� CRC
    const crc = calculateModbusCRC(command);
    
    // �ϲ������ CRC
    return Buffer.concat([command, crc]);
}

// ����DDPЭ�������������DTU���ͣ�
function buildDDPServerDataPacket(dtuNo, modbusCommand) {
    // DDPЭ��ͷ��16�ֽ�
    const buffer = Buffer.alloc(16);
    buffer[0] = 0x7B; // ��ʼ�ֽ�
    buffer[1] = 0x89; // �����ͣ���������DTU����
    buffer[2] = 0x00; // �����ȸ��ֽ�
    buffer[3] = 0x10; // �����ȵ��ֽڣ��̶�16��
    // д��DTU�ţ�ASCII��11�ֽڣ����㲹0x00��
    Buffer.from(dtuNo.padEnd(11, '\0')).copy(buffer, 4, 0, 11);
    buffer[15] = 0x7B; // �����ֽ�

    // ƴ��ʵ�����ݣ�MODBUS���
    return Buffer.concat([buffer, modbusCommand]);
}

// ���� MODBUS ��� DTU �豸���Զ���װDDPЭ�飩
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

// ʾ�������ʹ�����ݿ��������
async function exampleDatabaseOperations() {
    try {
        // ��ѯʾ��
        const data = await dbOperations.queryData({
            dtuNo: '13912345678',
            startTime: '2024-01-01',
            endTime: '2024-12-31'
        });
        console.log('Query results:', JSON.stringify(data, null, 2));

        // ɾ��ʾ��
        const deleteResult = await dbOperations.deleteData({ id: 1 });
        console.log('Delete result:', deleteResult);

        // ����ʾ��
        const updateResult = await dbOperations.updateData(2, 'new data');
        console.log('Update result:', updateResult);

    } catch (error) {
        console.error('Database operation error:', error);
    }
}

// ��ѯ�������λ�����룩
const POLL_INTERVAL = 3 * 1000; // 3��

// ����MODBUS���Ĵ������������03����ʼ��ַ700������11��
function buildRead700to710Command(deviceAddress = 0x02) {
    const startAddr = 700; // ��ʼ��ַ
    const quantity = 11;   // ��ȡ11���Ĵ���
    const command = Buffer.from([
        deviceAddress,
        0x03, // �����ּĴ���
        (startAddr >> 8) & 0xFF, startAddr & 0xFF,
        (quantity >> 8) & 0xFF, quantity & 0xFF
    ]);
    const crc = calculateModbusCRC(command);
    return Buffer.concat([command, crc]);
}

// �����Ĵ�������
function parse700to710Registers(buffer) {
    // bufferΪMODBUS������������Э��ͷ������4�ֽ�Ϊ�ֽ���������ÿ2�ֽ�һ���Ĵ���
    // ����buffer = [0x02, 0x03, 0x16, ...22�ֽ�����..., CRC]
    if (buffer.length < 25) return null; // 2+1+22=25
    const data = {};
    for (let i = 0; i < 11; i++) {
        // ���ݴӵ�3�ֽڿ�ʼ��buffer[3]����ÿ2�ֽ�һ���Ĵ���
        const hi = buffer[3 + i * 2];
        const lo = buffer[3 + i * 2 + 1];
        data[`addr${700 + i}`] = (hi << 8) | lo;
    }
    return data;
}

// ��ʱ��ѯ��������DTU
setInterval(async () => {
    for (const [dtuNo, info] of ddp.registeredDevices.entries()) {
        try {
            const modbusCmd = buildRead700to710Command();
            await sendCommandToDTU(dtuNo, modbusCmd, {
                address: info.ipAddress,
                port: info.port
            });
            // ���ͺ󣬵ȴ�DTU�ϱ����ݣ�����DTU�յ���������ϴ����ݰ�������UDP�����߼��д���
            // �����Ҫ�����ȴ���Ӧ������չΪPromise+�¼��ص�
        } catch (err) {
            const logMsg = `��ѯDTU ${dtuNo} ʧ��: ${err.message}`;
            console.error(logMsg);
            writeLog(logMsg);
        }
    }
}, POLL_INTERVAL);

// ÿ���Ӽ��һ�Σ��Ƴ�����5����δ��Ծ��DTU
setInterval(() => {
    const now = Date.now();
    const TIMEOUT = 5 * 60 * 1000; // 5����
    for (const [dtuNo, info] of ddp.registeredDevices.entries()) {
        if (!info.lastActiveTime || now - info.lastActiveTime > TIMEOUT) {
            ddp.registeredDevices.delete(dtuNo);
            const logMsg = `DTU ${dtuNo} offline (timeout, removed from online list)`;
            console.log(logMsg);
            writeLog(logMsg);
        }
    }
}, 60 * 1000); // ÿ����ִ��һ��
