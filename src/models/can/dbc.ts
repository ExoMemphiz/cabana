// @ts-ignore
import rightPad from "right-pad";
import { IMessageEntry } from "../../../types/types";
import CloudLog from "../../logging/CloudLog";
import DbcUtils from "../../utils/dbc";
import BoardUnit from "./BoardUnit";
import Frame from "./frame";
import * as LogSignals from "./logSignals";
import Signal from "./signal";

const { UINT64 } = require(`cuint`);

const DBC_COMMENT_RE = /^CM_ *"(.*)";/;
const DBC_COMMENT_MULTI_LINE_RE = /^CM_ *"(.*)/;

const MSG_RE = /^BO_ (\w+) (\w+) *: (\w+) (\w+)/;

const SIGNAL_RE = /^SG_ (\w+) : (\d+)\|(\d+)@(\d+)([+|-]) \(([0-9.+-eE]+),([0-9.+-eE]+)\) \[([0-9.+-eE]+)\|([0-9.+-eE]+)\] "(.*)" (.*)/;
// Multiplexed signal
const MP_SIGNAL_RE = /^SG_ (\w+) (\w+) *: (\d+)\|(\d+)@(\d+)([+|-]) \(([0-9.+-eE]+),([0-9.+-eE]+)\) \[([0-9.+-eE]+)\|([0-9.+-eE]+)\] "(.*)" (.*)/;

const VAL_RE = /^VAL_ (\w+) (\w+) (.*);/;
const VAL_TABLE_RE = /^VAL_TABLE_ (\w+) (.*);/;

const MSG_TRANSMITTER_RE = /^BO_TX_BU_ ([0-9]+) *: *(.+);/;

const SIGNAL_COMMENT_RE = /^CM_ SG_ *(\w+) *(\w+) *"(.*)";/;
const SIGNAL_COMMENT_MULTI_LINE_RE = /^CM_ SG_ *(\w+) *(\w+) *"(.*)/;

// Message Comments (CM_ BO_ )
const MESSAGE_COMMENT_RE = /^CM_ BO_ *(\w+) *"(.*)";/;
const MESSAGE_COMMENT_MULTI_LINE_RE = /^CM_ BO_ *(\w+) *"(.*)/;

const BOARD_UNIT_RE = /^BU_:(.*)/;
const BOARD_UNIT_COMMENT_RE = /^CM_ BU_ *(\w+) *"(.*)";/;
const BOARD_UNIT_COMMENT_MULTI_LINE_RE = /^CM_ BU_ *(\w+) *"(.*)/;

// Follow ups are used to parse multi-line comment definitions
const FOLLOW_UP_DBC_COMMENT = `FollowUpDbcComment`;
const FOLLOW_UP_SIGNAL_COMMENT = `FollowUpSignalComment`;
const FOLLOW_UP_MSG_COMMENT = `FollowUpMsgComment`;
const FOLLOW_UP_BOARD_UNIT_COMMENT = `FollowUpBoardUnitComment`;

function floatOrInt(numericStr: string) {
	// @ts-ignore
	if (Number.isInteger(numericStr)) {
		return parseInt(numericStr, 10);
	}
	return parseFloat(numericStr);
}

export function swapOrder(arr: Array<unknown>, wordSize: number, gSize: number) {
	const swappedWords = [];

	for (let i = 0; i < arr.length; i += wordSize) {
		const word = arr.slice(i, i + wordSize);
		for (let j = wordSize - gSize; j > -gSize; j -= gSize) {
			swappedWords.push(word.slice(j, j + gSize));
		}
	}

	return swappedWords.join(``);
}

export default class DBC {
	private boardUnits: Array<BoardUnit>;
	private readonly comments: Array<string>;
	private messages: Map<number, Frame>;
	private readonly dbcText?: string;
	private valueTables?: Map<unknown, unknown>;

	constructor(dbcString: string) {
		this.boardUnits = [];
		this.comments = [];
		this.messages = new Map();

		if (dbcString !== undefined) {
			this.dbcText = dbcString;
			this.importDbcString(dbcString);
		}
	}

	public getMessageFrame(address: IMessageEntry["frame"]["address"]): IMessageEntry["frame"] | Frame | undefined {
		if (LogSignals.isLogAddress(address)) {
			return LogSignals.frameForAddress(address);
		}
		return this.messages.get(address);
	}

