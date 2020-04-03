import { SignalMapProperties } from "./logSignals";

interface IFrameConstructor {
	name?: string | null;
	id?: string | number | null;
	size?: number;
	transmitters?: Array<unknown>;
	extended?: number;
	comment?: string;
	signals?: { [key in SignalMapProperties]: object };
}

export default class Frame {
	public name: IFrameConstructor["name"];
	public id: IFrameConstructor["id"];
	public size: IFrameConstructor["size"];
	public transmitters: IFrameConstructor["transmitters"];
	public extended: IFrameConstructor["extended"];
	public comment: IFrameConstructor["comment"];
	public signals?: IFrameConstructor["signals"];

	constructor({
		name,
		id = 0,
		size = 0,
		transmitters = [],
		extended = 0,
		comment = ``,
		// @ts-ignore
		signals = {},
	}: IFrameConstructor) {
		this.name = name;
		this.id = id;
		this.size = size;
		this.transmitters = transmitters;
		this.extended = extended;
		this.comment = comment;
		this.signals = signals;
	}

	public nextNewTransmitterName() {
		let txNum = 1;
		let txName;
		do {
			txName = `NEW_TRANSMITTER_${txNum}`;
			txNum++;
			// @ts-ignore
		} while (this.transmitters.indexOf(txName) !== -1);

		return txName;
	}

	public addTransmitter() {
		const txName = this.nextNewTransmitterName();
		// @ts-ignore
		this.transmitters.push(txName);
		return txName;
	}

	public header() {
		// @ts-ignore
		return `BO_ ${this.id} ${this.name}: ${this.size} ` + `${this.transmitters[0] || `XXX`}`;
	}

	public text() {
		// @ts-ignore
		const signals = Object.values(this.signals)
			// @ts-ignore
			.map((signal) => ` ${signal.text()}`) // indent
			.join(`\n`);

		if (signals.length > 0) {
			return `${this.header()}\n${signals}`;
		}
		return this.header();
	}

	public copy() {
		const copy = Object.assign(Object.create(this), this);

		return copy;
	}
}
