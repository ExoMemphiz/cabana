import classNames from "classnames";
import ClipboardJS from "clipboard";
import moment from "moment";
import React, { ChangeEvent, Component, ReactNode } from "react";

import { IMessages } from "../../types/types";
import MessageBytes from "./MessageBytes";

import { ckmeans } from "simple-statistics";

interface IProps {
	dongleId: string;
	name: string;
	partsCount: number;
	dbcFilename: string;
	dbcLastSaved: moment.Moment;
	route: object;
	partsLoaded: number;
	currentParts: Array<unknown>;
	seekTime: number;
	loginWithGithub: ReactNode;
	isDemo: boolean;
	live: boolean;
	seekIndex: number;

	lastSaved: unknown;

	messages: IMessages;
	selectedMessage: Array<unknown>;
	selectedMessages: Array<string>;

	onMessageSelected(key: unknown): void;
	onMessageUnselected(key: unknown): void;
	onPartChanged(): void;

	showLoadDbc(): void;
	showSaveDbc(): void;
	showEditMessageModal(): void;

	saveLog(): void;
	shareUrl(): void;

	updateSelectedMessages(arr: Array<unknown>): void;
}

interface IState {
	filterText: string;
	lastSaved: string;
	hoveredMessages: Array<unknown>;
	orderedMessageKeys: Array<string>;
	showLogEvents: boolean;
	selectedMessages: Array<string>;
}

export default class Meta extends Component<IProps, IState> {
	private lastSavedTimer?: NodeJS.Timeout;

	constructor(props: IProps) {
		super(props);

		this.onFilterChanged = this.onFilterChanged.bind(this);
		this.onFilterFocus = this.onFilterFocus.bind(this);
		this.onFilterUnfocus = this.onFilterUnfocus.bind(this);
		this.canMsgFilter = this.canMsgFilter.bind(this);
		this.logEventMsgFilter = this.logEventMsgFilter.bind(this);
		this.renderMessageBytes = this.renderMessageBytes.bind(this);
		this.toggleShowLogEvents = this.toggleShowLogEvents.bind(this);

		const { dbcLastSaved } = props;

		this.state = {
			filterText: `Filter`,
			lastSaved: dbcLastSaved !== null ? this.props.dbcLastSaved.fromNow() : ``,
			hoveredMessages: [],
			orderedMessageKeys: [],
			selectedMessages: [],
			showLogEvents: false,
		};
	}

	public componentDidMount() {
		this.lastSavedTimer = setInterval(() => {
			if (this.props.dbcLastSaved !== null) {
				this.setState({ lastSaved: this.props.dbcLastSaved.fromNow() });
			}
		}, 30000);
	}

	public componentWillUnmount() {
		if (this.lastSavedTimer) {
			window.clearInterval(this.lastSavedTimer);
		}
	}

	public componentWillReceiveProps(nextProps: IProps) {
		if (nextProps.lastSaved !== this.props.lastSaved && typeof nextProps === `object`) {
			this.setState({ lastSaved: nextProps.dbcLastSaved.fromNow() });
		}

		const nextMsgKeys = Object.keys(nextProps.messages);
		if (JSON.stringify(nextMsgKeys) !== JSON.stringify(Object.keys(this.props.messages))) {
			const orderedMessageKeys = this.sortMessages(nextProps.messages);
			this.setState({ hoveredMessages: [], orderedMessageKeys });
		} else if (
			this.state.orderedMessageKeys.length === 0 ||
			(!this.props.live &&
				this.props.messages &&
				nextProps.messages &&
				this.byteCountsDidUpdate(this.props.messages, nextProps.messages))
		) {
			const orderedMessageKeys = this.sortMessages(nextProps.messages);
			this.setState({ orderedMessageKeys });
		}
	}

	public byteCountsDidUpdate = (prevMessages: IMessages, nextMessages: IMessages) => {
		return Object.entries(nextMessages).some(
			([msgId, msg]) =>
				// @ts-ignore
				JSON.stringify(msg.byteStateChangeCounts) !== JSON.stringify(prevMessages[msgId].byteStateChangeCounts),
		);
	};