	public nextNewFrameName() {
		const messageNames = [];

		for (const msg of this.messages.values()) {
			// @ts-ignore
			messageNames.push(msg.name);
		}

		let msgNum = 1;
		let msgName;
		do {
			msgName = `NEW_MSG_${msgNum}`;
			msgNum++;
		} while (messageNames.indexOf(msgName) !== -1);

		return msgName;
	}

	public updateBoardUnits() {
		const boardUnitNames = this.boardUnits.map((bu) => bu.name);

		// @ts-ignore
		const mappedSignals = Array.from(this.messages.entries()).map(([msgId, frame]) => Object.values(frame.signals));
		const concattedSignals = mappedSignals.reduce((arr, signals) => arr.concat(signals), []);
		const concattedReceivers = concattedSignals.map((signal: Signal) => signal.receiver);

		const missingBoardUnits = Array.from(this.messages.entries())
			// @ts-ignore
			.map(([msgId, frame]) => Object.values(frame.signals))
			.reduce((arr, signals) => arr.concat(signals), [])
			// @ts-ignore
			.map((signal) => signal.receiver)
			// @ts-ignore
			.reduce((arr, receivers) => arr.concat(receivers), [])
			// @ts-ignore
			.filter((recv, idx, array) => array.indexOf(recv) === idx)
			// @ts-ignore
			.filter((recv) => boardUnitNames.indexOf(recv) === -1)
			// @ts-ignore
			.map((recv) => new BoardUnit(recv));

		this.boardUnits = this.boardUnits.concat(missingBoardUnits);
	}

	public text() {
		this.updateBoardUnits();

		let txt = `VERSION ""\n\n\n`;
		txt += `NS_ :${this._newSymbols()}`;
		txt += `\n\nBS_:\n`;

		const boardUnitsText = this.boardUnits.map((bu) => bu.name).join(` `);
		txt += `\nBU_: ${boardUnitsText}\n\n\n`;

		const frames = [];
		for (const frame of this.messages.values()) {
			frames.push(frame);
		}
		txt += `${frames.map((f) => f.text()).join(`\n\n`)}\n\n`;

		// @ts-ignore
		const messageTxs = frames.map((f) => [f.id, f.transmitters.slice(1)]).filter(([addr, txs]) => txs.length > 0);
		// @ts-ignore
		txt += `${messageTxs.map(([addr, txs]) => `BO_TX_BU_ ${addr} : ${txs.join(`,`)};`).join(`\n`)}\n\n\n`;

		txt += this.boardUnits
			.filter((bu) => bu.comment !== null)
			.map((bu) => `CM_ BU_ ${bu.name} "${bu.comment}";`)
			.join(`\n`);

		txt += frames
			.filter((f) => f.comment !== null)
			// @ts-ignore
			.map((msg) => `CM_ BO_ ${msg.address} "${msg.comment}";`)
			.join(`\n`);

		const signalsByMsgId = frames
			// @ts-ignore
			.map((f) => Object.values(f.signals).map((sig) => [f.id, sig]))
			.reduce((s1, s2) => s1.concat(s2), []);

		txt += `${signalsByMsgId
			// @ts-ignore
			.filter(([msgAddr, sig]) => sig.comment !== null)
			// @ts-ignore
			.map(([msgAddr, sig]) => `CM_ SG_ ${msgAddr} ${sig.name} "${sig.comment}";`)
			.join(`\n`)}\n`;

		txt += `${signalsByMsgId
			// @ts-ignore
			.filter(([msgAddr, sig]) => sig.valueDescriptions.size > 0)
			// @ts-ignore
			.map(([msgAddr, sig]) => sig.valueDescriptionText(msgAddr))
			.join(`\n`)}\n`;

		txt += this.comments.map((comment) => `CM_ "${comment}";`).join(`\n`);

		return `${txt.trim()}\n`;
	}

	// @ts-ignore
	public getMessageName(msgId) {
		const msg = this.getMessageFrame(msgId);
		// @ts-ignore
		if (msg && msg.frame) {
			// @ts-ignore
			return msg.frame.name;
			// @ts-ignore
		} else if (msg && msg.name) {
			// @ts-ignore
			return msg.name;
		}
		return null;
	}

