import { IMessageEntry, IMessages } from "../../../types/types";

function findTimeIndex(entries: Array<IMessageEntry["frame"]>, time: IMessageEntry["frame"]["time"]) {
	// @ts-ignore
	return entries.findIndex((e) => e.time >= time);
}

function findRelativeTimeIndex(entries: Array<IMessageEntry["frame"]>, relTime: IMessageEntry["frame"]["relTime"]) {
	// @ts-ignore
	return entries.findIndex((e) => e.relTime >= relTime);
}

function findSegmentIndices(
	entries: Array<IMessageEntry["frame"]>,
	// @ts-ignore
	[segmentTimeLow, segmentTimeHi],
	isRelative: boolean,
) {
	/*
    Finds pair of indices (inclusive, exclusive) within entries array
    whose timestamps match segmentTimeLow and segmentTimeHi.
    if isRelative === true, then the segment times
    are assumed to correspond to the `relTime` field of each entry.

    Returns `[segmentIdxLow, segmentIdxHigh]`
             (inclusive, exclusive)
    */
	const timeIndexFunc = isRelative ? findRelativeTimeIndex : findTimeIndex;

	const segmentIdxLow = Math.max(0, timeIndexFunc(entries, segmentTimeLow));

	const upperSegments = entries.slice(segmentIdxLow);
	const upperSegmentIdxHi = timeIndexFunc(upperSegments, segmentTimeHi);
	const segmentIdxHi = upperSegmentIdxHi >= 0 ? upperSegmentIdxHi + segmentIdxLow + 1 : entries.length - 1;

	return [segmentIdxLow, Math.max(0, Math.min(segmentIdxHi, entries.length - 1))];
}

export default { findTimeIndex, findRelativeTimeIndex, findSegmentIndices };
