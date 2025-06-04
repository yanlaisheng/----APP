const dgram = require('dgram');
const server = dgram.createSocket('udp4');
// res.setHeader('Content-Type', 'text/html;charset=utf-8');

// 设置控制台编码
process.stdout.setEncoding('utf8');
process.stderr.setEncoding('utf8');

// 监听端口号
// 设置监听端口号并指定编码
const PORT = 8888;
process.env.LANG = 'zh_CN.UTF-8'; // 设置终端环境编码为UTF-8

// 当UDP服务器启动并监听时触发
server.on('listening', () => {
    // 获取服务器地址信息并指定编码
    const address = server.address();
    Buffer.from(JSON.stringify(address)).toString('utf8');
    console.log(`UDP Service Listening ${address.address}:${address.port}`);
});

// 当接收到消息时触发
server.on('message', (msg, rinfo) => {
    console.log(`Receive Message from ${rinfo.address}:${rinfo.port} `);

    try {
        // 将接收到的Buffer转换为字符串，使用utf-8编码解决中文乱码
        const data = msg.toString();

        // 根据不同的数据类型进行处理
        if (data.startsWith('TYPE1')) {
            // 处理类型1的数据
            handleType1Data(data);
        } else if (data.startsWith('TYPE2')) {
            // 处理类型2的数据
            handleType2Data(data);
        } else {
            // 处理未知类型的数据
            console.log('收到Received unknown data type:', data);
            // // 尝试使用不同的编码方式解析数据
            // try {
            //     console.log('使用GBK编码:', iconv.decode(Buffer.from(data), 'gbk'));
            //     console.log('使用GB2312编码:', iconv.decode(Buffer.from(data), 'gb2312'));
            //     console.log('原始数据:', data);
            // } catch (e) {
            //     console.log('编码转换失败:', e);
            // }
        }

    } catch (error) {
        console.error('处理数据时发生错误:', error);
    }
});

// 错误处理
server.on('error', (err) => {
    // 检查错误是否与iconv相关
    if (err.message && err.message.includes('iconv')) {
        console.error('UDP服务器错误: 请先安装iconv-lite模块 (npm install iconv-lite)');
    } else {
        console.error('UDP服务器错误:', err);
    }
    server.close();
});

// 数据处理函数
function handleType1Data(data) {
    console.log('处理类型1数据:', data);
    // 在这里添加具体的处理逻辑
}

function handleType2Data(data) {
    console.log('处理类型2数据:', data);
    // 在这里添加具体的处理逻辑
}

// 绑定端口并开始监听
server.bind(PORT);
