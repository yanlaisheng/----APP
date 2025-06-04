const EventEmitter = require('events');

class DDPProtocol extends EventEmitter {
    constructor() {
        super();
        this.PACKET_TYPES = {
            REGISTER: 0x01,
            UNREGISTER: 0x02,
            DATA: 0x09,
            REGISTER_SUCCESS: 0x81,
            UNREGISTER_SUCCESS: 0x82,
            SERVER_DATA: 0x89
        };
        
        // 存储已注册的DTU设备信息
        this.registeredDevices = new Map();
    }

    // 解析接收到的数据
    parsePacket(data) {
        try {
            const buffer = Buffer.from(data);
            
            // 获取包类型
            const packetType = buffer[1];
            
            switch (packetType) {
                case this.PACKET_TYPES.REGISTER: // 0x01 注册包
                    if (buffer.length !== 22) {
                        throw new Error('注册包长度必须为22字节');
                    }
                    if (buffer[0] !== 0x7B || buffer[21] !== 0x7B) {
                        throw new Error('注册包首尾字节必须为0x7B');
                    }
                    if (buffer[2] !== 0x00 || buffer[3] !== 0x16) {
                        throw new Error('注册包长度字段不正确');
                    }
                    return this.handleRegister(buffer);

                case this.PACKET_TYPES.UNREGISTER: // 0x02 注销包
                    if (buffer.length !== 16) {
                        throw new Error('注销包长度必须为16字节');
                    }
                    if (buffer[0] !== 0x7B || buffer[15] !== 0x7B) {
                        throw new Error('注销包首尾字节必须为0x7B');
                    }
                    if (buffer[2] !== 0x00 || buffer[3] !== 0x10) {
                        throw new Error('注销包长度字段不正确');
                    }
                    const dtuNumber = buffer.slice(4, 15).toString('ascii');
                    return this.handleUnregister(dtuNumber);

                case this.PACKET_TYPES.DATA: // 0x09 数据包
                    if (buffer.length < 16) {
                        throw new Error('数据包最小长度为16字节');
                    }
                    if (buffer[0] !== 0x7B || buffer[15] !== 0x7B) {
                        throw new Error('数据包头部格式错误');
                    }
                    if (buffer.length > 1040) { // 16(头部) + 1024(最大数据长度)
                        throw new Error('数据包超过最大长度1040字节');
                    }
                    return this.handleData(buffer);

                default:
                    throw new Error(`未知的包类型: 0x${packetType.toString(16)}`);
            }
        } catch (error) {
            throw new Error(`数据包解析错误: ${error.message}`);
        }
    }

    // 处理注册包
    handleRegister(buffer) {
        const dtuNumber = buffer.slice(4, 15).toString('ascii');
        const ipAddress = Array.from(buffer.slice(15, 19))
            .map(byte => byte.toString())
            .join('.');
        const port = (buffer[19] << 8) | buffer[20];

        this.registeredDevices.set(dtuNumber, {
            ipAddress,
            port,
            registerTime: new Date()
        });

        // 构建注册成功响应包
        const response = this.buildResponsePacket(
            this.PACKET_TYPES.REGISTER_SUCCESS,
            dtuNumber
        );

        return {
            type: 'register',
            dtuNumber,
            ipAddress,
            port,
            response
        };
    }

    // 处理注销包
    handleUnregister(dtuNumber) {
        this.registeredDevices.delete(dtuNumber);

        // 构建注销成功响应包
        const response = this.buildResponsePacket(
            this.PACKET_TYPES.UNREGISTER_SUCCESS,
            dtuNumber
        );

        return {
            type: 'unregister',
            dtuNumber,
            response
        };
    }

    // 修改数据包处理方法
    handleData(buffer) {
        const dtuNumber = buffer.slice(4, 15).toString('ascii');
        const data = buffer.slice(16); // 从第17个字节开始的数据

        return {
            type: 'data',
            dtuNumber,
            data
        };
    }

    // 构建响应数据包
    buildResponsePacket(type, dtuNumber) {
        const buffer = Buffer.alloc(16);
        buffer[0] = 0x7B; // 起始字节
        buffer[1] = type; // 包类型
        buffer[2] = 0x00; // 包长度高字节
        buffer[3] = 0x10; // 包长度低字节
        
        // 写入DTU号
        Buffer.from(dtuNumber).copy(buffer, 4);
        
        buffer[15] = 0x7B; // 结束字节
        return buffer;
    }

    // 构建服务器发送的数据包
    buildServerDataPacket(dtuNumber, data) {
        const dataBuffer = Buffer.from(data);
        const totalLength = 16 + dataBuffer.length;
        const buffer = Buffer.alloc(totalLength);

        buffer[0] = 0x7B; // 起始字节
        buffer[1] = this.PACKET_TYPES.SERVER_DATA; // 包类型
        buffer[2] = (totalLength >> 8) & 0xFF; // 包长度高字节
        buffer[3] = totalLength & 0xFF; // 包长度低字节

        // 写入DTU号
        Buffer.from(dtuNumber).copy(buffer, 4);
        
        buffer[15] = 0x7B; // 第16个字节
        dataBuffer.copy(buffer, 16); // 写入实际数据

        return buffer;
    }
}

module.exports = new DDPProtocol();