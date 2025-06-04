const dgram = require('dgram');
const server = dgram.createSocket('udp4');
// res.setHeader('Content-Type', 'text/html;charset=utf-8');

// ���ÿ���̨����
process.stdout.setEncoding('utf8');
process.stderr.setEncoding('utf8');

// �����˿ں�
// ���ü����˿ںŲ�ָ������
const PORT = 8888;
process.env.LANG = 'zh_CN.UTF-8'; // �����ն˻�������ΪUTF-8

// ��UDP����������������ʱ����
server.on('listening', () => {
    // ��ȡ��������ַ��Ϣ��ָ������
    const address = server.address();
    Buffer.from(JSON.stringify(address)).toString('utf8');
    console.log(`UDP Service Listening ${address.address}:${address.port}`);
});

// �����յ���Ϣʱ����
server.on('message', (msg, rinfo) => {
    console.log(`Receive Message from ${rinfo.address}:${rinfo.port} `);

    try {
        // �����յ���Bufferת��Ϊ�ַ�����ʹ��utf-8��������������
        const data = msg.toString();

        // ���ݲ�ͬ���������ͽ��д���
        if (data.startsWith('TYPE1')) {
            // ��������1������
            handleType1Data(data);
        } else if (data.startsWith('TYPE2')) {
            // ��������2������
            handleType2Data(data);
        } else {
            // ����δ֪���͵�����
            console.log('�յ�Received unknown data type:', data);
            // // ����ʹ�ò�ͬ�ı��뷽ʽ��������
            // try {
            //     console.log('ʹ��GBK����:', iconv.decode(Buffer.from(data), 'gbk'));
            //     console.log('ʹ��GB2312����:', iconv.decode(Buffer.from(data), 'gb2312'));
            //     console.log('ԭʼ����:', data);
            // } catch (e) {
            //     console.log('����ת��ʧ��:', e);
            // }
        }

    } catch (error) {
        console.error('��������ʱ��������:', error);
    }
});

// ������
server.on('error', (err) => {
    // �������Ƿ���iconv���
    if (err.message && err.message.includes('iconv')) {
        console.error('UDP����������: ���Ȱ�װiconv-liteģ�� (npm install iconv-lite)');
    } else {
        console.error('UDP����������:', err);
    }
    server.close();
});

// ���ݴ�����
function handleType1Data(data) {
    console.log('��������1����:', data);
    // ��������Ӿ���Ĵ����߼�
}

function handleType2Data(data) {
    console.log('��������2����:', data);
    // ��������Ӿ���Ĵ����߼�
}

// �󶨶˿ڲ���ʼ����
server.bind(PORT);
