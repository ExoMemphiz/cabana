export interface IMessages {
	entries: Array<IMessageEntry>;
}

export interface IMessageEntry {
	frame: {
		signals: Array<unknown>;
		address: unknown;
		data: unknown;
		time: unknown;
		relTime: unknown;
		hexData: string;
		byteStateChangeTimes: unknown;
		updated: number;
	};
}