	public sortMessages = (messages: IMessages) => {
		// Returns list of message keys, ordered as follows:
		// messages are binned into at most 10 bins based on entry count
		// each bin is sorted by message CAN address
		// then the list of bins is flattened and reversed to
		// yield a count-descending, address-ascending order.

		if (Object.keys(messages).length === 0) {
			return [];
		}

		const messagesByEntryCount = Object.entries(messages).reduce((partialMapping, [msgID, msg]) => {
			const entryCountKey = msg.entries.length.toString(); // js object keys are strings
			if (!partialMapping[entryCountKey]) {
				partialMapping[entryCountKey] = [msg];
			} else if (partialMapping[entryCountKey] && partialMapping[entryCountKey].push) {
				partialMapping[entryCountKey].push(msg);
			}
			return partialMapping;
		});

		const entryCounts = Object.keys(messagesByEntryCount).map((count) => parseInt(count, 10));
		const binnedEntryCounts = ckmeans(entryCounts, Math.min(entryCounts.length, 10));
		const sortedKeys = binnedEntryCounts
			.map((bin) =>
				bin
					// @ts-ignore
					.map((entryCount) => messagesByEntryCount[entryCount.toString()])
					// @ts-ignore
					.reduce((m, partial) => m.concat(partial), [])
					// @ts-ignore
					.sort((msg1, msg2) => {
						if (msg1.address < msg2.address) {
							return 1;
						}
						return -1;
					})
					// @ts-ignore
					.map((msg) => msg.id),
			)
			// @ts-ignore
			.reduce((keys, bin) => keys.concat(bin), [])
			.reverse();

		return sortedKeys;
	};

	public toggleShowLogEvents() {
		this.setState({
			showLogEvents: !this.state.showLogEvents,
		});
	}

	public onFilterChanged(e: ChangeEvent<HTMLInputElement>) {
		let val = e.target.value;
		if (val.trim() === `Filter`) {
			val = ``;
		}

		this.setState({ filterText: val });
	}

	public onFilterFocus() {
		if (this.state.filterText.trim() === `Filter`) {
			this.setState({ filterText: `` });
		}
	}

	public onFilterUnfocus() {
		if (this.state.filterText.trim() === ``) {
			this.setState({ filterText: `Filter` });
		}
	}

	public canMsgFilter(msg: unknown) {
		console.log(`[Meta::canMsgFilter] msg: `, JSON.stringify(msg));
		// @ts-ignore
		if (msg.isLogEvent) {
			return false;
		}
		const { filterText } = this.state;
		// @ts-ignore
		const msgName = msg.frame ? msg.frame.name : ``;

		return (
			filterText === `Filter` ||
			filterText === `` ||
			// @ts-ignore
			msg.id.toLowerCase().indexOf(filterText.toLowerCase()) !== -1 ||
			msgName.toLowerCase().indexOf(filterText.toLowerCase()) !== -1
		);
	}

	public logEventMsgFilter(msg: unknown) {
		// @ts-ignore
		if (!msg.isLogEvent) {
			return false;
		}
		const { filterText } = this.state;
		// @ts-ignore
		const msgName = msg.frame ? msg.frame.name : ``;

		return (
			filterText === `Filter` ||
			filterText === `` ||
			// @ts-ignore
			msg.id.toLowerCase().indexOf(filterText.toLowerCase()) !== -1 ||
			msgName.toLowerCase().indexOf(filterText.toLowerCase()) !== -1
		);
	}

	public lastSavedPretty() {
		const { dbcLastSaved } = this.props;
		return dbcLastSaved.fromNow();
	}

	public onMessageHover(key: string) {
		const { hoveredMessages } = this.state;
		if (hoveredMessages.indexOf(key) !== -1) {
			return;
		}

		hoveredMessages.push(key);
		this.setState({ hoveredMessages });
	}

	public onMessageHoverEnd(key: string) {
		let { hoveredMessages } = this.state;
		hoveredMessages = hoveredMessages.filter((m) => m !== key);
		this.setState({ hoveredMessages });
	}

	public onMsgRemoveClick(key: unknown) {
		let { selectedMessages } = this.state;
		selectedMessages = selectedMessages.filter((m) => m !== key);
		this.props.onMessageUnselected(key);
		this.setState({ selectedMessages });
	}

	public onMessageSelected(key: unknown) {
		// uncomment when we support multiple messages
		// const selectedMessages = this.state.selectedMessages.filter((m) => m !== key);
		const selectedMessages = [];
		selectedMessages.push(key);
		this.props.updateSelectedMessages(selectedMessages);
		this.props.onMessageSelected(key);
	}

	public orderedMessages() {
		const { orderedMessageKeys } = this.state;
		const { messages } = this.props;
		// @ts-ignore
		return orderedMessageKeys.map((key) => messages[key]);
	}

	public selectedMessageClass(messageId: string) {
		return this.props.selectedMessages.includes(messageId) ? `is-selected` : null;
	}

