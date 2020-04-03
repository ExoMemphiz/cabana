export function swapKeysAndValues(obj: object) {
	return Object.keys(obj).reduce((acc, k) => {
		// @ts-ignore
		acc[obj[k]] = k;
		return acc;
	});
}

export function fromArray(arr: Array<[string, number]>) {
	// arr is an array of array key-value pairs
	// like [['a', 1], ['b', 2]]
	const pairs = arr.map(([k, v]) => ({ [k]: v }));
	if (pairs.length > 0) {
		return Object.assign({}, ...pairs);
	}
	return {};
}
