'use strict';
var CryptoJS = require("crypto-js"); var express = require("express");
var bodyParser = require('body-parser'); var WebSocket = require("ws");
var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];
const crypto = require('crypto');

class Block {
    constructor(index, previousHash, timestamp, data, hash, nonce) {
        this.index = index;
        this.previousHash = previousHash.toString(); this.timestamp = timestamp;
        this.data = data;
        this.hash = hash.toString();
        this.nonce = this.nonce;
    }
}
// Массив сокетов через которые проходят обмен сообщениями между частниками сети
var sockets = [];
var MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
};

// Первый блок(Гинезис-блок)
var getGenesisBlock = () => { return new Block(0, "0", 1682839690, "RUT-MIIT first block", "8d9d5a7ff4a78042ea6737bf59c772f8ed27ef3c9b576eac1976c91aaf48d2de", 0); };

// Кладем первоначальный блок в Блокчейн
var blockchain = [getGenesisBlock()];

// Создадим и запустим веб-сервер, используемый для обслуживания
// запросов от узлов в блокчейн-сети.


var initHttpServer = () => {
    var app = express(); app.use(bodyParser.json());
    app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain))); app.post('/mineBlock', (req, res) => {
        var newBlock = mineBlock(req.body.data);
        addBlock(newBlock);
        broadcast(responseLatestMsg());
        console.log('block added: ' + JSON.stringify(newBlock)); res.send();
    });
    app.get('/peers', (req, res) => {
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });
    app.post('/addPeer', (req, res) => {
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.listen(http_port, () => console.log('Listening http on port: ' + http_port));
};

// Сервер отвечает по следующим endpoint’ам:

// /blocks - для получения списка блоков в цепочке блоков.


// /    Block - для майнинга (добычи) нового блока. При POST запросе сервер создает новый блок с данными,
//  полученными от клиента, добавляет его в цепочку блоков с 
//  помощью функции addBlock() и отправляет сообщение обновления всем узлам в сети


// /peers - для получения списка узлов в сети.

// /addPeer - для добавления нового узла в сеть. 
// При POST запросе сервер подключается к указанному узлу 
// и отправляет сообщение обновления всем узлам в сети.




// Далее создаем и запустим веб-сервер, используемый для обмена
// сообщениями между узлами в блокчейн-сети.
var initP2PServer = () => {
    var server = new WebSocket.Server({ port: p2p_port });
    server.on('connection', ws => initConnection(ws));
    console.log('listening websocket p2p port on: ' + p2p_port);
};

// Далее проинициализируем и определим функции, 
// используемые для обработки сообщений.
//  Если ошибка – соединение закрывается, сокет
// удаляется, в противном случае сообщения обрабатываются.


var initConnection = (ws) => {
    sockets.push(ws); initMessageHandler(ws); initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
};
var initMessageHandler = (ws) => {
    ws.on('message', (data) => {
        var message = JSON.parse(data);
        console.log('Received message' + JSON.stringify(message)); switch (message.type) {
            case MessageType.QUERY_LATEST: write(ws, responseLatestMsg()); break;
            case MessageType.QUERY_ALL: write(ws, responseChainMsg()); break;
            case MessageType.RESPONSE_BLOCKCHAIN: handleBlockchainResponse(message); break;
        }
    });
};
var initErrorHandler = (ws) => {
    var closeConnection = (ws) => {
        console.log('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', () => closeConnection(ws));
    ws.on('error', () => closeConnection(ws));
};

var connectToPeers = (newPeers) => {
    newPeers.forEach((peer) => {
        var ws = new WebSocket(peer); ws.on('open', () => initConnection(ws)); ws.on('error', () => {
            console.log('connection failed')
        });
    });
};
var handleBlockchainResponse = (message) => {
    var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index));
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1]; var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("We can append the received block to our chain"); blockchain.push(latestBlockReceived); broadcast(responseLatestMsg());
        } else if (receivedBlocks.length === 1) {
            console.log("We have to query the chain from our peer"); broadcast(queryAllMsg());
        } else {
            console.log("Received blockchain is longer than current blockchain"); replaceChain(receivedBlocks);
        }
    } else {
        console.log('received blockchain is not longer than current blockchain. Do nothing');
    }
};