	// @ts-ignore
	public renderMessageBytes(msg) {
		return (
			<tr
				onClick={() => {
					this.onMessageSelected(msg.id);
				}}
				key={msg.id}
				className={classNames(`cabana-meta-messages-list-item`, this.selectedMessageClass(msg.id))}
			>
				{msg.isLogEvent ? (
					<td colSpan={2}>{msg.id}</td>
				) : (
					<>
						<td>{msg.frame ? msg.frame.name : `untitled`}</td>
						<td>{msg.id}</td>
					</>
				)}
				<td>{msg.entries.length}</td>
				<td>
					<div className="cabana-meta-messages-list-item-bytes">
						<MessageBytes
							key={msg.id}
							message={msg}
							seekIndex={this.props.seekIndex}
							seekTime={this.props.seekTime}
							live={this.props.live}
						/>
					</div>
				</td>
			</tr>
		);
	}

	public renderCanMessages() {
		return this.orderedMessages().filter(this.canMsgFilter).map(this.renderMessageBytes);
	}

	public renderLogEventMessages() {
		return this.orderedMessages().filter(this.logEventMsgFilter).map(this.renderMessageBytes);
	}

	public renderAvailableMessagesList() {
		if (Object.keys(this.props.messages).length === 0) {
			return <p>Loading messages...</p>;
		}
		return (
			<>
				<table cellPadding="5">
					{this.state.showLogEvents && (
						<>
							<thead>
								<tr>
									<td colSpan={2}>Name</td>
									<td>Count</td>
									<td>Bytes</td>
								</tr>
							</thead>
							<tbody>
								{this.renderLogEventMessages()}
								<tr>
									<td colSpan={4}>
										<hr />
									</td>
								</tr>
							</tbody>
						</>
					)}
					<thead>
						<tr>
							<td>Name</td>
							<td>ID</td>
							<td>Count</td>
							<td>Bytes</td>
						</tr>
					</thead>
					<tbody>{this.renderCanMessages()}</tbody>
				</table>
			</>
		);
	}

	public saveable = () => {
		try {
			if (`serviceWorker` in navigator && !!new ReadableStream() && !!new WritableStream()) {
				return `saveable`;
			}
		} catch (e) {
			return false;
		}
	};

	public render() {
		return (
			<div className="cabana-meta">
				<div className="cabana-meta-header">
					<h5 className="cabana-meta-header-label t-capline">Currently editing:</h5>
					<strong className="cabana-meta-header-filename">{this.props.dbcFilename}</strong>
					{this.props.dbcLastSaved !== null ? (
						<div className="cabana-meta-header-last-saved">
							<p>
								Last saved:
								{this.lastSavedPretty()}
							</p>
						</div>
					) : null}
					<div className={`cabana-meta-header-actions ${this.saveable()}`}>
						<div className="cabana-meta-header-action">
							<button onClick={this.props.showLoadDbc}>Load DBC</button>
						</div>
						{this.saveable() && (
							<div className="cabana-meta-header-action">
								<button onClick={this.props.saveLog}>Save Log</button>
							</div>
						)}
						{this.props.shareUrl ? (
							<div
								className="cabana-meta-header-action special-wide"
								data-clipboard-text={this.props.shareUrl}
								data-clipboard-action="copy"
								ref={(ref) => (ref ? new ClipboardJS(ref) : null)}
							>
								<a
									className="button"
									onClick={(e) => {
										e.preventDefault();
										this.props.shareUrl();
									}}
								>
									Copy Share Link
								</a>
							</div>
						) : null}
						<div className="cabana-meta-header-action">
							<button onClick={this.props.showSaveDbc}>Save DBC</button>
						</div>
					</div>
				</div>
				<div className="cabana-meta-messages">
					<div className="cabana-meta-messages-header">
						<div
							style={{
								display: `inline-block`,
								float: `right`,
							}}
						>
							<h5 className="t-capline">
								Show log events
								<input
									type="checkbox"
									onChange={this.toggleShowLogEvents}
									checked={!!this.state.showLogEvents}
								/>
							</h5>
						</div>
						<h5 className="t-capline">Available messages</h5>
					</div>
					<div className="cabana-meta-messages-window">
						<div className="cabana-meta-messages-filter">
							<div className="form-field form-field--small">
								<input
									type="text"
									value={this.state.filterText}
									onFocus={this.onFilterFocus}
									onBlur={this.onFilterUnfocus}
									onChange={this.onFilterChanged}
								/>
							</div>
						</div>
						<div className="cabana-meta-messages-list">{this.renderAvailableMessagesList()}</div>
					</div>
				</div>
			</div>
		);
	}
}