	// @ts-ignore
	public getSignals(msgId) {
		const msg = this.getMessageFrame(msgId);
		if (msg) {
			return msg.signals;
		}
		return {};
	}

	// @ts-ignore
	public createFrame(msgId) {
		const msg = new Frame({
			name: this.nextNewFrameName(),
			id: msgId,
			size: 8,
		});

		this.messages.set(msgId, msg);
		return msg;
	}

	// @ts-ignore
	public setSignals(msgId, signals) {
		const msg = this.getMessageFrame(msgId);
		if (msg) {
			const newMsg = Object.assign(Object.create(msg), msg);
			newMsg.signals = signals;
			this.messages.set(msgId, newMsg);
		} else {
			const message = this.createFrame(msgId);
			message.signals = signals;

			this.messages.set(msgId, message);
			this.updateBoardUnits();
		}
	}

	// @ts-ignore
	public addSignal(msgId, signal) {
		const msg = this.getMessageFrame(msgId);

		if (msg) {
			// @ts-ignore
			msg.signals[signal.name] = signal;
			this.updateBoardUnits();
		}
	}

	public importDbcString(dbcString: string) {
		const warnings = [];
		const messages = new Map();
		let boardUnits: Array<BoardUnit> = [];
		const valueTables = new Map();
		let id = 0;
		let followUp = null;

		const lines = dbcString.split(`\n`);
		for (let i = 0; i < lines.length; i++) {
			let line = lines[i].trim();

			if (line.length === 0) {
				continue;
			}

			if (followUp !== null) {
				// @ts-ignore
				const { type, data } = followUp;
				line = line.replace(/" *;/, ``);
				let followUpLine = `\n${line.substr(0, line.length)}`;
				if (line.indexOf(`"`) !== -1) {
					followUp = null;
					followUpLine = followUpLine.substr(0, followUpLine.length - 1);
				}
				if (type === FOLLOW_UP_SIGNAL_COMMENT) {
					const signal = data;
					signal.comment += followUpLine;
				} else if (type === FOLLOW_UP_MSG_COMMENT) {
					const msg = data;
					msg.comment += followUpLine;
				} else if (type === FOLLOW_UP_BOARD_UNIT_COMMENT) {
					const boardUnit = data;
					boardUnit.comment += followUpLine;
				} else if (type === FOLLOW_UP_DBC_COMMENT) {
					//          const comment = data;
					const partialComment = this.comments[this.comments.length - 1];
					this.comments[this.comments.length - 1] = partialComment + followUpLine;
				}
			}

			if (line.indexOf(`BO_ `) === 0) {
				const matches = line.match(MSG_RE);
				if (matches === null) {
					warnings.push(`failed to parse message definition on line ${i + 1} -- ${line}`);
					continue;
				}
				// tslint:disable-next-line: prefer-const
				let [idString, name, size, transmitter] = matches.slice(1);
				id = parseInt(idString, 0); // 0 radix parses hex or dec
				// @ts-ignore
				size = parseInt(size, 10);
				const frame = new Frame({
					name,
					id,
					// @ts-ignore
					size,
					transmitters: [transmitter],
				});
				messages.set(id, frame);
			} else if (line.indexOf(`SG_`) === 0) {
				let matches = line.match(SIGNAL_RE);

				if (matches === null) {
					matches = line.match(MP_SIGNAL_RE);
					if (matches === null) {
						warnings.push(`failed to parse signal definition on line ${i + 1} -- ${line}`);
						continue;
					}
					// for now, ignore multiplex which is matches[1]
					// tslint:disable-next-line: restrict-plus-operands
					// @ts-ignore
					matches = matches[1] + matches.slice(3);
				} else {
					matches = matches.slice(1);
				}

				let [
					// tslint:disable-next-line: prefer-const
					name,
					startBit,
					size,
					isLittleEndian,
					isSigned,
					factor,
					offset,
					min,
					max,
					// tslint:disable-next-line: prefer-const
					unit,
					// tslint:disable-next-line: prefer-const
					receiverStr,
				] = matches;
				// @ts-ignore
				startBit = parseInt(startBit, 10);
				// @ts-ignore
				size = parseInt(size, 10);
				// @ts-ignore
				isLittleEndian = parseInt(isLittleEndian, 10) === 1;
				// @ts-ignore
				isSigned = isSigned === `-`;
				// @ts-ignore
				factor = floatOrInt(factor);
				// @ts-ignore
				offset = floatOrInt(offset);
				// @ts-ignore
				min = floatOrInt(min);
				// @ts-ignore
				max = floatOrInt(max);
				const receiver = receiverStr.split(`,`).map((s) => s.trim());

				const signalProperties = {
					name,
					startBit,
					size,
					isLittleEndian,
					isSigned,
					factor,
					offset,
					unit,
					min,
					max,
					receiver,
				};
				// @ts-ignore
				const signal = new Signal(signalProperties);

				if (messages.get(id) !== undefined) {
					messages.get(id).signals[name] = signal;
				} else {
					CloudLog.warn(`importDbcString: could not add signal: ${name} due to missing message: ${id}`);
				}
			} else if (line.indexOf(`VAL_ `) === 0) {
				const matches = line.match(VAL_RE);

				if (matches !== null) {
					// tslint:disable-next-line: prefer-const
					let [messageId, signalName, vals] = matches.slice(1);
					// @ts-ignore
					vals = vals
						.split(`"`)
						.map((s) => s.trim())
						.filter((s) => s.length > 0);

					// @ts-ignore
					messageId = parseInt(messageId, 10);
					const msg = messages.get(messageId);
					const signal = msg.signals[signalName];
					if (signal === undefined) {
						warnings.push(`could not find signal for value description on line ${i + 1} -- ${line}`);
						continue;
					}
					for (let j = 0; j < vals.length; j += 2) {
						const value = vals[j].trim();
						const description = vals[j + 1].trim();
						signal.valueDescriptions.set(value, description);
					}
				} else {
					warnings.push(`failed to parse value description on line ${i + 1} -- ${line}`);
				}
			} else if (line.indexOf(`VAL_TABLE_ `) === 0) {
				const matches = line.match(VAL_TABLE_RE);

				if (matches !== null) {
					const table = new Map();
					// tslint:disable-next-line: prefer-const
					let [tableName, items] = matches.slice(1);
					// @ts-ignore
					items = items
						.split(`"`)
						.map((s) => s.trim())
						.filter((s) => s.length > 0);

					for (let j = 0; j < items.length; j += 2) {
						const key = items[j];
						const value = items[j + 1];
						table.set(key, value);
					}
					valueTables.set(tableName, table);
				} else {
					warnings.push(`failed to parse value table on line ${i + 1} -- ${line}`);
				}
			} else if (line.indexOf(`BO_TX_BU_ `) === 0) {
				const matches = line.match(MSG_TRANSMITTER_RE);

				if (matches !== null) {
					// tslint:disable-next-line: prefer-const
					let [messageId, transmitter] = matches.slice(1);
					// @ts-ignore
					messageId = parseInt(messageId, 10);

					const msg = messages.get(messageId);
					msg.transmitters.push(transmitter);
					messages.set(messageId, msg);
				} else {
					warnings.push(`failed to parse message transmitter definition on line ${i + 1} -- ${line}`);
				}
			} else if (line.indexOf(`CM_ SG_ `) === 0) {
				let matches = line.match(SIGNAL_COMMENT_RE);
				let hasFollowUp = false;
				if (matches === null) {
					matches = line.match(SIGNAL_COMMENT_MULTI_LINE_RE);
					hasFollowUp = true;
				}
				if (matches === null) {
					warnings.push(`failed to parse signal comment on line ${i + 1} -- ${line}`);
					continue;
				}

				// tslint:disable-next-line: prefer-const
				let [messageId, signalName, comment] = matches.slice(1);

				// @ts-ignore
				messageId = parseInt(messageId, 10);
				const msg = messages.get(messageId);
				if (msg === undefined) {
					warnings.push(`failed to parse signal comment on line ${i + 1} -- ${line}:
                                    message id ${messageId} does not exist prior to this line`);
					continue;
				}
				const signal = msg.signals[signalName];
				if (signal === undefined) {
					warnings.push(`failed to parse signal comment on line ${i + 1} -- ${line}`);
					continue;
				} else {
					signal.comment = comment;
					messages.set(messageId, msg);
				}

				if (hasFollowUp) {
					followUp = { type: FOLLOW_UP_SIGNAL_COMMENT, data: signal };
				}
			} else if (line.indexOf(`CM_ BO_ `) === 0) {
				let matches = line.match(MESSAGE_COMMENT_RE);
				let hasFollowUp = false;
				if (matches === null) {
					matches = line.match(MESSAGE_COMMENT_MULTI_LINE_RE);
					hasFollowUp = true;
					if (matches === null) {
						warnings.push(`failed to message comment on line ${i + 1} -- ${line}`);
						continue;
					}
				}

				// tslint:disable-next-line: prefer-const
				let [messageId, comment] = matches.slice(1);
				// @ts-ignore
				messageId = parseInt(messageId, 10);
				const msg = messages.get(messageId);
				if (msg) {
					msg.comment = comment;
				}

				if (hasFollowUp) {
					followUp = { type: FOLLOW_UP_MSG_COMMENT, data: msg };
				}
			} else if (line.indexOf(`BU_: `) === 0) {
				const matches = line.match(BOARD_UNIT_RE);

				if (matches !== null) {
					const [boardUnitNameStr] = matches.slice(1);
					const newBoardUnits = boardUnitNameStr
						.split(` `)
						.map((s) => s.trim())
						.filter((s) => s.length > 0)
						.map((name) => new BoardUnit(name));

					boardUnits = boardUnits.concat(newBoardUnits);
				} else {
					warnings.push(`failed to parse board unit definition on line ${i + 1} -- ${line}`);
					continue;
				}
			} else if (line.indexOf(`CM_ BU_ `) === 0) {
				let matches = line.match(BOARD_UNIT_COMMENT_RE);
				let hasFollowUp = false;
				if (matches === null) {
					matches = line.match(BOARD_UNIT_COMMENT_MULTI_LINE_RE);
					hasFollowUp = true;
					if (matches === null) {
						warnings.push(`failed to parse board unit comment on line ${i + 1} -- ${line}`);
						continue;
					}
				}

				const [boardUnitName, comment] = matches.slice(1);
				const boardUnit = boardUnits.find((bu) => bu.name === boardUnitName);
				if (boardUnit) {
					boardUnit.comment = comment;
				}

				if (hasFollowUp) {
					followUp = { type: FOLLOW_UP_BOARD_UNIT_COMMENT, data: boardUnit };
				}
			} else if (line.indexOf(`CM_ `) === 0) {
				let matches = line.match(DBC_COMMENT_RE);
				let hasFollowUp = false;
				if (matches === null) {
					matches = line.match(DBC_COMMENT_MULTI_LINE_RE);
					if (matches === null) {
						warnings.push(`failed to parse dbc comment on line ${i + 1} -- ${line}`);
						continue;
					} else {
						hasFollowUp = true;
					}
				}

				const [comment] = matches.slice(1);
				this.comments.push(comment);
				if (hasFollowUp) {
					followUp = { type: FOLLOW_UP_DBC_COMMENT, data: comment };
				}
			}
		}

		// Disabled b/c live mode frequently calls this function
		// and executes way too many network requests
		if (warnings.length > 0) {
			// warnings.forEach((warning) => CloudLog.warn('importDbcString: ' + warning));
			// warnings.forEach((warning) => console.log('importDbcString: ' + warning));
		}

		this.messages = messages;
		this.boardUnits = boardUnits;
		this.valueTables = valueTables;
	}

	// @ts-ignore
	public valueForInt64Signal = (signalSpec, hexData) => {
		const blen = hexData.length * 4;
		let value;
		let startBit;
		let dataBitPos;

		if (signalSpec.isLittleEndian) {
			value = UINT64(swapOrder(hexData, 16, 2), 16);
			startBit = signalSpec.startBit;
			dataBitPos = UINT64(startBit);
		} else {
			// big endian
			value = UINT64(hexData, 16);

			startBit = DbcUtils.bigEndianBitIndex(signalSpec.startBit);
			dataBitPos = UINT64(blen - (startBit + signalSpec.size));
		}
		if (dataBitPos < 0) {
			return null;
		}

		const rightHandAnd = UINT64(Math.pow(2, signalSpec.size) - 1);
		let ival = value.shiftr(dataBitPos).and(rightHandAnd).toNumber();

		if (signalSpec.isSigned && ival & Math.pow(2, signalSpec.size - 1)) {
			ival -= Math.pow(2, signalSpec.size);
		}
		ival = ival * signalSpec.factor + signalSpec.offset;
		return ival;
	};

	// @ts-ignore
	public valueForInt32Signal = (signalSpec, buf) => {
		let startBit;
		if (signalSpec.isLittleEndian) {
			startBit = 64 - signalSpec.startBit - signalSpec.size;
		} else {
			let bitPos = (-signalSpec.startBit - 1) % 8;
			if (bitPos < 0) {
				bitPos += 8; // mimic python modulo behavior
			}

			startBit = Math.floor(signalSpec.startBit / 8) * 8 + bitPos;
		}

		let shiftAmount;
		let signalValue;
		const byteOffset = Math.min(4, Math.floor(signalSpec.startBit / 8));
		if (signalSpec.isLittleEndian) {
			signalValue = buf.readUInt32LE(byteOffset);
			shiftAmount = signalSpec.startBit - byteOffset * 8;
		} else {
			signalValue = buf.readUInt32BE(byteOffset);
			shiftAmount = 32 - (startBit - byteOffset * 8 + signalSpec.size);
		}

		signalValue = (signalValue >>> shiftAmount) & ((1 << signalSpec.size) - 1);
		if (signalSpec.isSigned && signalValue >>> (signalSpec.size - 1)) {
			signalValue -= 1 << signalSpec.size;
		}

		return signalValue * signalSpec.factor + signalSpec.offset;
	};

	public getSignalValues(messageId: number, data: Buffer) {
		if (!this.messages.has(messageId) && !LogSignals.isLogAddress(messageId)) {
			return {};
		}
		const frame = this.getMessageFrame(messageId);

		let buffer;
		if (data) {
			buffer = Buffer.from(data);
		} else {
			buffer = `00000000`;
		}
		let paddedBuffer = buffer;
		if (buffer.length !== 8) {
			// pad data it's 64 bits long
			const paddedDataHex = rightPad(buffer.toString(`hex`), 16, `0`);
			paddedBuffer = Buffer.from(paddedDataHex, `hex`);
		}
		const hexData = paddedBuffer.toString(`hex`);

		const signalValuesByName = {};
		// @ts-ignore
		Object.values(frame.signals).forEach((signalSpec) => {
			const value =
				signalSpec.size > 32
					? this.valueForInt64Signal(signalSpec, hexData)
					: this.valueForInt32Signal(signalSpec, paddedBuffer);
			// @ts-ignore
			signalValuesByName[signalSpec.name] = value;
		});

		return signalValuesByName;
	}

	public getChffrMetricMappings() {
		const metricComment = this.comments.find((comment) => comment.indexOf(`CHFFR_METRIC`) === 0);
		if (!metricComment) {
			return null;
		}

		return metricComment
			.split(`;`)
			.map((metric) => metric.trim().split(` `))
			.reduce((metrics, [_, messageId, signalName, metricName, factor, offset]) => {
				// @ts-ignore
				metrics[metricName] = {
					messageId: parseInt(messageId, 10),
					signalName,
					factor: parseFloat(factor),
					offset: parseFloat(offset),
				};
				return metrics;
			});
	}

	public _newSymbols = () => {
		return `
    NS_DESC_
    CM_
    BA_DEF_
    BA_
    VAL_
    CAT_DEF_
    CAT_
    FILTER
    BA_DEF_DEF_
    EV_DATA_
    ENVVAR_DATA_
    SGTYPE_
    SGTYPE_VAL_
    BA_DEF_SGTYPE_
    BA_SGTYPE_
    SIG_TYPE_REF_
    VAL_TABLE_
    SIG_GROUP_
    SIG_VALTYPE_
    SIGTYPE_VALTYPE_
    BO_TX_BU_
    BA_DEF_REL_
    BA_REL_
    BA_DEF_DEF_REL_
    BU_SG_REL_
    BU_EV_REL_
    BU_BO_REL_
    SG_MUL_VAL_`;
	};
}