// Далее проинициализируем и определим функции, используемые для
// генерации блока, расчета хеша, добавления блока в цепочку и проверки блока.
// Для генерации блока нам необходимо знать хэш предыдущего блока. 
// Обратите внимание на проверку блока, 
// в блокчейн сети мы всегда должны иметь возможность проверить, 
// является ли блок допустимым

var generateNextBlock = (blockData) => {
    var previousBlock = getLatestBlock();
    var nextIndex = previousBlock.index + 1;
    var nextTimestamp = new Date().getTime() / 1000;
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp,
        blockData);
    return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash);
};
var calculateHashForBlock = (block) => {
    return calculateHash(block.index, block.previousHash, block.timestamp,
        block.data, block.nonce);
};

// Разобраться что делать с хешом и майниногм! 

function calculateHash(index, previousHash, timestamp, data,nonce) {
    const input = previousHash + timestamp + JSON.stringify(data) + index + nonce;
    let hash = crypto.createHash('md5').update(input).digest('hex');

// Проверяем, являются ли первые два числа и последние два числа хеша четными
    const firstTwoDigits = parseInt(hash.substr(0, 2), 16);
    const lastTwoDigits = parseInt(hash.substr(-2), 16);

    if (isNaN(firstTwoDigits) || isNaN(lastTwoDigits) || firstTwoDigits % 2 !== 0 || lastTwoDigits % 2 !== 0) {
 // Если условие не выполняется, увеличиваем nonce и рекурсивно вызываем функцию с новым значением nonce
        return calculateHash(index, previousHash, timestamp, data, nonce + 1);
    }

    return hash;
};
var addBlock = (newBlock) => {
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }
};
var isValidNewBlock = (newBlock, previousBlock) => {
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('invalid index');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        console.log('invalid previoushash');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
};



// Далее реализуем функцию определения самой длинной цепочки и
// проверки её на допустимость.



var replaceChain = (newBlocks) => {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    } else {
        console.log('Received blockchain invalid');
    }
};
var isValidChain = (blockchainToValidate) => {
    if (JSON.stringify(blockchainToValidate[0]) !==
        JSON.stringify(getGenesisBlock())) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
};

// Далее определим реализацию вспомогательных функций и запустим веб- сервера.

var getLatestBlock = () => blockchain[blockchain.length - 1];
var queryChainLengthMsg = () => ({ 'type': MessageType.QUERY_LATEST }); var queryAllMsg = () => ({ 'type': MessageType.QUERY_ALL });
var responseChainMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
var responseLatestMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify([getLatestBlock()])
});
var write = (ws, message) => ws.send(JSON.stringify(message));
var broadcast = (message) => sockets.forEach(socket => write(socket, message));
connectToPeers(initialPeers); initHttpServer(); initP2PServer();

var mineBlock = (blockData) => {
    var previousBlock = getLatestBlock();
    var nextIndex = previousBlock.index + 1;
    var nonce = 0;
    var nextTimestamp = new Date().getTime() / 1000;
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData, nonce);
    while (getSumOfDigits(nextHash) % 3.14 !== 0) {
        nonce++;
        nextTimestamp = new Date().getTime() / 1000;
        nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData, nonce);
        console.log("\"index\":" + nextIndex + ",\"previousHash\":" + previousBlock.hash +
            "\"timestamp\":" + nextTimestamp + ",\"data\":" + blockData +
            ",\x1b[33mhash: " + nextHash + " \x1b[0m," +
            " \x1b[33mnonce: " + nonce + " \x1b[0m ");
    }
    return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash,nonce);
    function getSumOfDigits(str) {
        let sum = 0;
        for (let i = 0; i < str.length; i++) {
            const digit = parseInt(str.charAt(i));
            if (!isNaN(digit)) {
                sum += digit;
            }
        }
        return sum;
    }

}









'use strict';
var CryptoJS = require("crypto-js"); var express = require("express");
var bodyParser = require('body-parser'); var WebSocket = require("ws");
var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];

class Block {
    constructor(index, previousHash, timestamp, data, hash) {
        this.index = index;
        this.previousHash = previousHash.toString(); this.timestamp = timestamp;
        this.data = data;
        this.hash = hash.toString();
    }
}

