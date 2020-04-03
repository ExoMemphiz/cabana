import Signal from "../src/models/can/signal";

export interface IMessages {
	entries: Array<IMessageEntry>;
}

export interface IMessageEntry {
	frame: {
		signals: Array<Signal>;
		address: number;
		data: Buffer;
		time: number;
		relTime: number;
		hexData: string;
		byteStateChangeTimes: number;
		updated: number;
	};
}
