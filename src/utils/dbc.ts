import { IMessageEntry, IMessages } from "../../types/types";
import DBC from "../models/can/dbc";

function findMaxByteStateChangeCount(messages: IMessages) {
	return (
		Object.values(messages)
			.map((m) => m.byteStateChangeCounts)
			.reduce((counts, countArr) => counts.concat(countArr), []) // flatten arrays
			// @ts-ignore
			.reduce((count1, count2) => (count1 > count2 ? count1 : count2), 0)
	); // find max
}

// @ts-ignore
function addCanMessage(canMessage, dbc, canStartTime, messages, prevMsgEntries, byteStateChangeCountsByMessage) {
	const { address, busTime, data, bus } = canMessage;
	const id = `${bus}:${address.toString(16)}`;

	if (messages[id] === undefined) {
		messages[id] = createMessageSpec(dbc, address, id, bus);
	}

	const prevMsgEntry =
		messages[id].entries.length > 0
			? messages[id].entries[messages[id].entries.length - 1]
			: prevMsgEntries[id] || null;

	// @ts-ignore
	if (byteStateChangeCountsByMessage[id] && messages[id].byteStateChangeCounts.every((c) => c === 0)) {
		messages[id].byteStateChangeCounts = byteStateChangeCountsByMessage[id];
	}

	const { msgEntry, byteStateChangeCounts } = parseMessage(dbc, busTime, address, data, canStartTime, prevMsgEntry);

	messages[id].byteStateChangeCounts = byteStateChangeCounts.map(
		(count, idx) => messages[id].byteStateChangeCounts[idx] + count,
	);

	messages[id].entries.push(msgEntry);

	return msgEntry;
}

function createMessageSpec(dbc: DBC, address: number, id: string, bus: number) {
	const frame = dbc.getMessageFrame(address);
	// @ts-ignore
	const size = frame ? frame.size : 8;

	return {
		address,
		id,
		bus,
		entries: [],
		frame,
		byteColors: Array(size).fill(0),
		byteStateChangeCounts: Array(size).fill(0),
	};
}

// @ts-ignore
function determineByteStateChangeTimes(hexData, time, msgSize, lastParsedMessage) {
	const byteStateChangeCounts = Array(msgSize).fill(0);
	let byteStateChangeTimes;

	if (!lastParsedMessage) {
		byteStateChangeTimes = Array(msgSize).fill(time);
	} else {
		// debugger;
		byteStateChangeTimes = lastParsedMessage.byteStateChangeTimes;

		for (let i = 0; i < byteStateChangeTimes.length; i++) {
			const currentData = hexData.substr(i * 2, 2);
			const prevData = lastParsedMessage.hexData.substr(i * 2, 2);

			if (currentData !== prevData) {
				byteStateChangeTimes[i] = time;
				byteStateChangeCounts[i] = 1;
			}
		}
	}

	return { byteStateChangeTimes, byteStateChangeCounts };
}

function createMessageEntry(
	dbc: DBC,
	address: IMessageEntry["frame"]["address"],
	time: IMessageEntry["frame"]["time"],
	relTime: IMessageEntry["frame"]["relTime"],
	data: IMessageEntry["frame"]["data"],
	byteStateChangeTimes: IMessageEntry["frame"]["byteStateChangeTimes"],
) {
	return {
		signals: dbc.getSignalValues(address, data),
		address,
		data,
		time,
		relTime,
		hexData: Buffer.from(data).toString(`hex`),
		byteStateChangeTimes,
		updated: Date.now(),
	};
}

function reparseMessage(dbc: DBC, msg: IMessageEntry["frame"], lastParsedMessage: IMessageEntry) {
	const msgSpec = dbc.getMessageFrame(msg.address);
	// @ts-ignore
	const msgSize = msgSpec ? msgSpec.size : 8;

	const { byteStateChangeTimes, byteStateChangeCounts } = determineByteStateChangeTimes(
		msg.hexData,
		msg.relTime,
		msgSize,
		lastParsedMessage,
	);

	const msgEntry = {
		...msg,
		// @ts-ignore
		signals: dbc.getSignalValues(msg.address, msg.data),
		byteStateChangeTimes,
		updated: Date.now(),
	};

	return { msgEntry, byteStateChangeCounts };
}

function parseMessage(
	dbc: DBC,
	time: IMessageEntry["frame"]["time"],
	address: IMessageEntry["frame"]["address"],
	data: IMessageEntry["frame"]["data"],
	timeStart: IMessageEntry["frame"]["time"],
	lastParsedMessage: IMessageEntry,
) {
	let hexData;
	let unhexedData;
	if (typeof data === `string`) {
		hexData = data;
		unhexedData = Buffer.from(data, `hex`);
	} else {
		hexData = Buffer.from(data).toString(`hex`);
	}
	const msgSpec = dbc.getMessageFrame(address);
	// @ts-ignore
	const msgSize = msgSpec ? msgSpec.size : 8;
	const relTime = time - timeStart;

	const { byteStateChangeTimes, byteStateChangeCounts } = determineByteStateChangeTimes(
		hexData,
		relTime,
		msgSize,
		lastParsedMessage,
	);
	// @ts-ignore
	const msgEntry = createMessageEntry(dbc, address, time, relTime, unhexedData, byteStateChangeTimes);

	return { msgEntry, byteStateChangeCounts };
}

const BIG_ENDIAN_START_BITS: Array<number> = [];

for (let i = 0; i < 64; i += 8) {
	for (let j = 7; j > -1; j--) {
		BIG_ENDIAN_START_BITS.push(i + j);
	}
}

function bigEndianBitIndex(matrixBitIndex: number) {
	return BIG_ENDIAN_START_BITS.indexOf(matrixBitIndex);
}

function matrixBitNumber(bigEndianIndex: number) {
	return BIG_ENDIAN_START_BITS[bigEndianIndex];
}

// @ts-ignore
function setMessageByteColors(message, maxByteStateChangeCount) {
	message.byteColors = message.byteStateChangeCounts
		// @ts-ignore
		.map((count) => (isNaN(count) ? 0 : Math.min(255, (count / maxByteStateChangeCount) * 180) + 75))
		// @ts-ignore
		.map((red) => `rgb(${Math.round(red)},0,0)`);

	return message;
}

export default {
	bigEndianBitIndex,
	addCanMessage,
	createMessageSpec,
	matrixBitNumber,
	parseMessage,
	reparseMessage,
	findMaxByteStateChangeCount,
	setMessageByteColors,
	createMessageEntry,
};