var sockets = [];
var MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
};

var getGenesisBlock = () => {
    return new Block(0, "0", 1682839690, "RUT-MIIT first block", "8d9d5a7ff4a78042ea6737bf59c772f8ed27ef3c9b576eac1976c91aaf48d2de");
};

var blockchain = [getGenesisBlock()];

var initHttpServer = () => {
    var app = express(); app.use(bodyParser.json());
    app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain))); app.post('/mineBlock', (req, res) => {
        var newBlock = generateNextBlock(req.body.data); addBlock(newBlock);
        broadcast(responseLatestMsg());
        console.log('block added: ' + JSON.stringify(newBlock)); res.send();
    });
    app.get('/peers', (req, res) => {
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });
    app.post('/addPeer', (req, res) => {
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.listen(http_port, () => console.log('Listening http on port: ' + http_port));
};

var initP2PServer = () => {
    var server = new WebSocket.Server({ port: p2p_port }); server.on('connection', ws => initConnection(ws)); console.log('listening websocket p2p port on: ' + p2p_port);
};

var initConnection = (ws) => {
    sockets.push(ws); initMessageHandler(ws); initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
};
var initMessageHandler = (ws) => {
    ws.on('message', (data) => {
        var message = JSON.parse(data);
        console.log('Received message' + JSON.stringify(message)); switch (message.type) {
            case MessageType.QUERY_LATEST: write(ws, responseLatestMsg()); break;
            case MessageType.QUERY_ALL: write(ws, responseChainMsg()); break;
            case MessageType.RESPONSE_BLOCKCHAIN: handleBlockchainResponse(message); break;
        }
    });
};
var initErrorHandler = (ws) => {
    var closeConnection = (ws) => {
        console.log('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', () => closeConnection(ws));
    ws.on('error', () => closeConnection(ws));
};

var connectToPeers = (newPeers) => {
    newPeers.forEach((peer) => {
        var ws = new WebSocket(peer); ws.on('open', () => initConnection(ws)); ws.on('error', () => {
            console.log('connection failed')
        });
    });
};
var handleBlockchainResponse = (message) => {
    var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index));
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1]; var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("We can append the received block to our chain"); blockchain.push(latestBlockReceived); broadcast(responseLatestMsg());
        } else if (receivedBlocks.length === 1) {
            console.log("We have to query the chain from our peer"); broadcast(queryAllMsg());
        } else {
            console.log("Received blockchain is longer than current blockchain"); replaceChain(receivedBlocks);
        }
    } else {
        console.log('received blockchain is not longer than current blockchain. Do nothing');
    }
};
var generateNextBlock = (blockData) => {
    var previousBlock = getLatestBlock();
    var nextIndex = previousBlock.index + 1;
    var nextTimestamp = new Date().getTime() / 1000;
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp,
        blockData);
    return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash);
};
var calculateHashForBlock = (block) => {
    return calculateHash(block.index, block.previousHash, block.timestamp,
        block.data);
};
var calculateHash = (index, previousHash, timestamp, data) => {
    return CryptoJS.SHA256(index + previousHash + timestamp + data).toString();
};
var addBlock = (newBlock) => {
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }
};
var isValidNewBlock = (newBlock, previousBlock) => {
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('invalid index');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        console.log('invalid previoushash');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
};

var replaceChain = (newBlocks) => {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    } else { console.log('Received blockchain invalid'); }
};
var isValidChain = (blockchainToValidate) => {
    if (JSON.stringify(blockchainToValidate[0]) !==
        JSON.stringify(getGenesisBlock())) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
};

var getLatestBlock = () => blockchain[blockchain.length - 1];
var queryChainLengthMsg = () => ({ 'type': MessageType.QUERY_LATEST }); var queryAllMsg = () => ({ 'type': MessageType.QUERY_ALL });
var responseChainMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
var responseLatestMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify([getLatestBlock()])
});
var write = (ws, message) => ws.send(JSON.stringify(message));
var broadcast = (message) => sockets.forEach(socket => write(socket, message));
connectToPeers(initialPeers); initHttpServer(); initP2PServer();
