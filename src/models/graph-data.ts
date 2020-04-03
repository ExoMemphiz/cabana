import { IMessageEntry } from "../../types/types";
import { CAN_GRAPH_MAX_POINTS } from "../config";
import ArrayUtils from "../utils/array";
import Signal from "./can/signal";

function signalColors(signal: Signal, msg: IMessageEntry) {
	// @ts-ignore
	return signal.colors.map((v) => v ^ msg.address ^ msg.bus);
}

function _calcGraphData(msg: IMessageEntry, signalUid: unknown, firstCanTime: unknown) {
	console.log(`[graph-data::_calcGraphData] Msg: `, JSON.stringify(msg));
	debugger;

	if (!msg) {
		return null;
	}

	// @ts-ignore
	const signal = Object.values(msg.frame.signals).find((s) => s.uid === signalUid);
	if (!signal) {
		console.warn(`_calcGraphData: no signal`, signalUid, msg);
		return null;
	}
	let samples = [];
	// @ts-ignore
	const skip = Math.floor(msg.entries.length / CAN_GRAPH_MAX_POINTS);

	if (skip === 0) {
		// @ts-ignore
		samples = msg.entries;
	} else {
		// @ts-ignore
		for (let i = 0; i < msg.entries.length; i += skip) {
			// @ts-ignore
			samples.push(msg.entries[i]);
		}
		// Always include last message entry, which faciliates graphData comparison
		// @ts-ignore
		samples.push(msg.entries[msg.entries.length - 1]);
	}
	if (!samples.length) {
		return [];
	}

	// @ts-ignore
	const colors = signal.getColors(msg.id);
	// @ts-ignore
	signalUid = msg.id + signalUid;
	// sorting these doesn't fix the phantom lines
	let lastEntry = samples[0].relTime;
	return (
		samples
			// @ts-ignore
			.filter((e) => e.signals[signal.name] !== undefined)
			// @ts-ignore
			.map((entry) => {
				if (entry.relTime < lastEntry) {
					console.log(msg);
					console.error(`Found out of order messages`);
					debugger;
				}
				if (entry.relTime - lastEntry > 2) {
					signalUid = Math.random().toString(36);
				}
				lastEntry = entry.relTime;
				// console.log(entry.relTime - lastEntry);
				return {
					x: entry.time,
					relTime: entry.relTime,
					// @ts-ignore
					y: entry.signals[signal.name],
					// @ts-ignore
					unit: signal.unit,
					color: `rgba(${colors.join(`,`)}, 0.5)`,
					// @ts-ignore
					signalName: signal.name,
					signalUid,
				};
			})
	);
}

// @ts-ignore
function appendNewGraphData(plottedSignals, graphData, messages, firstCanTime) {
	// @ts-ignore
	const messagesPerPlot = plottedSignals.map((plottedMessages) =>
		// @ts-ignore
		plottedMessages.reduce((messages, { messageId, signalUid }) => {
			messages.push(messageId);
			return messages;
		}, []),
	);

	const extendedPlots = messagesPerPlot
		// @ts-ignore
		.map((plottedMessageIds, index) => ({ plottedMessageIds, index })) // preserve index so we can look up graphData
		// @ts-ignore
		.filter(({ plottedMessageIds, index }) => {
			if (index < graphData.length) {
				let maxGraphTime = 0;
				const { series } = graphData[index];
				if (series.length > 0) {
					maxGraphTime = series[graphData[index].series.length - 1].relTime;
				}

				return plottedMessageIds.some(
					// @ts-ignore
					(messageId) =>
						(messages[messageId].entries.length > 0 && series.length === 0) ||
						// @ts-ignore
						messages[messageId].entries.some((e) => e.relTime > maxGraphTime),
				);
			}
			return false;
		})
		// @ts-ignore
		.map(({ plottedMessageIds, index }) => {
			// @ts-ignore
			plottedMessageIds = plottedMessageIds.reduce((arr, messageId) => {
				if (arr.indexOf(messageId) === -1) {
					arr.push(messageId);
				}
				return arr;
			}, []);
			return { plottedMessageIds, index };
		});

	// @ts-ignore
	extendedPlots.forEach(({ plottedMessageIds, index }) => {
		// @ts-ignore
		const signalUidsByMessageId = plottedSignals[index].reduce((obj, { messageId, signalUid }) => {
			if (!obj[messageId]) {
				obj[messageId] = [];
			}
			obj[messageId].push(signalUid);
			return obj;
		}, {});
		const { series } = graphData[index];
		// @ts-ignore
		const graphDataMaxMessageTimes = plottedMessageIds.reduce((obj, messageId) => {
			const signalUids = signalUidsByMessageId[messageId];
			// @ts-ignore
			const maxIndex = ArrayUtils.findIndexRight(series, (entry) => signalUids.indexOf(entry.signalUid) !== -1);
			if (maxIndex) {
				obj[messageId] = series[maxIndex].relTime;
			} else if (series.length > 0) {
				obj[messageId] = series[series.length - 1].relTime;
			} else {
				// Graph data is empty
				obj[messageId] = -1;
			}

			return obj;
		}, {});

		// @ts-ignore
		let newGraphData = [];
		plottedMessageIds
			// @ts-ignore
			.map((messageId) => ({ messageId, entries: messages[messageId].entries }))
			.filter(
				(
					// @ts-ignore
					{ messageId, entries }, // Filter to only messages with stale graphData
				) => entries[entries.length - 1].relTime > graphDataMaxMessageTimes[messageId],
			)
			// @ts-ignore
			.forEach(({ messageId, entries }) => {
				// Compute and append new graphData
				const firstNewEntryIdx = entries.findIndex(
					// @ts-ignore
					(entry) => entry.relTime > graphDataMaxMessageTimes[messageId],
				);

				const newEntries = entries.slice(firstNewEntryIdx);
				// @ts-ignore
				signalUidsByMessageId[messageId].forEach((signalUid) => {
					const signalGraphData = _calcGraphData(
						{
							...messages[messageId],
							entries: newEntries,
						},
						signalUid,
						firstCanTime,
					);

					// @ts-ignore
					newGraphData = newGraphData.concat(signalGraphData);
				});
			});

		const messageIdOutOfBounds =
			series.length > 0 &&
			plottedMessageIds.find(
				// @ts-ignore
				(messageId) =>
					messages[messageId].entries.length > 0 &&
					series[0].relTime < messages[messageId].entries[0].relTime,
			);
		graphData[index] = {
			// @ts-ignore
			series: graphData[index].series.concat(newGraphData),
			updated: Date.now(),
		};

		if (messageIdOutOfBounds) {
			const graphDataLowerBound = graphData[index].series.findIndex(
				// @ts-ignore
				(e) => e.relTime > messages[messageIdOutOfBounds].entries[0].relTime,
			);

			if (graphDataLowerBound) {
				graphData[index].series = graphData[index].series.slice(graphDataLowerBound);
			}
		}
	});

	return [...graphData];
}

export default { _calcGraphData, appendNewGraphData, signalColors };
