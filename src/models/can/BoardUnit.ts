export default class BoardUnit {
	public name: string;
	public attributes: object;
	public comment: string;

	constructor(name: string) {
		this.name = name;
		this.attributes = {};
		this.comment = ``;
	}
}
