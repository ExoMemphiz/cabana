import randomColor from "randomcolor";
import DbcUtils from "../../utils/dbc";

interface ISignalConstructor {
	name?: string;
	startBit?: number;
	size?: number;
	isLittleEndian?: boolean;
	isSigned?: boolean;
	isFloat?: boolean;
	factor?: number;
	offset?: number;
	unit?: string;
	receiver?: Array<string>;
	comment?: string;
	multiplex?: string;
	min?: unknown;
	max?: unknown;
	valueDescriptions?: Map<unknown, unknown>;
}

export default class Signal {
	public name?: string;
	public startBit: number;
	public size: number;
	public isLittleEndian: boolean;
	public isSigned: boolean;
	public isFloat: boolean;
	public factor: number;
	public offset: number;
	public unit: string;
	public receiver: Array<string>;
	public comment: string;
	public multiplex: string;
	public min: unknown;
	public max: unknown;
	public valueDescriptions: Map<unknown, unknown>;
	public uid: string;
	public _colors: string;

	constructor({
		name,
		startBit = 0,
		size = 0,
		isLittleEndian = true,
		isSigned = false,
		isFloat = false,
		factor = 1,
		offset = 0,
		unit = ``,
		receiver = [`XXX`],
		comment = ``,
		multiplex = ``,
		min = null,
		max = null,
		valueDescriptions = new Map(),
	}: ISignalConstructor) {
		this.name = name;
		this.startBit = startBit;
		this.size = size;
		this.isLittleEndian = isLittleEndian;
		this.isSigned = isSigned;
		this.isFloat = isFloat;
		this.factor = factor;
		this.offset = offset;
		this.unit = unit;
		this.receiver = receiver;
		this.comment = comment;
		this.multiplex = multiplex;
		this.min = min;
		this.max = max;
		this.valueDescriptions = valueDescriptions;

		this.uid = Math.random().toString(36);

		if (min === null) {
			this.min = this.calculateMin();
		}
		if (max === null) {
			this.max = this.calculateMax();
		}

		this._colors = this.generateColors();
	}

	public text() {
		const multiplex = this.multiplex ? ` ${this.multiplex}` : ``;
		const byteOrder = this.isLittleEndian ? 1 : 0;
		const signedChar = this.isSigned ? `-` : `+`;

		return (
			`SG_ ${this.name}${multiplex} : ` +
			`${this.startBit}|${this.size}@${byteOrder}${signedChar}` +
			` (${this.factor},${this.offset})` +
			` [${this.min}|${this.max}]` +
			` "${this.unit}" ${this.receiver}`
		);
	}

	public valueDescriptionText(msgId: string) {
		const entryPairs = Array.from(this.valueDescriptions.entries());
		const values = entryPairs.reduce((str, [value, desc]) => `${str + value} "${desc}" `, ``);
		return `VAL_ ${msgId} ${this.name} ${values};`;
	}

	public lsbBitIndex() {
		// Returns LSB bit index in matrix order (see AddSignals.js)

		if (this.isLittleEndian) {
			return this.startBit;
		}
		const lsbBitNumber = this.lsbBitNumber();

		return DbcUtils.matrixBitNumber(lsbBitNumber);
	}

	public lsbBitNumber() {
		// Returns LSB bit number in big endian ordering

		return DbcUtils.bigEndianBitIndex(this.startBit) + this.size - 1;
	}

	public msbBitIndex() {
		if (this.isLittleEndian) {
			return this.startBit + this.size - 1;
		}
		return this.startBit;
	}

	public littleEndianBitDescription(bitIndex: number) {
		const bitRange = [this.startBit, this.startBit + this.size - 1];
		if (bitIndex < bitRange[0] || bitIndex > bitRange[1]) {
			return null;
		}
		const bitNumber = bitIndex - bitRange[0];
		const isLsb = bitIndex === bitRange[0];
		const isMsb = bitIndex === bitRange[1];
		return { bitNumber, isLsb, isMsb };
	}

	public bigEndianBitDescription(bitIndex: number) {
		const start = DbcUtils.bigEndianBitIndex(this.startBit);
		const range = [start, start + this.size - 1];
		const bitNumber = DbcUtils.bigEndianBitIndex(bitIndex);

		if (bitNumber < range[0] || bitNumber > range[1]) {
			return null;
		}

		const isLsb = bitNumber === range[1];
		const isMsb = bitIndex === this.startBit;
		return {
			bitNumber,
			isLsb,
			isMsb,
			range,
		};
	}

	public bitDescription(bitIndex: number) {
		if (this.isLittleEndian) {
			return this.littleEndianBitDescription(bitIndex);
		}
		return this.bigEndianBitDescription(bitIndex);
	}

	public calculateRawRange() {
		let rawRange = Math.pow(2, this.size);
		if (this.isSigned) {
			rawRange /= 2;
		}
		return [this.isSigned ? rawRange * -1 : 0, rawRange - 1];
	}

	public calculateMin() {
		const rawMin = this.calculateRawRange()[0];
		return this.offset + rawMin * this.factor;
	}

	public calculateMax() {
		const rawMax = this.calculateRawRange()[1];
		return this.offset + rawMax * this.factor;
	}

	// @ts-ignore
	public getColors(messageId) {
		// @ts-ignore
		let parts = messageId.split(`:`).map((p) => ((Number.parseInt(p, 16) + 3) * 3) % 253);
		const colors = this._colors || this.generateColors();

		let lastColor = 0;

		// @ts-ignore
		return colors.map((c) => {
			// @ts-ignore
			parts = parts.map((p) => p ^ lastColor);
			// @ts-ignore
			lastColor = parts.reduce((m, v) => m ^ v, c);
			return lastColor;
		});
	}

	public generateColors = () => {
		const colors = randomColor({ format: `rgbArray` });
		return colors;
	};

	public equals(otherSignal: Signal) {
		return (
			otherSignal.name === this.name &&
			otherSignal.startBit === this.startBit &&
			otherSignal.size === this.size &&
			otherSignal.isLittleEndian === this.isLittleEndian &&
			otherSignal.isSigned === this.isSigned &&
			otherSignal.isFloat === this.isFloat &&
			otherSignal.factor === this.factor &&
			otherSignal.offset === this.offset &&
			otherSignal.unit === this.unit &&
			otherSignal.receiver.length === this.receiver.length &&
			otherSignal.receiver.every((v, i) => v === this.receiver[i]) &&
			otherSignal.comment === this.comment &&
			otherSignal.multiplex === this.multiplex
		);
	}
}
